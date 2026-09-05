/**
 * The `/api/ask` pipeline (T024, contracts/api-ask.md).
 *
 * SERVER ONLY — it reaches `lib/model/client`, which holds the API key.
 *
 * The route handler is deliberately thin: it validates the body, turns these events into NDJSON
 * and maps one error class to a status. Everything that decides *what* the user is told lives
 * here, so the ordering guarantees are unit-testable without a `Request`:
 *
 *   submitted → crisis?          → crisis_referral            (no model call)
 *             → medicine change? → refused_medicine_change    (no model call)
 *             → model            → answered | not_on_sheet
 *
 * Constitution III (rules decide, the model only reads and phrases): the two gates run before the
 * provider is even resolved, grounding is re-checked against the card ids the server built, and
 * every generated string goes through the banned-term filter before it can be emitted.
 *
 * Constitution V (nothing leaves the phone except the question): the request schema is strict at
 * every level, so a body carrying a relationship label, a plan, a date or any other profile field
 * is rejected rather than quietly forwarded to the model. Nothing here logs the question, the
 * reading or the answer.
 *
 * Memory (`memory`, optional) is background and only that. It reaches the model as context in the
 * ASK prompt, it never reaches the two gates above it, it is never given to `phrase`, and it can
 * never become the source of an answer: the citation is checked against the card ids this server
 * built from the CURRENT reading, so a question only the brief could answer is `not_on_sheet`.
 */
import { z } from "zod";

import {
  DietLineSchema,
  DietLineWithTypeSchema,
  SheetReadingSchema,
  type AskResult,
  type Card,
  type Dialect,
  type SourceReference,
  type Speakable,
} from "@/lib/domain/schemas";
import type { ReferralResource } from "@/lib/i18n/referral";
import { MAX_BRIEF_CHARS } from "@/lib/memory/context";
import {
  ModelOutputError,
  getModelProvider,
  type EarlyAnswer,
  type ModelProvider,
} from "@/lib/model/client";
import {
  checkSpeakableAgainstQuotes,
  checkTextAgainstQuotes,
  type PrintedLines,
} from "@/lib/rules/banned-terms";
import { buildCards } from "@/lib/rules/card-order";
import { crisisReferral, detectCrisis } from "@/lib/rules/crisis";
import { detectMedicineChange } from "@/lib/rules/refusal";
import {
  BOUNDARY,
  NOT_ON_SHEET,
  OFF_TOPIC,
  REFUSED_MEDICINE_CHANGE,
  SMALL_TALK,
  templateFor,
} from "@/lib/rules/template-fallback";

/* -------------------------------------------------------------------------- */
/* Request schema                                                             */
/* -------------------------------------------------------------------------- */

/** A question is one utterance, not a conversation: 500 characters is far past any real one. */
export const MAX_QUESTION_CHARS = 500;

/**
 * The reading as the client holds it: the model's `SheetReading` plus what the client's own rules
 * added (`dietLine.recognisedType` from `lib/rules/diet-line.ts`) and what storage added
 * (`readAt`, `sample`). Everything else is still rejected — `SheetReadingSchema` is strict, so an
 * unexpected key anywhere in the tree is a 400.
 *
 * The two diet shapes are a union rather than an optional field because both halves are strict
 * objects: a `dietLine` carrying `recognisedType` fails `DietLineSchema`, and one without it fails
 * `DietLineWithTypeSchema`. Order matters — the wider shape is tried first.
 */
export const AskReadingSchema = SheetReadingSchema.extend({
  dietLine: z.union([DietLineWithTypeSchema, DietLineSchema]).nullable(),
  readAt: z.string().optional(),
  sample: z.boolean().optional(),
});
export type AskReading = z.infer<typeof AskReadingSchema>;

export const AskQuestionSchema = z.strictObject({
  text: z.string().min(1).max(MAX_QUESTION_CHARS),
  inputLanguage: z.enum(["yue", "cmn", "en"]),
});

/**
 * Strict at the top level on purpose (constitution V): `dialect` is the only profile-derived value
 * the client may send, and it is not an identifier. A body with a `label`, `plan` or `followUpDate`
 * key is a bug or a leak, and either way the answer is 400.
 *
 * `memory` is the one addition, and the strictness is what makes it safe to have: it is a single
 * capped string the client built with `buildMemoryBrief` out of sheets this app already read
 * (lib/memory/context.ts) — never an object the client can grow a profile field onto. The length
 * bound is the server's own, not a courtesy: a client that sent a longer one is not sending a
 * brief.
 */
/**
 * How much of the conversation travels: the whole thread about this sheet, up to forty turns.
 *
 * Six used to be the cap — enough to resolve "are there any more?", and nothing else. It meant
 * 明明 had forgotten the start of the briefing by the third question, could not tell which check-in
 * he had already used, and re-explained what he had explained. Forty turns is a long conversation
 * about one sheet, costs about two thousand tokens, and is already on the device.
 */
export const MAX_TURNS = 40;
/** One turn's ceiling. A briefing bubble is the longest thing either side says. */
export const MAX_TURN_CHARS = 600;

export const AskRequestSchema = z.strictObject({
  reading: AskReadingSchema,
  question: AskQuestionSchema,
  // The three spoken forms of `Speakable`: which one the answer leads with. Not an identifier.
  dialect: z.enum(["yue", "cmn", "en"]),
  memory: z.string().max(MAX_BRIEF_CHARS).optional(),
  /**
   * The last few turns of this conversation, for resolving what a follow-up refers back to.
   *
   * Bounded on both axes on purpose. It is the reader's own words and 明明's own replies, both
   * already on the device, and it may never become a channel for anything else: a role that is
   * not one of two values, or a turn over the cap, is rejected outright rather than trimmed.
   */
  context: z
    .array(
      z.strictObject({
        role: z.enum(["user", "agent"]),
        text: z.string().max(MAX_TURN_CHARS),
      }),
    )
    .max(MAX_TURNS)
    .optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** data-model.md § Question. `answered` only ever follows a citation the server verified. */
export type AskOutcome =
  | "answered"
  | "explained"
  | "boundary"
  | "chat"
  | "off_topic"
  | "refused_medicine_change"
  | "not_on_sheet"
  | "crisis_referral";

/** The outcomes whose sentence a phone may say the moment it has been written. */
export type SpokenOutcome = "answered" | "explained" | "boundary" | "chat" | "off_topic";

export interface ReferralPayload {
  text: string;
  resources: readonly ReferralResource[];
}

export type AskEvent =
  | { event: "outcome"; outcome: "crisis_referral"; referral: ReferralPayload }
  | { event: "outcome"; outcome: "refused_medicine_change" }
  | { event: "outcome"; outcome: "not_on_sheet" }
  /**
   * A general explanation: what a word, a test, a routine practice, a medicine or a condition
   * MEANS. Carries no card and no source line, because it is not a claim about this person's
   * page — the UI labels it as general so the two can never be confused (constitution IV).
   */
  | { event: "outcome"; outcome: "explained" }
  /** A greeting or a thank-you, answered in kind. Nothing about the page, nothing cited. */
  | { event: "outcome"; outcome: "chat" }
  /** Not health, not this sheet: a friendly line about what the app does, and nothing else. */
  | { event: "outcome"; outcome: "off_topic" }
  /**
   * The reader asked for a judgement about themselves. The reply hands that to the doctor and
   * then gives what the page does say, so it MAY cite cards; every id is one this server built.
   */
  | {
      event: "outcome";
      outcome: "boundary";
      citedCardIds: string[];
      sources: SourceReference[];
    }
  | {
      event: "outcome";
      outcome: "answered";
      /** Every card the answer stands on, in the order the model named them. */
      citedCardIds: string[];
      sources: SourceReference[];
    }
  /**
   * The reader's own spoken form of the answer, sent as soon as it has closed its quote — before
   * the other two languages exist. It has passed the banned-term filter on its own, `kind` and the
   * citations are already known, and the `answer` event that follows carries this exact string in
   * that field. A phone may start saying it at once; nothing it can say has skipped a gate.
   */
  | { event: "early"; dialect: "yue" | "cmn" | "en"; outcome: SpokenOutcome; text: string }
  | { event: "answer"; answer: Speakable }
  | { event: "done" }
  | { event: "error"; error: "model_unavailable" };

/**
 * The model could not be reached, declined, or rejected the request. The route maps this to 502
 * before the stream starts, or to an `error` event once it has. It carries no provider detail:
 * this is the one error the client sees, and provider messages can echo request text back.
 */
export class AskModelUnavailableError extends Error {
  readonly error = "model_unavailable";

  constructor() {
    super("the model could not answer this question");
    this.name = "AskModelUnavailableError";
  }
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

export interface AskDeps {
  /** Injected by the tests; production resolves the cached singleton. */
  provider?: ModelProvider;
}

/** The grounded refusal (FR-013): the sheet does not say, and the app does not guess. */
function* notOnSheetEvents(): Generator<AskEvent> {
  yield { event: "outcome", outcome: "not_on_sheet" };
  yield { event: "answer", answer: NOT_ON_SHEET };
  yield { event: "done" };
}

/**
 * The card the model claims to have cited, or null. A citation is only accepted when the id is one
 * the server itself produced for this reading — the client never has to trust the model's claim,
 * and neither does the route (contracts/api-ask.md).
 */
function citedCards(cards: readonly Card[], ids: readonly string[]): Card[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const id of ids) {
    const card = byId.get(id);
    if (card && !seen.has(id)) {
      seen.add(id);
      out.push(card);
    }
  }
  return out;
}

/**
 * Answers one question as an ordered event stream. Pure with respect to I/O apart from the two
 * model calls, so the tests drive it with a mocked provider and assert the gates never reach it.
 *
 * Throws `AskModelUnavailableError` and nothing else; unusable model output is not an error, it is
 * a `not_on_sheet` (the safe direction: an unparsable answer must never become a spoken one).
 */
export async function* runAsk(
  input: AskRequest,
  deps: AskDeps = {},
): AsyncGenerator<AskEvent, void, undefined> {
  const { reading, question, dialect } = input;

  // The two gates below are deliberately blind to `memory`: they read the question text and
  // nothing else, exactly as before. A crisis question and a "can she skip it?" question must
  // reach their fixed answers on the same keywords whatever the phone remembers, and neither may
  // become a reason to make a model call that would carry the brief.

  // 1. Crisis. Fixed referral text plus the organisers' resource list; no model call, no
  //    assessment, no continuation of the conversation (FR-014).
  if (detectCrisis(question.text).crisis) {
    yield {
      event: "outcome",
      outcome: "crisis_referral",
      referral: crisisReferral(question.inputLanguage),
    };
    yield { event: "done" };
    return;
  }

  // 2. Medicine change. Skip / stop / double / add / change dose in any of the three input
  //    languages: the fixed template points at the pharmacist and the sheet's contact line.
  if (detectMedicineChange(question.text).refuse) {
    yield { event: "outcome", outcome: "refused_medicine_change" };
    yield { event: "answer", answer: REFUSED_MEDICINE_CHANGE };
    yield { event: "done" };
    return;
  }

  const provider = deps.provider ?? getModelProvider();
  const cards = buildCards(reading);

  // Background only. The brief is omitted entirely when it is empty, so a first-ever question is
  // byte-for-byte the request it was before memory existed. Grounding is unchanged below: the
  // citation must still be a card id this server built from the CURRENT sheet, so a question the
  // brief could answer but the sheet cannot still comes back `not_on_sheet`.
  const memory = input.memory?.trim();
  // Same discipline as the brief: empty turns are dropped so a first question is byte-for-byte the
  // request it was before context existed. The client is what excludes refused and crisis turns
  // (`components/chat/thread.ts`) — those never reached the model and must not start now.
  const context = (input.context ?? [])
    .map((turn) => ({ role: turn.role, text: turn.text.trim() }))
    .filter((turn) => turn.text.length > 0);

  const request = {
    cards,
    question: question.text,
    inputLanguage: question.inputLanguage,
    dialect,
    ...(memory ? { memory } : {}),
    ...(context.length > 0 ? { context } : {}),
  };

  /*
   * The streamed path, when the provider has one. The early sentence arrives through a callback
   * in the middle of the model call, and a generator cannot yield from inside a callback — so the
   * call is started, and the first of "the early sentence landed" and "the call finished" is
   * awaited. Whichever it is, the call itself is awaited afterwards; nothing is emitted twice.
   */
  let early: EarlyAnswer | null = null;
  let earlyLanded: () => void = () => {};
  const earlyArrived = new Promise<void>((resolve) => {
    earlyLanded = resolve;
  });
  const call: Promise<{ ok: true; result: AskResult } | { ok: false; error: unknown }> = (
    provider.answerStream
      ? provider.answerStream(request, (partial) => {
          early = partial;
          earlyLanded();
        })
      : provider.answer(request)
  ).then(
    ({ result }) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  const first = await Promise.race([
    call.then(() => "done" as const),
    earlyArrived.then(() => "early" as const),
  ]);

  /** Locked once said aloud: the final `answer` carries this string in the reader's language. */
  let spoken: string | null = null;
  if (first === "early" && early !== null) {
    const partial: EarlyAnswer = early;
    const gate = earlyGate(partial, cards);
    if (gate !== null) {
      spoken = gate.text;
      yield { event: "early", dialect, outcome: gate.outcome, text: gate.text };
    }
  }

  const settled = await call;
  let result: AskResult | null;
  if (settled.ok) {
    result = settled.result;
  } else {
    // Invalid JSON, a truncated reply or a schema failure is not a transient outage: there is
    // nothing to retry and nothing safe to say, so it lands on the template rather than a 502.
    if (!(settled.error instanceof ModelOutputError)) throw new AskModelUnavailableError();
    result = null;
  }

  if (result === null || result.answer === null || result.kind === "none") {
    yield* notOnSheetEvents();
    return;
  }

  /**
   * The kinds that cite nothing leave here, before any of the card machinery below.
   *
   * A general explanation, a greeting and an off-topic redirect have no card to be checked
   * against and no card template to fall back to. The two conversational ones have a fixed
   * sentence of their own — a greeting answered with "the sheet doesn't say" is the failure those
   * kinds exist to remove. A general explanation whose own wording fails has nothing safe left to
   * say and becomes "not on the sheet", as before; the sheet is the product, and only the sheet
   * gets the repair path.
   */
  if (result.kind === "general" || result.kind === "chat" || result.kind === "off_topic") {
    const kind = result.kind;
    const outcome = kind === "general" ? "explained" : kind;
    const cleaned = cleanForms(result.answer, dialect, spoken, []);
    if (cleaned === null && kind === "general") {
      yield* notOnSheetEvents();
      return;
    }
    yield { event: "outcome", outcome };
    yield { event: "answer", answer: cleaned ?? (kind === "chat" ? SMALL_TALK : OFF_TOPIC) };
    yield { event: "done" };
    return;
  }

  const citations = citedCards(cards, result.citedCardIds);
  /** The printed lines this answer stands on: what a number in it is allowed to match. */
  const quotes: PrintedLines = citations.map((card) => card.source?.quote);

  /**
   * A boundary reply: the reader asked for a judgement about themselves, and 明明 hands that to
   * the doctor, then gives what the page does say. The citations are optional — the closest card
   * may be a warning sign or the contact line, or there may be none — and every id is verified
   * exactly as a sheet answer's is. A wording that fails the filter falls to the fixed sentence,
   * which cites nothing because it says nothing about the page.
   */
  if (result.kind === "boundary") {
    const cleaned = cleanForms(result.answer, dialect, spoken, quotes);
    if (cleaned === null) {
      yield { event: "outcome", outcome: "boundary", citedCardIds: [], sources: [] };
      yield { event: "answer", answer: BOUNDARY };
      yield { event: "done" };
      return;
    }
    yield {
      event: "outcome",
      outcome: "boundary",
      citedCardIds: citations.map((card) => card.id),
      sources: sourcesOf(citations),
    };
    yield { event: "answer", answer: cleaned };
    yield { event: "done" };
    return;
  }

  if (citations.length === 0) {
    yield* notOnSheetEvents();
    return;
  }
  // The repair path below rewrites ONE card's answer from its typed facts, so it needs a single
  // card to work from. The first cited card is the one the answer leads with.
  const cited = citations[0];

  let answer: Speakable = result.answer;
  const check = checkSpeakableAgainstQuotes(answer, quotes);
  if (!check.ok) {
    // One regenerate, then the fixed template (constitution VI). `phrase` is given only the card's
    // typed facts and its source line — never the question, never the model's rejected wording.
    const facts = cited.facts ?? {};
    let rephrased: Speakable | null = null;
    if (cited.source !== null) {
      try {
        const phrased = await provider.phrase({
          cardType: cited.type,
          facts,
          source: cited.source,
          avoid: check.matches,
          dialect: "both",
        });
        rephrased = phrased.result.spoken;
      } catch {
        // A failed rephrase is the same situation as a filtered one: fall through to the
        // template. A 502 here would throw away an answer the rules can still state safely.
        rephrased = null;
      }
    }
    answer =
      rephrased !== null && checkSpeakableAgainstQuotes(rephrased, quotes).ok
        ? rephrased
        : templateFor(cited.type, facts);
  }

  // The template is built from verbatim page text, so it can carry a number the page prints —
  // which the quote exemption lets through — or, rarely, one it does not (see
  // lib/rules/template-fallback.ts). Nothing filtered is ever emitted; the sheet's own line stays
  // visible on the card behind the answer.
  if (!checkSpeakableAgainstQuotes(answer, quotes).ok) {
    yield* notOnSheetEvents();
    return;
  }

  yield {
    event: "outcome",
    outcome: "answered",
    citedCardIds: citations.map((card) => card.id),
    sources: sourcesOf(citations),
  };
  yield { event: "answer", answer: withSpoken(answer, dialect, spoken) };
  yield { event: "done" };
}

function sourcesOf(cards: readonly Card[]): SourceReference[] {
  return cards
    .map((card) => card.source)
    .filter((source): source is SourceReference => source !== null);
}

/**
 * The gates the early sentence must pass before a phone may say it — the same ones the final
 * answer passes, applied to what is known so far: `kind` is one that may speak; a sheet answer
 * cites at least one card this server built; the sentence itself carries no banned term, with a
 * number the cited lines print allowed through exactly as in the full path. When any of them
 * fails, nothing is sent early and the full path decides as before.
 */
export function earlyGate(
  early: EarlyAnswer,
  cards: readonly Card[],
): { outcome: SpokenOutcome; text: string } | null {
  if (early.text === null || early.text.trim().length === 0) return null;
  const kind = early.kind;
  if (kind === "general" || kind === "chat" || kind === "off_topic") {
    if (!checkTextAgainstQuotes(early.text, []).ok) return null;
    return { outcome: kind === "general" ? "explained" : kind, text: early.text };
  }
  if (kind !== "sheet" && kind !== "boundary") return null;
  const cited = early.citedCardIds === null ? [] : citedCards(cards, early.citedCardIds);
  if (kind === "sheet" && cited.length === 0) return null;
  const quotes: PrintedLines = cited.map((card) => card.source?.quote);
  if (!checkTextAgainstQuotes(early.text, quotes).ok) return null;
  return { outcome: kind === "sheet" ? "answered" : "boundary", text: early.text };
}

const FORMS = ["yue", "cmn", "en"] as const;

/**
 * The three forms of a reply that cites no card template, each through the filter, with the
 * reader's own form as the one that decides.
 *
 * The client shows and speaks only `answer[dialect]` (app/chat/page.tsx), and the early event has
 * usually said that sentence aloud already. So the reader's form must be clean: when it is not,
 * null — nothing was said early, because the early gate ran the same check on the same string —
 * and the caller falls to its fixed sentence. A form in ANOTHER language that fails is replaced
 * by the reader's clean one rather than costing the whole turn. Throwing away a sentence the phone
 * had already spoken and then contradicting it with "the sheet doesn't say" was the live failure on
 * 「空腹係咩意思？」: early=explained, final=not_on_sheet, from one English word. Nothing filtered
 * is ever emitted (principle VI), and what is emitted agrees with what was heard.
 */
function cleanForms(
  answer: Speakable,
  dialect: Dialect,
  spoken: string | null,
  quotes: PrintedLines,
): Speakable | null {
  const own = spoken ?? answer[dialect];
  if (!checkTextAgainstQuotes(own, quotes).ok) return null;
  const out: Speakable = { ...answer, [dialect]: own };
  for (const form of FORMS) {
    if (form === dialect) continue;
    if (!checkTextAgainstQuotes(out[form], quotes).ok) out[form] = own;
  }
  return out;
}

/**
 * Pins the reader's language to the sentence already said aloud. The two paths agree by
 * construction — the early string is the model's own, unchanged — except when a banned term in
 * ANOTHER language sent the whole answer through `phrase`, which rewrites all three. A phone that
 * has already spoken one sentence must not be handed a different one for the same turn, and the
 * early string passed the filter on its own, so keeping it breaks no rule.
 */
function withSpoken(
  answer: Speakable,
  dialect: "yue" | "cmn" | "en",
  spoken: string | null,
): Speakable {
  if (spoken === null || answer[dialect] === spoken) return answer;
  return { ...answer, [dialect]: spoken };
}
