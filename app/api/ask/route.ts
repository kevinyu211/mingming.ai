/**
 * `POST /api/ask` — one question answered from the cards of the current reading
 * (T024, contracts/api-ask.md).
 *
 * Thin by design: validate, stream, map one error. The gates, the grounding check and the
 * banned-term filter all live in `lib/server/ask-pipeline.ts` so they can be tested without a
 * `Request`.
 *
 * Logging (constitution V): the question, the reading, the optional memory brief and the answer are
 * never written anywhere. The single `console.info` below carries the route, the outcome and a
 * duration — nothing that says what was asked, what is on the sheet, or what the phone remembers.
 *
 * The brief is validated by the same strict schema as everything else (a capped string, nothing
 * more) and is never persisted here: this route reads it, hands it to the model as background, and
 * forgets it. There is no server-side store of any kind.
 */
import {
  AskModelUnavailableError,
  AskRequestSchema,
  runAsk,
  type AskEvent,
} from "@/lib/server/ask-pipeline";
import { encodeNdjsonLine, jsonError, ndjsonResponse } from "@/lib/server/ndjson";

/** The provider adapter is Node-only (it holds the API key and uses the Anthropic SDK). */
export const runtime = "nodejs";

/** A read plus an answer plus one rephrase; 60s is the ceiling, not the target. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  let logged = false;

  /** One line per request, at most. Never called with anything derived from the body's content. */
  const log = (outcome: string): void => {
    if (logged) return;
    logged = true;
    console.info({ route: "ask", outcome, ms: Date.now() - startedAt });
  };

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    log("bad_request");
    return jsonError(400, { error: "bad_request" });
  }

  // Strict at every level: an extra top-level key (a relationship label, a plan, a date) is a
  // privacy failure, not a field to ignore.
  const parsed = AskRequestSchema.safeParse(payload);
  if (!parsed.success) {
    log("bad_request");
    return jsonError(400, { error: "bad_request" });
  }

  const events = runAsk(parsed.data)[Symbol.asyncIterator]();

  // The first event is pulled before the response is built, so a model outage — which always
  // happens before anything has been emitted — becomes a 502 the client can act on rather than an
  // error event inside a 200.
  let pending: IteratorResult<AskEvent> | null;
  try {
    pending = await events.next();
  } catch (error) {
    if (error instanceof AskModelUnavailableError) {
      log("model_unavailable");
      return jsonError(502, { error: "model_unavailable" });
    }
    log("error");
    throw error;
  }

  let outcome = "unknown";
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let step: IteratorResult<AskEvent>;
      try {
        step = pending ?? (await events.next());
        pending = null;
      } catch {
        // The stream has already started, so the status line is spent: say so in-band.
        controller.enqueue(encodeNdjsonLine({ event: "error", error: "model_unavailable" }));
        controller.close();
        log("model_unavailable");
        return;
      }

      if (step.done) {
        controller.close();
        log(outcome);
        return;
      }

      if (step.value.event === "outcome") outcome = step.value.outcome;
      controller.enqueue(encodeNdjsonLine(step.value));
    },
    cancel() {
      // The phone navigated away or the user asked something else; stop the generator.
      void events.return?.(undefined);
      log(outcome);
    },
  });

  return ndjsonResponse(stream);
}
