import { afterEach, describe, expect, it, vi } from "vitest";
import { readSheet, splitLines, type ImageInput } from "@/lib/client/read-stream";
import type { Card } from "@/lib/domain/schemas";

const images: ImageInput[] = [{ mediaType: "image/jpeg", base64: "AAAA" }];

const card = (id: string, type: Card["type"] = "warning"): Card => ({
  id,
  type,
  body: { yue: `${id} 嘅內容`, cmn: `${id} 的内容`, en: `the ${id} line` },
  source: { section: "Follow-up Plan", lineIndex: 4, quote: "Return to A&E immediately" },
  aiGenerated: true,
});

const reading = {
  sheetType: "hk_en",
  warningSigns: [],
  medicines: [{ name: "Amlodipine" }],
  followUp: [],
  dietLine: null,
  activityLine: null,
  hospitalContact: null,
  unreadable: [],
};

/** A response whose body arrives in exactly these chunks, so line splits can be placed by hand. */
function streamed(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status });
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(response: Response | (() => Promise<Response>)): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (typeof response === "function" ? response() : response)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("splitLines", () => {
  it("keeps the tail after the last newline", () => {
    expect(splitLines('{"a":1}\n{"b":2}\n{"c"')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      rest: '{"c"',
    });
  });

  it("drops blank lines", () => {
    expect(splitLines("a\n\n  \nb\n").lines).toEqual(["a", "b"]);
  });
});

describe("readSheet", () => {
  it("parses NDJSON split across chunk boundaries", async () => {
    const line = (value: unknown) => `${JSON.stringify(value)}\n`;
    const whole =
      line({ event: "status", phase: "reading" }) +
      line({ event: "card", card: card("warning-0") }) +
      line({ event: "card", card: card("medicine-0", "medicine") }) +
      line({ event: "done", reading, filter: { regenerated: 1, templated: 0 } });

    // Cut the stream at three awkward places: mid-key, mid-value and right on a newline.
    const chunks = [whole.slice(0, 17), whole.slice(17, 130), whole.slice(130, 320), whole.slice(320)];
    mockFetch(streamed(chunks));

    const phases: string[] = [];
    const arrived: string[] = [];
    const outcome = await readSheet(images, {
      onStatus: (phase) => phases.push(phase),
      onCard: (c) => arrived.push(c.id),
    });

    expect(phases).toEqual(["reading"]);
    expect(arrived).toEqual(["warning-0", "medicine-0"]);
    expect(outcome.kind).toBe("reading");
    if (outcome.kind !== "reading") throw new Error("expected a reading");
    expect(outcome.cards.map((c) => c.id)).toEqual(["warning-0", "medicine-0"]);
    expect(outcome.filter).toEqual({ regenerated: 1, templated: 0 });
    expect(outcome.reading.sheetType).toBe("hk_en");
    // The timestamp is set here, on the client, and never sent to a model.
    expect(Number.isNaN(Date.parse(outcome.reading.readAt))).toBe(false);
  });

  it("accepts a final line with no trailing newline", async () => {
    mockFetch(
      streamed([
        `${JSON.stringify({ event: "card", card: card("warning-0") })}\n`,
        JSON.stringify({ event: "done", reading }),
      ]),
    );
    const outcome = await readSheet(images);
    expect(outcome.kind).toBe("reading");
  });

  it("sends only the images, never a profile or a dialect", async () => {
    mockFetch(streamed([`${JSON.stringify({ event: "done", reading })}\n`]));
    await readSheet(images);
    const call = vi.mocked(fetch).mock.calls[0];
    const init = call[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ images });
  });

  it("declines a photo that is not a discharge sheet", async () => {
    mockFetch(streamed([`${JSON.stringify({ event: "unknown" })}\n`]));
    const seen: Card[] = [];
    const outcome = await readSheet(images, { onCard: (c) => seen.push(c) });
    expect(outcome).toEqual({ kind: "unknown" });
    expect(seen).toHaveLength(0);
  });

  it("reports an in-stream error event", async () => {
    mockFetch(
      streamed([
        `${JSON.stringify({ event: "card", card: card("warning-0") })}\n`,
        `${JSON.stringify({ event: "error", error: "model_unavailable" })}\n`,
      ]),
    );
    expect(await readSheet(images)).toEqual({ kind: "model_unavailable" });
  });

  it("treats a stream that ends without done as an unreadable sheet", async () => {
    mockFetch(streamed([`${JSON.stringify({ event: "card", card: card("warning-0") })}\n`]));
    expect(await readSheet(images)).toEqual({ kind: "invalid_reading" });
  });

  it("ignores a line that is not JSON", async () => {
    mockFetch(streamed(["not json\n", `${JSON.stringify({ event: "done", reading })}\n`]));
    expect((await readSheet(images)).kind).toBe("reading");
  });

  it.each([
    [400, { error: "bad_request", detail: "two pages max" }, "bad_request"],
    [413, { error: "too_large" }, "too_large"],
    [422, { error: "invalid_reading" }, "invalid_reading"],
    [502, { error: "model_unavailable" }, "model_unavailable"],
  ])("maps %i to a typed outcome", async (status, body, kind) => {
    mockFetch(errorResponse(status, body));
    expect((await readSheet(images)).kind).toBe(kind);
  });

  it("keeps the detail from a 400", async () => {
    mockFetch(errorResponse(400, { error: "bad_request", detail: "two pages max" }));
    expect(await readSheet(images)).toEqual({ kind: "bad_request", detail: "two pages max" });
  });

  it("falls back to the status code when the error body is empty", async () => {
    mockFetch(new Response(null, { status: 413 }));
    expect((await readSheet(images)).kind).toBe("too_large");
  });

  it("treats an unreachable route as the model being unavailable", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await readSheet(images)).toEqual({ kind: "model_unavailable" });
  });
});
