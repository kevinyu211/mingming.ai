/**
 * `POST /api/read` — contracts/api-read.md.
 *
 * HTTP only: parse, size-check, stream, map errors to statuses. Every safety gate lives in
 * `lib/server/reading-pipeline.ts`; every model call lives in `lib/model/client.ts`.
 *
 * Streaming and status codes pull against each other, so the route is explicit about the moment it
 * commits: `NdjsonBuffer` queues the first `status` line, the read starts, and the response only
 * becomes a stream when the model produces its first text delta. Fail before that — a refusal, an
 * outage, two unusable readings — and nothing has been flushed, so the client gets 422 or 502 and
 * can fall back to the bundled sample sheet (FR-024). Fail after it and the last line is
 * `{"event":"error","error":"…"}`, because the status is already 200 on the wire.
 *
 * Privacy (constitution V, contracts/api-read.md § Server guarantees): the decoded image never
 * leaves this function's scope — no module state, no disk, no cache. Nothing logs a request or
 * response body; the one permitted line carries timing, status and the filter counts only. The
 * `detail` on a 400 is built from this file's own schema (an issue code and a field path), never
 * from the submitted value.
 */
import { z } from "zod";

import type { Card, StoredReading } from "@/lib/domain/schemas";
import {
  ModelError,
  ModelOutputError,
  ModelRefusalError,
  ModelRequestError,
  ModelUnavailableError,
  getModelProvider,
  type ImageInput,
  type ModelProvider,
} from "@/lib/model/client";
import { NdjsonBuffer, jsonError, ndjsonResponse } from "@/lib/server/ndjson";
import { runReadingPipeline, type FilterCounts } from "@/lib/server/reading-pipeline";

export const runtime = "nodejs";
/**
 * Six pages of a discharge stack take materially longer than one. The live stress runs on a single
 * dense page sat at 45–105 s (tests/eval/stress.md), so the old 120 s ceiling would have timed out
 * a full stack before the model finished reading it.
 */
export const maxDuration = 300;

/** contracts/api-read.md: "Request body limit 8 MB." */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * How many pages one read may carry. Must equal `MAX_PAGES` in `components/Capture.tsx`, which
 * `tests/unit/page-limit.test.ts` pins — a client that accepts more pages than the route does is
 * a silently truncated medical document, which is the one thing the capture screen must never do.
 *
 * Six, not two, because a Hong Kong patient does not leave with one sheet. The Hospital Authority's
 * own HKWC discharge checklist (docs/reference/, and docs/real-sheet-evidence.md) tells the patient
 * to carry 出院紙, 覆診紙, 繳費單, 病假紙, 抽血紙 and 治療處方 — the follow-up date is printed on a
 * different piece of paper from the medicines. A two-page limit reads a third of the discharge.
 *
 * The body limit still holds: `lib/image/downscale.ts` lands each page at roughly 200–400 KB, so
 * six encode to about 1.6–3.2 MB against the 8 MB ceiling.
 */
const MAX_PAGES = 6;

/**
 * At most one progress line per 1.5 s. The first delta always beats, so the client learns the read
 * has started instead of watching a blank screen for the length of a 16k-token reply.
 */
const HEARTBEAT_MS = 1500;

const ImageSchema = z.strictObject({
  mediaType: z.enum(["image/jpeg", "image/png"]),
  base64: z.string().min(1),
});

/** One page up to a whole stack. No other fields: the profile and dialect are never sent (principle V). */
const ReadRequestSchema = z.strictObject({
  images: z.array(ImageSchema).min(1).max(MAX_PAGES),
});

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

type ReadEvent =
  | { event: "status"; phase: "reading"; chars?: number }
  | { event: "card"; card: Card }
  | { event: "unknown" }
  | { event: "done"; reading: StoredReading; filter: FilterCounts }
  | { event: "error"; error: string };

const STATUS_READING: ReadEvent = { event: "status", phase: "reading" };

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  let logged = false;
  const log = (status: number, filter: FilterCounts | null, code?: string): void => {
    if (logged) return;
    logged = true;
    // Codes only, never a body: `code` is our own error class's identifier plus, for a rejected
    // request, the HTTP status the provider gave us. Without it a 502 is unattributable, and
    // "the model refused" and "that model does not accept this parameter" look identical.
    console.info({ route: "read", status, ms: Date.now() - startedAt, filter, code });
  };
  const fail = (status: number, body: { error: string; detail?: string }): Response => {
    log(status, null, body.error);
    return jsonError(status, body);
  };

  // Cheap rejection first: a client that declares an oversized body is turned away before it is
  // read into memory.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, { error: "too_large" });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail(400, { error: "bad_request", detail: "unreadable_body" });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return fail(413, { error: "too_large" });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, { error: "bad_request", detail: "invalid_json" });
  }

  const parsed = ReadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, { error: "bad_request", detail: detailFor(parsed.error) });
  }

  const images: ImageInput[] = parsed.data.images;

  // Defence in depth. Base64 always inflates, so the body check above dominates in practice; this
  // is the check that still holds if the body is ever read as a stream instead of a string.
  const decodedBytes = images.reduce((total, image) => total + base64Bytes(image.base64), 0);
  if (decodedBytes > MAX_BODY_BYTES) {
    return fail(413, { error: "too_large" });
  }

  const provider = getModelProvider();
  const buffer = new NdjsonBuffer();
  // A plain object, not `let` bindings: values written inside the worker are read after an await,
  // where narrowing on a closure-assigned local would be wrong.
  const outcome: { failure: unknown; filter: FilterCounts | null } = {
    failure: null,
    filter: null,
  };

  const worker = (async () => {
    buffer.emit(STATUS_READING);
    try {
      const { reading } = await readWithOneRetry(provider, images, buffer);
      const result = await runReadingPipeline(reading, provider);

      if (result.kind === "unknown") {
        buffer.emit({ event: "unknown" });
        return;
      }
      // Fixed order, warning signs first — a property of lib/rules/card-order.ts (principle II).
      for (const card of result.cards) buffer.emit({ event: "card", card });
      outcome.filter = result.filter;
      buffer.emit({ event: "done", reading: result.reading, filter: result.filter });
    } catch (error) {
      outcome.failure = error;
      // Already streaming: the status is spent, so the failure goes out as the last line.
      if (buffer.isOpen) buffer.emit({ event: "error", error: codeFor(error) });
    } finally {
      buffer.close();
    }
  })();

  // Resolves at the first heartbeat, or when the worker finished without ever producing one.
  await buffer.opened;

  if (!buffer.isOpen && outcome.failure !== null) {
    const failure = outcome.failure;
    const detail =
      failure instanceof ModelError
        ? `${failure.code}${"status" in failure && failure.status ? `:${failure.status}` : ""}`
        : "unknown";
    log(statusFor(failure), null, detail);
    return jsonError(statusFor(failure), { error: codeFor(failure) });
  }

  void worker.then(() => log(200, outcome.filter));
  return ndjsonResponse(buffer.stream());
}

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One retry, and only for an unusable reply (contracts/api-read.md: 422 "after one retry"). An
 * outage or a refusal is not retried here — the SDK already retried the transport, and a second
 * refusal would cost the user another 20 s to learn the same thing.
 */
async function readWithOneRetry(
  provider: ModelProvider,
  images: ImageInput[],
  buffer: NdjsonBuffer,
): Promise<{ reading: Awaited<ReturnType<ModelProvider["readSheet"]>>["reading"] }> {
  try {
    return await provider.readSheetStream(images, heartbeat(buffer));
  } catch (error) {
    if (!(error instanceof ModelOutputError)) throw error;
    return await provider.readSheetStream(images, heartbeat(buffer));
  }
}

/**
 * Counts characters, never keeps them. A fresh counter per attempt, so a retry restarts the
 * client's progress indicator instead of doubling it.
 */
function heartbeat(buffer: NdjsonBuffer): (delta: string) => void {
  let chars = 0;
  let lastAt = 0;
  return (delta: string) => {
    chars += delta.length;
    const now = Date.now();
    if (now - lastAt < HEARTBEAT_MS) return;
    lastAt = now;
    buffer.emit({ event: "status", phase: "reading", chars });
    buffer.markOpen();
  };
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** The client can only ever fall back, so everything that is not an unusable reading is 502. */
function statusFor(error: unknown): number {
  return error instanceof ModelOutputError ? 422 : 502;
}

function codeFor(error: unknown): string {
  if (error instanceof ModelOutputError) return "invalid_reading";
  if (
    error instanceof ModelUnavailableError ||
    error instanceof ModelRefusalError ||
    error instanceof ModelRequestError
  ) {
    return "model_unavailable";
  }
  return "model_unavailable";
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A short machine code for the client's log, assembled from this file's own schema: the issue code
 * and, when there is one, the field path. Never the submitted value — an unrecognised key reports
 * its code with an empty path rather than naming the key.
 */
function detailFor(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "invalid";
  const path = issue.path.map((segment) => String(segment)).join(".");
  const detail = path.length > 0 ? `${issue.code}:${path}` : issue.code;
  return detail.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 48);
}

/** Decoded byte count of a base64 string, computed without allocating the bytes. */
function base64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(value.length / 4) * 3 - padding);
}
