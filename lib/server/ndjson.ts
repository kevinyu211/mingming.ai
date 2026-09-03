/**
 * SERVER ONLY. NDJSON plumbing for the streaming routes (contracts/api-read.md § Response).
 *
 * `/api/read` has to do two things that pull against each other: send progress lines while the
 * model is still reading, and still be able to answer 422 / 502 with a real HTTP status when the
 * read fails before anything was sent. Once a body byte is flushed the status is fixed, so the
 * route needs to decide *when* the response becomes a stream.
 *
 * `NdjsonBuffer` is that decision point. Events emitted before `stream()` is called are queued in
 * memory; `markOpen()` is the explicit "we now want the client to see progress" signal, and
 * `opened` resolves either on that signal or when the producer closes. A route therefore awaits
 * `opened` once: if the buffer opened, it returns the streamed response and any later failure goes
 * out as an in-stream `error` line; if it closed without opening, the whole exchange is still
 * un-flushed and the route is free to return a plain JSON error with the right status.
 *
 * Nothing here inspects or logs event content — it only serialises and enqueues (principle V).
 */

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

const encoder = new TextEncoder();

/** One newline-delimited JSON line. */
export function encodeNdjsonLine(event: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

/**
 * A write-ahead buffer in front of one `ReadableStream`. Safe to emit into before, during and
 * after the stream exists; every enqueue is guarded so a client disconnect can never turn into a
 * thrown error inside the producer.
 */
export class NdjsonBuffer {
  private queued: Uint8Array[] = [];
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private open = false;
  private closed = false;
  private cancelled = false;
  private resolveOpened: () => void = () => {};

  /** Resolves on the first `markOpen()`, or on `close()` if that comes first. */
  readonly opened: Promise<void>;

  constructor() {
    this.opened = new Promise<void>((resolve) => {
      this.resolveOpened = resolve;
    });
  }

  /** True once the producer has asked for the response to become a stream. */
  get isOpen(): boolean {
    return this.open;
  }

  /** True once the producer has finished. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** True once the consumer went away; the producer may stop early. */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** Ask for the response to become a stream now. Idempotent. */
  markOpen(): void {
    if (this.open) return;
    this.open = true;
    this.resolveOpened();
  }

  /** Queue one event. A no-op after `close()` or after the consumer cancelled. */
  emit(event: unknown): void {
    if (this.closed || this.cancelled) return;
    const line = encodeNdjsonLine(event);
    if (this.controller === null) {
      this.queued.push(line);
      return;
    }
    try {
      this.controller.enqueue(line);
    } catch {
      this.cancelled = true;
    }
  }

  /** End the stream. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.controller !== null && !this.cancelled) {
      try {
        this.controller.close();
      } catch {
        this.cancelled = true;
      }
    }
    this.resolveOpened();
  }

  /** The response body. Call once; queued events are flushed as it starts. */
  stream(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        for (const line of this.queued) {
          try {
            controller.enqueue(line);
          } catch {
            this.cancelled = true;
            break;
          }
        }
        this.queued = [];
        if (this.closed && !this.cancelled) {
          try {
            controller.close();
          } catch {
            this.cancelled = true;
          }
        }
      },
      cancel: () => {
        this.cancelled = true;
        this.controller = null;
        this.queued = [];
      },
    });
  }
}

/** 200 with an NDJSON body. Never cached: the body is a reading of someone's discharge sheet. */
export function ndjsonResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": NDJSON_CONTENT_TYPE,
      "cache-control": "no-store",
      // Tells a buffering reverse proxy to pass the chunks through as they are produced.
      "x-accel-buffering": "no",
    },
  });
}

/**
 * The non-streaming sibling used by the same routes: a short error object with a machine code.
 * Bodies built here never carry request content — only fixed codes (contracts/api-read.md
 * § Server guarantees).
 */
export function jsonError(status: number, body: { error: string; detail?: string }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
