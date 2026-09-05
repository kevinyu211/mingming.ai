/**
 * SERVER ONLY. The read pipeline: everything `/api/read` does between "the model replied" and
 * "these are the cards", with no HTTP in it.
 *
 *   validate → diet rules → build cards → banned-term filter → regenerate once → template
 *
 * Split out from the route on purpose. The route owns parsing, status codes and the NDJSON
 * stream; this owns the safety gates, so they can be unit-tested against a mock provider with no
 * API key and no `Request` (constitution III: rules decide, and a gate that is hard to test is a
 * gate that rots).
 *
 * The only model call here is `phrase`, and only ever as a repair after the deterministic filter
 * has already rejected a string. A model output never decides whether a card is shown.
 *
 * Logging discipline (principle V): nothing in this module logs, and nothing it returns is
 * derived from anything but the supplied reading.
 */
import {
  SheetReadingSchema,
  type Card,
  type CardType,
  type SheetReading,
  type SourceReference,
  type Speakable,
  type StoredReading,
} from "@/lib/domain/schemas";
import { ModelCancelledError, ModelOutputError, type ModelCallOptions, type ModelProvider } from "@/lib/model/client";
import { READ_REPAIR_CONCURRENCY, READ_REPAIR_TIMEOUT_MS } from "@/lib/domain/read-policy";
import { abortFailure, callBudget, withinSignal } from "@/lib/server/call-budget";
import type { PhraseDialect } from "@/lib/model/prompts";
import { checkCard, checkSpeakableAgainstQuotes } from "@/lib/rules/banned-terms";
import { buildCards } from "@/lib/rules/card-order";
import { applyDietRules } from "@/lib/rules/diet-line";
import { templateFor, type TemplateFacts } from "@/lib/rules/template-fallback";

/** What the filter had to do, for the `done` event and the eval log. Never any text. */
export interface FilterCounts {
  /** Bodies the model successfully re-phrased after a banned-term hit. */
  regenerated: number;
  /** Bodies replaced by a fixed template because re-phrasing failed or hit the filter again. */
  templated: number;
}

export type ReadingPipelineResult =
  /** `sheetType: "unknown"` — the app declines rather than summarising (FR-006, principle IV). */
  | { kind: "unknown" }
  | { kind: "reading"; cards: Card[]; reading: StoredReading; filter: FilterCounts };

export interface ReadingPipelineOptions {
  /** Injected so tests can pin `readAt`. */
  now?: () => Date;
  /** Which dialect the repair prompt leads with. Both, unless a caller knows better. */
  dialect?: PhraseDialect;
  signal?: AbortSignal;
  deadline?: number;
}

/** Stand-in for a card that quotes nothing off the page (`noWarnings`, `referral`). */
export const NO_SOURCE: SourceReference = { section: "", lineIndex: null, quote: "" };

/**
 * Last resort. `lib/rules/template-fallback.ts` documents the one case where a template can still
 * trip the filter: the template is built from verbatim fact fields, so a sheet that itself prints
 * a numeric target about the person ("鹽 2g/日" on the diet line) renders into a filtered string.
 * Principle VI is a MUST — every shown or spoken string passes the filter — so that case falls
 * back to this fixed sentence and the user reads the line off the page instead.
 */
export const SEE_THE_SHEET: Speakable = {
  yue: "呢一行請直接睇返張紙，或者打張紙上面嘅電話問。",
  cmn: "这一行请直接看纸，或者打纸上面的电话问。",
  en: "Have a look at this line on the sheet itself, or ring the number printed on it and ask.",
};

/**
 * `templateFor`, with the principle VI guarantee actually enforced. `quote` is the printed line
 * the card stands on: a number the template copied off it is allowed through, a number it did
 * not is not (see `checkTextAgainstQuotes`).
 */
export function safeTemplate(
  type: CardType,
  facts: TemplateFacts,
  quote?: string | null,
): Speakable {
  const template = templateFor(type, facts);
  return checkSpeakableAgainstQuotes(template, [quote]).ok ? template : SEE_THE_SHEET;
}

/**
 * Folded for comparison only: width and case normalised, every space dropped, so "47.5 mg" and
 * "47.5mg" compare equal while a different spelling still does not. Nothing stored or shown is
 * ever rewritten by this — it only decides whether a card agrees with its own quote.
 */
function fold(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * The one traceability check a server can actually make (principle IV).
 *
 * Nothing here can see the photograph, so "does this quote match the page" is out of reach — that
 * is the gap `tests/eval/stress.md` found, where a line printed "Breathless at rest" and came back
 * quoted "Breathlessness at rest". What IS in reach is internal consistency: a medicine's `name`
 * and `strength` are copied off the same printed line as its `quote`, so they have to be findable
 * inside it. When they are not, one of the two was rewritten somewhere between the page and the
 * reply, and the card no longer stands on the line it cites.
 *
 * A card that fails is kept, not dropped — losing a medicine is worse than showing a doubtful one
 * — and marked `unverified` so the UI can say this is the line to check against the paper. Cards
 * with no typed fields to cross-check (warnings, diet, activity) always pass: this asserts
 * agreement where it can be asserted, and claims nothing where it cannot.
 */
export function verifiedAgainstQuote(card: Card): boolean {
  if (card.type !== "medicine") return true;
  const quote = fold(card.source?.quote ?? "");
  // A medicine card with no quote has nothing to stand on, which is the thing being checked for.
  if (quote.length === 0) return false;
  return (["name", "strength"] as const).every((key) => {
    const value = card.facts?.[key];
    if (typeof value !== "string" || value.trim().length === 0) return true;
    return quote.includes(fold(value));
  });
}

/**
 * Runs the rules over one model reading.
 *
 * `provider` is narrowed to `phrase` so a test can pass `{ phrase: vi.fn() }` — and so it is
 * structurally impossible for this module to start a second read.
 *
 * Throws `ModelOutputError` when the reading does not match the schema. The provider already
 * validated it, so this is a second gate rather than the first one: the contract says nothing but
 * `status` may be emitted before the reading is validated, and that guarantee should not depend on
 * a different module keeping its promise.
 */
export async function runReadingPipeline(
  reading: SheetReading,
  provider: Pick<ModelProvider, "phrase">,
  options: ReadingPipelineOptions = {},
): Promise<ReadingPipelineResult> {
  const parsed = SheetReadingSchema.safeParse(reading);
  if (!parsed.success) {
    throw new ModelOutputError(
      "schema",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    );
  }
  const validated = parsed.data;
  if (validated.sheetType === "unknown") return { kind: "unknown" };

  // Rule-generated, not model-generated (FR-025): the printed line decides the diet type.
  const stored: StoredReading = {
    ...validated,
    dietLine: applyDietRules(validated),
    readAt: (options.now?.() ?? new Date()).toISOString(),
  };

  const filter: FilterCounts = { regenerated: 0, templated: 0 };
  const dialect = options.dialect ?? "both";
  if (options.signal?.aborted) throw abortFailure(options.signal);
  const cards: Card[] = buildCards(stored).map((built) =>
    verifiedAgainstQuote(built) ? built : { ...built, unverified: true },
  );
  const pending = cards.flatMap((card, index) => {
    const check = checkCard(card);
    return check.ok ? [] : [{ card, index, avoid: check.matches }];
  });

  if (pending.length > 0) {
    const deadline = Math.min(options.deadline ?? Infinity, Date.now() + READ_REPAIR_TIMEOUT_MS);
    const budget = callBudget(deadline - Date.now(), options.signal);
    let cursor = 0;
    const worker = async () => {
      while (!budget.signal.aborted && Date.now() < deadline) {
        const item = pending[cursor++];
        if (!item) return;
        cards[item.index] = await repair(item.card, item.avoid, provider, dialect, filter, {
          signal: budget.signal,
          timeoutMs: Math.max(1, deadline - Date.now()),
        });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(READ_REPAIR_CONCURRENCY, pending.length) }, worker));
      if (options.signal?.aborted) throw abortFailure(options.signal);
      // A queued card whose repair never started must receive the same checked fallback.
      for (const { card, index } of pending) {
        if (cards[index] !== card) continue;
        filter.templated += 1;
        cards[index] = {
          ...card,
          body: safeTemplate(card.type, card.facts ?? {}, card.source?.quote),
          aiGenerated: false,
        };
      }
    } finally {
      budget.dispose();
    }
  }

  return { kind: "reading", cards, reading: withFilteredSpoken(stored, cards), filter };
}

/**
 * One banned-term hit: re-phrase once naming the matched terms, re-check, then template
 * (constitution VI). A `phrase` call that fails outright is treated as a failed repair rather than
 * a failed read — the expensive part already succeeded, and the template is a safe answer.
 */
async function repair(
  card: Card,
  avoid: string[],
  provider: Pick<ModelProvider, "phrase">,
  dialect: PhraseDialect,
  filter: FilterCounts,
  options?: ModelCallOptions,
): Promise<Card> {
  const facts: TemplateFacts = card.facts ?? {};

  let regenerated: Speakable | null = null;
  try {
    const call = () => provider.phrase({
      cardType: card.type,
      facts,
      source: card.source ?? NO_SOURCE,
      avoid,
      dialect,
    }, options);
    const result = options?.signal ? await withinSignal(options.signal, call) : await call();
    regenerated = result.result.spoken;
  } catch (error) {
    if (error instanceof ModelCancelledError) throw error;
    regenerated = null;
  }

  if (regenerated !== null && checkSpeakableAgainstQuotes(regenerated, [card.source?.quote]).ok) {
    filter.regenerated += 1;
    return { ...card, body: regenerated };
  }

  filter.templated += 1;
  // A stopped medicine now HAS a safe template. It used to fall through to `SEE_THE_SHEET`,
  // because `templateFor("medicine", …)` states the name, the dose and the frequency as a plain
  // sentence about what to take — "药名 Digoxin，0.25mg，每日一次。" — and the one clause saying
  // the page had stopped it lived only in the model's own wording, which is what gets discarded
  // here. Pointing at the paper was safe but lost the drug's name, and the live stress runs hit
  // this on roughly one read in three: the model writes `spoken` text for a withdrawn drug that
  // reads like a live dose ("0.25mg 每日"), the numeric-target rule rejects it, and the family
  // ends up told to look at a sheet without being told what to look for.
  //
  // `lib/rules/card-order.ts` copies `status` into `facts`, so `templateFor` dispatches to
  // `stoppedMedicineTemplate` on its own: the drug is named verbatim, the fact is attributed to
  // the page, and no frequency, amount or duration is stated.
  const body = safeTemplate(card.type, facts, card.source?.quote);
  // A template is rule-generated, so the AI label comes off with the AI text.
  return { ...card, body, aiGenerated: false };
}

/**
 * Copies filtered bodies back onto the reading, so the stored copy cannot resurrect rejected text
 * if the client re-renders it with `buildCards` after a reload.
 *
 * Only the fields with a lossless 1:1 card mapping are copied. A warning card's body is
 * `symptom` and `action` joined, which has no inverse, so `warningSigns` is left exactly as
 * extracted: `cards` is the authoritative filtered output, and a re-render from the stored reading
 * has to re-run the filter.
 */
function withFilteredSpoken(stored: StoredReading, cards: Card[]): StoredReading {
  const bodies = new Map(cards.map((card) => [card.id, card.body]));
  return {
    ...stored,
    medicines: stored.medicines.map((m, i) => withSpoken(m, bodies.get(`medicine-${i}`))),
    followUp: stored.followUp.map((f, i) => withSpoken(f, bodies.get(`followup-${i}`))),
    dietLine: stored.dietLine === null ? null : withSpoken(stored.dietLine, bodies.get("diet")),
    activityLine:
      stored.activityLine === null
        ? null
        : withSpoken(stored.activityLine, bodies.get("activity")),
  };
}

function withSpoken<T extends { spoken: Speakable }>(item: T, spoken: Speakable | undefined): T {
  return spoken === undefined ? item : { ...item, spoken };
}
