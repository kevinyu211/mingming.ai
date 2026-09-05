import { afterEach, describe, expect, it, vi } from "vitest";
import { readSheet, splitLines, type ImageInput } from "@/lib/client/read-stream";
import { READ_PROCESSING_TIMEOUT_MS, READ_RESPONSE_GRACE_MS, READ_SUBMISSION_TIMEOUT_MS } from "@/lib/domain/read-policy";
import { buildCards } from "@/lib/rules/card-order";
import type { StoredReading, Card } from "@/lib/domain/schemas";

const images: ImageInput[] = [{ mediaType: "image/jpeg", base64: "AAAA" }];

const card = (id: string, type: Card["type"] = "warning"): Card => ({
  id,
  type,
  body: { yue: `${id} 嘅內容`, cmn: `${id} 的内容`, en: `the ${id} line` },
  source: { section: "Follow-up Plan", lineIndex: 4, quote: "Return to A&E immediately" },
  aiGenerated: true,
});

const reading: StoredReading = {
  sheetType: "hk_en",
  warningSigns: [],
  medicines: [
    {
      name: "Amlodipine",
      strength: null,
      amount: null,
      frequency: null,
      duration: null,
      status: "current",
      spoken: { yue: "Amlodipine", cmn: "Amlodipine", en: "Amlodipine" },
      source: { section: "Medicines", lineIndex: 0, quote: "Amlodipine" },
    },
  ],
  followUp: [],
  dietLine: null,
  activityLine: null,
  hospitalContact: null,
  unreadable: [],
  readAt: "2026-09-05T00:00:00.000Z",
};

const validCards = buildCards(reading);
const cardLines = validCards.map((card) => `${JSON.stringify({ event: "card", card })}\n`).join("");

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
  vi.useRealTimers();
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
      cardLines +
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
    expect(arrived).toEqual(validCards.map((card) => card.id));
    expect(outcome.kind).toBe("reading");
    if (outcome.kind !== "reading") throw new Error("expected a reading");
    expect(outcome.cards.map((c) => c.id)).toEqual(validCards.map((card) => card.id));
    expect(outcome.filter).toEqual({ regenerated: 1, templated: 0 });
    expect(outcome.reading.sheetType).toBe("hk_en");
    // The timestamp from the server is preserved and never sent to a model.
    expect(Number.isNaN(Date.parse(outcome.reading.readAt))).toBe(false);
  });

  it("accepts a final line with no trailing newline", async () => {
    mockFetch(
      streamed([
        cardLines,
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
    mockFetch(streamed(["not json\n", cardLines, `${JSON.stringify({ event: "done", reading })}\n`]));
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

  it("returns cancelled when the caller aborts while submitting", async () => {
    const controller = new AbortController();
    mockFetch(
      () =>
        new Promise<Response>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          });
        }),
    );
    const pending = readSheet(images, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: "cancelled" });
  });

  it("cancels an uncooperative response body", async () => {
    const controller = new AbortController();
    mockFetch(
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"event":"status","phase":"reading"}\n'));
          },
        }),
        { status: 200 },
      ),
    );
    const pending = readSheet(images, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: "cancelled" });
  });

  it("returns timed_out when processing exceeds the shared deadline", async () => {
    vi.useFakeTimers();
    try {
      mockFetch(
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{"event":"status","phase":"reading"}\n'));
            },
          }),
          { status: 200 },
        ),
      );
      const pending = readSheet(images);
      await vi.advanceTimersByTimeAsync(READ_PROCESSING_TIMEOUT_MS + READ_RESPONSE_GRACE_MS + 1);
      await expect(pending).resolves.toEqual({ kind: "timed_out" });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ["missing card", validCards.slice(1)],
    ["duplicate card", [...validCards, validCards[0]]],
    ["wrong source", validCards.map((card, i) => i === 1 ? { ...card, source: { ...card.source!, quote: "Different sheet" } } : card)],
  ])("rejects a completed reading with %s before persistence", async (_, cards) => {
    mockFetch(streamed([
      ...cards.map((card) => `${JSON.stringify({ event: "card", card })}\n`),
      `${JSON.stringify({ event: "done", reading })}\n`,
    ]));
    expect(await readSheet(images)).toEqual({ kind: "invalid_reading" });
  });

  /**
   * Warnings arrive twice: early, the moment the model has finished writing one, then again with
   * the validated set. The page hears the early one at once and must not hear it twice.
   */
  describe("early warning cards", () => {
    const flagged: StoredReading = {
      ...reading,
      warningSigns: [
        {
          symptom: { yue: "胸口痛", cmn: "胸口痛", en: "chest pain" },
          action: { yue: "即刻返急症室", cmn: "马上去急诊", en: "go straight to A&E" },
          source: { section: "Follow-up Plan", lineIndex: 4, quote: "Return to A&E immediately if chest pain" },
        },
      ],
    };
    const finalCards = buildCards(flagged);
    const warning = finalCards[0];
    const line = (value: unknown) => `${JSON.stringify(value)}\n`;
    const finalLines = finalCards.map((card) => line({ event: "card", card })).join("");

    it("hands an early card over at once, and swallows the identical final copy", async () => {
      mockFetch(streamed([
        line({ event: "status", phase: "reading" }),
        line({ event: "card", card: warning, early: true }),
        line({ event: "status", phase: "checking" }),
        finalLines,
        line({ event: "done", reading: flagged }),
      ]));
      const arrived: [string, boolean][] = [];
      const outcome = await readSheet(images, { onCard: (c, a) => arrived.push([c.id, a.early]) });
      expect(arrived).toEqual([["warning-0", true], ["medicine-0", false]]);
      expect(outcome.kind).toBe("reading");
      if (outcome.kind !== "reading") throw new Error("expected a reading");
      // The final set, once each: no early card survives into what is persisted.
      expect(outcome.cards).toEqual(finalCards);
    });

    it("hands the final copy over again when its content differs, so the page can replace it", async () => {
      const draft: Card = { ...warning, body: { ...warning.body, en: "chest pain, go to A&E" } };
      mockFetch(streamed([
        line({ event: "card", card: draft, early: true }),
        finalLines,
        line({ event: "done", reading: flagged }),
      ]));
      const arrived: [string, boolean, string][] = [];
      const outcome = await readSheet(images, { onCard: (c, a) => arrived.push([c.id, a.early, c.body.en]) });
      expect(arrived).toEqual([
        ["warning-0", true, "chest pain, go to A&E"],
        ["warning-0", false, warning.body.en],
        ["medicine-0", false, finalCards[1].body.en],
      ]);
      if (outcome.kind !== "reading") throw new Error("expected a reading");
      expect(outcome.cards).toEqual(finalCards);
    });

    it("hands a repeated early id over only once", async () => {
      mockFetch(streamed([
        line({ event: "card", card: warning, early: true }),
        line({ event: "card", card: warning, early: true }),
        finalLines,
        line({ event: "done", reading: flagged }),
      ]));
      const onCard = vi.fn();
      await readSheet(images, { onCard });
      expect(onCard.mock.calls.filter(([c]) => (c as Card).id === "warning-0")).toHaveLength(1);
    });

    it("withdraws retracted early cards, and reports the failure that follows", async () => {
      mockFetch(streamed([
        line({ event: "card", card: warning, early: true }),
        line({ event: "retract", ids: ["warning-0"] }),
        line({ event: "error", error: "invalid_reading" }),
      ]));
      const onRetract = vi.fn();
      const onCard = vi.fn();
      expect(await readSheet(images, { onCard, onRetract })).toEqual({ kind: "invalid_reading" });
      expect(onCard).toHaveBeenCalledTimes(1);
      expect(onRetract).toHaveBeenCalledWith(["warning-0"]);
    });

    it("treats a retracted-then-resent warning as new, and its final copy as a duplicate again", async () => {
      mockFetch(streamed([
        line({ event: "card", card: warning, early: true }),
        line({ event: "retract", ids: ["warning-0"] }),
        line({ event: "card", card: warning, early: true }),
        finalLines,
        line({ event: "done", reading: flagged }),
      ]));
      const arrived: [string, boolean][] = [];
      const outcome = await readSheet(images, { onCard: (c, a) => arrived.push([c.id, a.early]) });
      expect(arrived).toEqual([["warning-0", true], ["warning-0", true], ["medicine-0", false]]);
      expect(outcome.kind).toBe("reading");
    });
  });

  it("bounds an uncooperative fetch and clears its timer", async () => {
    vi.useFakeTimers();
    mockFetch(() => new Promise<Response>(() => {}));
    const pending = readSheet(images);
    await vi.advanceTimersByTimeAsync(READ_SUBMISSION_TIMEOUT_MS);
    expect(await pending).toEqual({ kind: "timed_out" });
    expect(vi.getTimerCount()).toBe(0);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("bounds a stalled error response body", async () => {
    vi.useFakeTimers();
    mockFetch(new Response(new ReadableStream({ start() {} }), { status: 413 }));
    const pending = readSheet(images);
    await vi.advanceTimersByTimeAsync(READ_SUBMISSION_TIMEOUT_MS);
    expect(await pending).toEqual({ kind: "timed_out" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not submit or invoke callbacks for an already cancelled read", async () => {
    const controller = new AbortController();
    controller.abort();
    mockFetch(streamed([cardLines, `${JSON.stringify({ event: "done", reading })}\n`]));
    const onCard = vi.fn();
    expect(await readSheet(images, { signal: controller.signal, onCard })).toEqual({ kind: "cancelled" });
    expect(fetch).not.toHaveBeenCalled();
    expect(onCard).not.toHaveBeenCalled();
  });

});
