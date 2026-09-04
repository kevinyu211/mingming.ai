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
  type SourceReference,
  type Speakable,
} from "@/lib/domain/schemas";
import type { ReferralResource } from "@/lib/i18n/referral";
import { MAX_BRIEF_CHARS } from "@/lib/memory/context";
import { ModelOutputError, getModelProvider, type ModelProvider } from "@/lib/model/client";
import { checkSpeakable } from "@/lib/rules/banned-terms";
import { buildCards } from "@/lib/rules/card-order";
import { crisisReferral, detectCrisis } from "@/lib/rules/crisis";
import { detectMedicineChange } from "@/lib/rules/refusal";
import {
  NOT_ON_SHEET,
  REFUSED_MEDICINE_CHANGE,
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
export const AskRequestSchema = z.strictObject({
  reading: AskReadingSchema,
  question: AskQuestionSchema,
  // The three spoken forms of `Speakable`: which one the answer leads with. Not an identifier.
  dialect: z.enum(["yue", "cmn", "en"]),
  memory: z.string().max(MAX_BRIEF_CHARS).optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** data-model.md § Question. `answered` only ever follows a citation the server verified. */
export type AskOutcome =
  | "answered"
  | "explained"
  | "refused_medicine_change"
  | "not_on_sheet"
  | "crisis_referral";

export interface ReferralPayload {
  text: string;
  resources: readonly ReferralResource[];
}

export type AskEvent =
  | { event: "outcome"; outcome: "crisis_referral"; referral: ReferralPayload }
  | { event: "outcome"; outcome: "refused_medicine_change" }
  | { event: "outcome"; outcome: "not_on_sheet" }
  /**
   * A general explanation: what a word or a routine practice MEANS. Carries no card and no source
   * line, because it is not a claim about this person's page — the UI labels it as general so the
   * two can never be confused (constitution IV, amended 1.1.0).
   */
  | { event: "outcome"; outcome: "explained" }
  | {
      event: "outcome";
      outcome: "answered";
      citedCardId: string;
      source: SourceReference | null;
    }
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
function citedCard(cards: readonly Card[], citedCardId: string | null): Card | null {
  if (citedCardId === null) return null;
  return cards.find((card) => card.id === citedCardId) ?? null;
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

  let result: AskResult | null;
  try {
    ({ result } = await provider.answer({
      cards,
      question: question.text,
      inputLanguage: question.inputLanguage,
      dialect,
      ...(memory ? { memory } : {}),
    }));
  } catch (error) {
    // Invalid JSON, a truncated reply or a schema failure is not a transient outage: there is
    // nothing to retry and nothing safe to say, so it lands on the template rather than a 502.
    if (!(error instanceof ModelOutputError)) throw new AskModelUnavailableError();
    result = null;
  }

  if (result === null || result.answer === null || result.kind === "none") {
    yield* notOnSheetEvents();
    return;
  }

  /**
   * A general explanation leaves here, before any of the card machinery below.
   *
   * It cites nothing by construction, so there is no card to check it against and no template to
   * fall back to — if the banned-term filter rejects the wording there is nothing safe left to
   * say, and it becomes "not on the sheet" rather than a rephrase. Explanations are a convenience;
   * the sheet is the product, and only the sheet gets the repair path.
   */
  if (result.kind === "general") {
    if (!checkSpeakable(result.answer).ok) {
      yield* notOnSheetEvents();
      return;
    }
    yield { event: "outcome", outcome: "explained" };
    yield { event: "answer", answer: result.answer };
    yield { event: "done" };
    return;
  }

  const cited = citedCard(cards, result.citedCardId);
  if (cited === null) {
    yield* notOnSheetEvents();
    return;
  }

  let answer: Speakable = result.answer;
  const check = checkSpeakable(answer);
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
      rephrased !== null && checkSpeakable(rephrased).ok
        ? rephrased
        : templateFor(cited.type, facts);
  }

  // The template is built from verbatim page text, so it can itself carry a printed numeric target
  // (see lib/rules/template-fallback.ts). Nothing filtered is ever emitted; the sheet's own line
  // stays visible on the card behind the answer.
  if (!checkSpeakable(answer).ok) {
    yield* notOnSheetEvents();
    return;
  }

  yield {
    event: "outcome",
    outcome: "answered",
    citedCardId: cited.id,
    source: cited.source,
  };
  yield { event: "answer", answer };
  yield { event: "done" };
}
