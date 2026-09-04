/**
 * The client half of `POST /api/ask` (contracts/api-ask.md).
 *
 * One question in, one outcome out. The route answers with newline-delimited JSON so the
 * outcome card can be styled before the sentence itself arrives:
 *
 *   {"event":"outcome","outcome":"answered","citedCardIds":["medicine-1"],"sources":[{…}]}
 *   {"event":"answer","answer":{"yue":"…","cmn":"…"}}
 *   {"event":"done"}
 *
 * Three things this module guarantees, in order of importance:
 *
 * 1. **Privacy is structural.** The body is assembled field by field from four values —
 *    `reading`, `question`, `dialect` and the optional `memory` brief — so no future caller can
 *    smuggle the relationship label, the plan, or an identifier into the request by widening a
 *    type (constitution principle V, FR-019). `tests/unit/ask-stream.test.ts` asserts the key set,
 *    and the brief itself is built by `lib/memory/context.ts`, whose input shape has no field a
 *    label could live in.
 * 2. **Nothing is logged.** No `console` call anywhere in this file: the question text and the
 *    answer never leave the call stack.
 * 3. **A failure is an outcome, not an exception.** Every path — a 400, a 502, a dropped
 *    connection, a stream that ends without saying anything — resolves to a typed outcome the
 *    ask page can render calmly. `ask` never rejects.
 *
 * The crisis and medicine-change gates run on the client *before* this module is reached (the
 * page calls `detectCrisis` / `detectMedicineChange` itself, and the server runs the same two
 * gates again). A `crisis_referral` or `refused_medicine_change` arriving over the wire is
 * therefore the server's belt-and-braces copy, and is handled here too.
 */
import type {
  Dialect,
  InputLanguage,
  SheetReading,
  SourceReference,
  Speakable,
  StoredReading,
} from "@/lib/domain/schemas";
import type { ReferralResource } from "@/lib/i18n/referral";
import { crisisReferral } from "@/lib/rules/crisis";
import { NOT_ON_SHEET, REFUSED_MEDICINE_CHANGE } from "@/lib/rules/template-fallback";

/** The route to ask. Exported so the test does not have to hard-code the string twice. */
export const ASK_ENDPOINT = "/api/ask";

/** Outcomes the rules or the model can decide (data-model.md, Question.outcome). */
export type AnswerOutcome =
  | "answered"
  /**
   * A general explanation of a word or a routine practice, from general knowledge rather than
   * from the page. Carries no cited card and no source line, and the UI must label it as general
   * so it is never mistaken for something the reader's own sheet says.
   */
  | "explained"
  | "refused_medicine_change"
  | "not_on_sheet"
  | "crisis_referral";

/** Outcomes for a request that never produced an answer (contracts/api-ask.md, Errors). */
export type FailureOutcome = "bad_request" | "model_unavailable";

export type AskOutcome = AnswerOutcome | FailureOutcome;

export interface AskQuestion {
  /** As recognised or typed. Shown to the user before it is sent; never logged. */
  text: string;
  inputLanguage: InputLanguage;
}

export interface AskRequest {
  /** The current reading, exactly as `/api/read` produced it. Nothing else from storage. */
  reading: SheetReading | StoredReading;
  question: AskQuestion;
  /** The output form. The only profile-derived value sent, and not an identifier. */
  dialect: Dialect;
  /**
   * The on-device memory brief from `memoryBrief()` (`lib/memory/`), when there is one. Plain
   * text built only from sheets this app already read: no relationship label, no name, no plan,
   * no identifier. An empty or missing brief is left out of the body entirely, so a first-ever
   * question posts exactly the three fields it always did.
   */
  memory?: string;
}

export interface AskReferral {
  text: string;
  resources: readonly ReferralResource[];
}

export interface AskResponse {
  outcome: AskOutcome;
  /** Every card the server cited. The page looks them up in its own `buildCards`. */
  citedCardIds?: string[];
  /** Every printed line behind the answer, copied from the cited cards by the server. */
  sources?: SourceReference[];
  /** The sentence to show and speak. Absent for the two failure outcomes. */
  answer?: Speakable;
  /** Only for `crisis_referral`: the fixed text and the resource list, built on the client. */
  referral?: AskReferral;
}

export interface AskHandlers {
  /** Fires as soon as the outcome is known, before the sentence arrives, so the card can style itself. */
  onOutcome?: (event: {
    outcome: AnswerOutcome;
    citedCardIds?: string[];
    sources?: SourceReference[];
  }) => void;
  /** Fires once with the answer text. Not called for the failure outcomes. */
  onAnswer?: (answer: Speakable) => void;
  /** Fires once when the request could not produce an answer at all. */
  onFailure?: (outcome: FailureOutcome) => void;
  /** Aborts the request and the stream. */
  signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/* Wire events                                                                */
/* -------------------------------------------------------------------------- */

interface OutcomeEvent {
  event: "outcome";
  outcome: string;
  citedCardIds?: string[] | null;
  sources?: SourceReference[] | null;
  source?: SourceReference | null;
}

interface AnswerEvent {
  event: "answer";
  answer?: Speakable | null;
}

interface DoneEvent {
  event: "done";
}

interface ErrorEvent {
  event: "error";
  error?: string;
}

type AskEvent = OutcomeEvent | AnswerEvent | DoneEvent | ErrorEvent;

const ANSWER_OUTCOMES: ReadonlySet<string> = new Set<AnswerOutcome>([
  "answered",
  "explained",
  "refused_medicine_change",
  "not_on_sheet",
  "crisis_referral",
]);

function isAnswerOutcome(value: string): value is AnswerOutcome {
  return ANSWER_OUTCOMES.has(value);
}

/** Body strings from the route's error responses, mapped to the two failure outcomes. */
function failureFor(error: string | undefined, fallback: FailureOutcome): FailureOutcome {
  if (error === "bad_request") return "bad_request";
  if (error === "model_unavailable") return "model_unavailable";
  return fallback;
}

/** HTTP status → failure outcome. Anything unexpected is treated as "the model is not there". */
function failureForStatus(status: number): FailureOutcome {
  return status === 400 ? "bad_request" : "model_unavailable";
}

function parseEvent(line: string): AskEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const event = (parsed as { event?: unknown }).event;
    if (typeof event !== "string") return null;
    return parsed as AskEvent;
  } catch {
    // A half-written or non-JSON line is dropped rather than failing the whole answer.
    return null;
  }
}

function isSpeakable(value: unknown): value is Speakable {
  if (!value || typeof value !== "object") return false;
  const { yue, cmn } = value as { yue?: unknown; cmn?: unknown };
  return typeof yue === "string" && typeof cmn === "string";
}

/**
 * The template the client falls back to when the server names an outcome but sends no sentence.
 * Both are fixed strings from `lib/rules/`, so a truncated stream still shows honest copy
 * instead of an empty card (FR-013, FR-011).
 */
function templateAnswer(outcome: AnswerOutcome): Speakable | undefined {
  if (outcome === "refused_medicine_change") return REFUSED_MEDICINE_CHANGE;
  if (outcome === "not_on_sheet") return NOT_ON_SHEET;
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Asks one question and resolves with the outcome. Never rejects: an aborted request, a dead
 * network and a 502 all come back as `model_unavailable` so the caller has exactly one shape
 * to render.
 */
export async function ask(request: AskRequest, handlers: AskHandlers = {}): Promise<AskResponse> {
  // Assembled field by field on purpose: this is the privacy guarantee, not a convenience.
  const brief = request.memory?.trim() ?? "";
  const body = JSON.stringify({
    reading: request.reading,
    question: {
      text: request.question.text,
      inputLanguage: request.question.inputLanguage,
    },
    dialect: request.dialect,
    ...(brief ? { memory: brief } : {}),
  });

  const fail = (outcome: FailureOutcome): AskResponse => {
    handlers.onFailure?.(outcome);
    return { outcome };
  };

  let response: Response;
  try {
    response = await fetch(ASK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: handlers.signal,
    });
  } catch {
    // Offline, blocked, or aborted. The cards from the sheet are still on screen and correct.
    return fail("model_unavailable");
  }

  if (!response.ok) {
    let named: string | undefined;
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload?.error === "string") named = payload.error;
    } catch {
      // A body-less error response is fine; the status alone decides.
    }
    return fail(failureFor(named, failureForStatus(response.status)));
  }

  if (!response.body) return fail("model_unavailable");

  const result: AskResponse = { outcome: "model_unavailable" };
  // A holder rather than two `let`s: the compiler keeps property types honest across the
  // closure below, where plain locals would stay narrowed to their initial values.
  const state: { answered: AnswerOutcome | null; failure: FailureOutcome | null } = {
    answered: null,
    failure: null,
  };

  const consume = (line: string): void => {
    const event = parseEvent(line);
    if (!event) return;

    if (event.event === "outcome") {
      if (!isAnswerOutcome(event.outcome)) return;
      state.answered = event.outcome;
      result.outcome = event.outcome;
      if (Array.isArray(event.citedCardIds) && event.citedCardIds.length > 0) {
        result.citedCardIds = event.citedCardIds;
      }
      if (Array.isArray(event.sources) && event.sources.length > 0) {
        result.sources = event.sources;
      }
      if (event.outcome === "crisis_referral") {
        result.referral = crisisReferral(request.question.inputLanguage);
      }
      handlers.onOutcome?.({
        outcome: event.outcome,
        citedCardIds: result.citedCardIds,
        sources: result.sources,
      });
      return;
    }

    if (event.event === "answer") {
      if (!isSpeakable(event.answer)) return;
      result.answer = event.answer;
      handlers.onAnswer?.(event.answer);
      return;
    }

    if (event.event === "error") {
      state.failure = failureFor(event.error, "model_unavailable");
    }
    // "done" needs no handling: the loop ends with the stream.
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Lines arrive split across chunks, and one chunk can hold several: drain the buffer.
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        consume(line);
      }
    }
    buffer += decoder.decode();
    // A last line without its newline is still an event.
    consume(buffer);
  } catch {
    // The connection dropped mid-stream. Whatever already arrived is kept below.
    if (state.answered === null) return fail("model_unavailable");
  } finally {
    reader.releaseLock();
  }

  if (state.failure !== null) return fail(state.failure);
  if (state.answered === null) return fail("model_unavailable");

  if (!result.answer) {
    const template = templateAnswer(state.answered);
    if (template) {
      result.answer = template;
      handlers.onAnswer?.(template);
    }
  }

  return result;
}
