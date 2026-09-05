/**
 * The browser half of `POST /api/read` (contracts/api-read.md).
 *
 * The route answers with newline-delimited JSON: immediate progress, then the complete validated
 * card set. This module turns that stream into callbacks plus one typed outcome,
 * so a page never has to reason about HTTP status codes or half-arrived lines.
 *
 * Every failure is a named outcome, not an exception: the constitution treats failure paths as
 * features, and each one maps to a designed screen (S10) rather than a toast.
 */
import {
  CardSchema,
  StoredReadingSchema,
  type Card,
  type StoredReading,
} from "@/lib/domain/schemas";
import {
  READ_PROCESSING_TIMEOUT_MS,
  READ_RESPONSE_GRACE_MS,
  READ_SUBMISSION_TIMEOUT_MS,
} from "@/lib/domain/read-policy";

import { validateReadingCards } from "@/lib/sheets/cards";

/** One downscaled page, as `lib/image/downscale.ts` produces it. */
export interface ImageInput {
  mediaType: "image/jpeg";
  base64: string;
}

/** Counts of strings the server had to regenerate or template, for the eval log. */
export interface FilterCounts {
  regenerated: number;
  templated: number;
}

export type ReadOutcome =
  | { kind: "reading"; reading: StoredReading; cards: Card[]; filter: FilterCounts | null }
  /** `sheetType: "unknown"` — not a discharge sheet, so no cards at all (FR-006). */
  | { kind: "unknown" }
  /** 422: the model's output failed schema validation even after the server's retry. */
  | { kind: "invalid_reading" }
  /** 502, or the request never reached the route. */
  | { kind: "model_unavailable" }
  | { kind: "timed_out" }
  | { kind: "cancelled" }
  /** 413: the pages are over the body limit. */
  | { kind: "too_large" }
  /** 400: the request was malformed, or the photo was rejected before reading. */
  | { kind: "bad_request"; detail: string | null };

export interface ReadHandlers {
  /** `{"event":"status","phase":"reading"}` — the server has started. */
  onStatus?: (phase: string) => void;
  /** One card, already filtered and in the fixed order. */
  onCard?: (card: Card) => void;
  signal?: AbortSignal;
}

/** Splits a decoded buffer into whole lines, keeping whatever comes after the last newline. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((line) => line.trim()).filter((line) => line.length > 0), rest };
}

type StreamEvent =
  | { event: "status"; phase?: string }
  | { event: "card"; card: Card }
  | { event: "unknown" }
  | { event: "done"; reading: unknown; filter?: FilterCounts }
  | { event: "error"; error?: string };

function parseEvent(line: string): StreamEvent | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null) return null;
    const event = (value as { event?: unknown }).event;
    if (typeof event !== "string") return null;
    return value as StreamEvent;
  } catch {
    // A truncated or non-JSON line is not worth failing the whole reading over.
    return null;
  }
}

/** Maps the route's error names (and its status codes) onto outcomes. */
function outcomeForError(name: string | undefined, status: number): ReadOutcome {
  switch (name) {
    case "too_large":
      return { kind: "too_large" };
    case "invalid_reading":
      return { kind: "invalid_reading" };
    case "model_unavailable":
      return { kind: "model_unavailable" };
    case "bad_request":
      return { kind: "bad_request", detail: null };
    case "timed_out":
      return { kind: "timed_out" };
    case "cancelled":
      return { kind: "cancelled" };
    default:
      break;
  }
  if (status === 413) return { kind: "too_large" };
  if (status === 422) return { kind: "invalid_reading" };
  if (status === 400) return { kind: "bad_request", detail: null };
  return { kind: "model_unavailable" };
}

async function errorOutcome(response: Response): Promise<ReadOutcome> {
  let name: string | undefined;
  let detail: string | null = null;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === "string") name = error;
      const d = (body as { detail?: unknown }).detail;
      if (typeof d === "string") detail = d;
    }
  } catch {
    // No body, or not JSON. The status code alone decides.
  }
  const outcome = outcomeForError(name, response.status);
  return outcome.kind === "bad_request" ? { kind: "bad_request", detail } : outcome;
}

/**
 * The reading the client keeps: the server's `SheetReading` (with `recognisedType` already set
 * by the diet rules) plus the server timestamp, which is never sent to any model.
 */
function toStoredReading(value: unknown): StoredReading | null {
  const result = StoredReadingSchema.safeParse(value);
  return result.success ? result.data : null;
}

function abortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Settle even when an underlying transport does not react to cancellation. */
function abortable<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T> {
  const aborted = () => new DOMException("Aborted", "AbortError");
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    const clean = () => signal.removeEventListener("abort", onAbort);
    try {
      Promise.resolve(call()).then(
        (value) => {
          clean();
          if (signal.aborted) reject(aborted());
          else resolve(value);
        },
        (error: unknown) => { clean(); reject(error); },
      );
    } catch (error) { clean(); reject(error); }
  });
}

/**
 * Sends one to six downscaled pages to `/api/read`. Progress arrives immediately; cards are
 * committed only after the complete reading and its card associations have been validated.
 */
export async function readSheet(
  images: ImageInput[],
  handlers: ReadHandlers = {},
): Promise<ReadOutcome> {
  const controller = new AbortController();
  let phase: "submitting" | "processing" = "submitting";
  let timedOut = false;
  let cancelled = handlers.signal?.aborted === true;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const onAbort = () => {
    cancelled = true;
    controller.abort();
    void activeReader?.cancel().catch(() => {});
  };
  if (handlers.signal) {
    handlers.signal.addEventListener("abort", onAbort, { once: true });
  }
  const watchdog = setTimeout(() => {
    timedOut = true;
    controller.abort();
    void activeReader?.cancel().catch(() => {});
  }, READ_SUBMISSION_TIMEOUT_MS);
  let processingWatchdog: ReturnType<typeof setTimeout> | null = null;
  const stopWatchdogs = () => {
    clearTimeout(watchdog);
    if (processingWatchdog !== null) clearTimeout(processingWatchdog);
    handlers.signal?.removeEventListener("abort", onAbort);
  };
  if (cancelled) {
    stopWatchdogs();
    controller.abort();
    return { kind: "cancelled" };
  }
  let response: Response;
  try {
    response = await abortable(controller.signal, () => fetch("/api/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only the pixels. No profile, no dialect, no identifier (FR-019).
      body: JSON.stringify({ images }),
      signal: controller.signal,
    }));
  } catch (error) {
    stopWatchdogs();
    if (cancelled || handlers.signal?.aborted) return { kind: "cancelled" };
    if (timedOut || abortError(error)) return { kind: "timed_out" };
    return { kind: "model_unavailable" };
  }

  if (!response.ok) {
    try {
      return await abortable(controller.signal, () => errorOutcome(response));
    } catch {
      return cancelled ? { kind: "cancelled" } : { kind: "timed_out" };
    } finally {
      stopWatchdogs();
    }
  }
  if (!response.body) {
    stopWatchdogs();
    return { kind: "model_unavailable" };
  }

  // One holder object rather than five `let`s: the parser writes to it from a closure, and
  // TypeScript keeps the declared types honest across the reader loop that way.
  const state: {
    cards: Card[];
    reading: StoredReading | null;
    filter: FilterCounts | null;
    declined: boolean;
    failure: ReadOutcome | null;
  } = { cards: [], reading: null, filter: null, declined: false, failure: null };

  const reader = response.body.getReader();
  activeReader = reader;
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string): void => {
    if (controller.signal.aborted) return;
    const parsed = parseEvent(line);
    if (!parsed) return;
    switch (parsed.event) {
      case "status":
        {
          const nextPhase = parsed.phase ?? "reading";
          if (phase === "submitting" && nextPhase === "reading") {
            phase = "processing";
            clearTimeout(watchdog);
            processingWatchdog = setTimeout(
              () => {
                timedOut = true;
                controller.abort();
                void reader.cancel().catch(() => {});
              },
              READ_PROCESSING_TIMEOUT_MS + READ_RESPONSE_GRACE_MS,
            );
          }
          handlers.onStatus?.(nextPhase);
        }
        break;
      case "card":
        {
          const result = CardSchema.safeParse(parsed.card);
          if (!result.success) {
            state.failure = { kind: "invalid_reading" };
            break;
          }
          state.cards.push(result.data);
          handlers.onCard?.(result.data);
        }
        break;
      case "unknown":
        state.declined = true;
        break;
      case "done":
        state.reading = toStoredReading(parsed.reading);
        state.filter = parsed.filter ?? null;
        break;
      case "error":
        state.failure = outcomeForError(parsed.error, response.status);
        break;
    }
  };

  try {
    for (;;) {
      const { done, value } = await abortable(controller.signal, () => reader.read());
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const split = splitLines(buffer);
        buffer = split.rest;
        for (const line of split.lines) handleLine(line);
      }
      if (done) break;
    }
    buffer += decoder.decode();
    const tail = splitLines(`${buffer}\n`);
    for (const line of tail.lines) handleLine(line);
  } catch {
    // The stream broke mid-reading. Anything already shown stays; the outcome is honest.
    if (cancelled || handlers.signal?.aborted) return { kind: "cancelled" };
    if (timedOut) return { kind: "timed_out" };
    return state.failure ?? { kind: "model_unavailable" };
  } finally {
    stopWatchdogs();
    activeReader = null;
    try {
      reader.releaseLock();
    } catch {
      // A canceled reader may already have released its lock.
    }
  }

  if (cancelled) return { kind: "cancelled" };
  if (timedOut) return { kind: "timed_out" };
  if (state.failure) return state.failure;
  if (state.declined) return { kind: "unknown" };
  if (!state.reading) return { kind: "invalid_reading" };
  const cards = validateReadingCards(state.reading, state.cards);
  if (!cards) return { kind: "invalid_reading" };
  return { kind: "reading", reading: state.reading, cards, filter: state.filter };
}
