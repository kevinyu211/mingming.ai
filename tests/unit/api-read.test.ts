/**
 * Unit tests for `POST /api/read`. `getModelProvider` is mocked and the route is driven with a
 * plain `Request`, so nothing reaches the network and no API key is needed. The real error classes
 * are kept (the module is spread, not replaced) so the route's `instanceof` mapping is exercised
 * for real rather than against look-alikes.
 *
 * The interesting property is *when* the response becomes a stream: a failure before the first
 * text delta is an HTTP status, a failure after it is the last line of a 200.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImageInput } from "@/lib/model/client";
import type { SheetReading } from "@/lib/domain/schemas";

const { providerMock } = vi.hoisted(() => ({
  providerMock: {
    readSheet: vi.fn(),
    readSheetStream: vi.fn(),
    answer: vi.fn(),
    phrase: vi.fn(),
  },
}));

vi.mock("@/lib/model/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/model/client")>();
  return { ...actual, getModelProvider: () => providerMock };
});

const { POST } = await import("@/app/api/read/route");
const { ModelOutputError, ModelRefusalError, ModelUnavailableError } = await import(
  "@/lib/model/client"
);

/* -------------------------------------------------------------------------- */
/* Fixtures and helpers                                                       */
/* -------------------------------------------------------------------------- */

const HK_EN: SheetReading = JSON.parse(
  readFileSync(path.join(process.cwd(), "fixtures/sheets/hk_en.expected.json"), "utf8"),
) as SheetReading;

function fixture(): SheetReading {
  return JSON.parse(JSON.stringify(HK_EN)) as SheetReading;
}

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  model: "stub",
  ms: 0,
};

const IMAGE: ImageInput = { mediaType: "image/jpeg", base64: "QUJDRA==" };

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/read", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

type Event = Record<string, unknown>;

async function events(response: Response): Promise<Event[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Event);
}

/** The default: one text delta (which opens the stream), then a clean reading. */
function respondWith(reading: SheetReading, delta = "{") {
  providerMock.readSheetStream.mockImplementation(
    async (_images: ImageInput[], onPartialText?: (delta: string) => void) => {
      onPartialText?.(delta);
      return { reading, usage: USAGE };
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => vi.useRealTimers());

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("POST /api/read — success", () => {
  it("streams status, heartbeat, cards in fixed order, then done", async () => {
    respondWith(fixture(), "abc");

    const response = await POST(post({ images: [IMAGE] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const lines = await events(response);
    expect(lines[0]).toEqual({ event: "status", phase: "reading" });
    // Character count only — never the text itself (principle V).
    expect(lines[1]).toEqual({ event: "status", phase: "reading", chars: 3 });

    const cards = lines.filter((line) => line.event === "card");
    expect(cards.map((line) => (line.card as { type: string }).type)).toEqual([
      "warning",
      "warning",
      "warning",
      "medicine",
      "medicine",
      "medicine",
      "followUp",
      "diet",
      "activity",
    ]);

    const done = lines.at(-1) as {
      event: string;
      reading: { dietLine: { recognisedType: string }; readAt: string };
      filter: unknown;
    };
    expect(done.event).toBe("done");
    expect(done.filter).toEqual({ regenerated: 0, templated: 0 });
    expect(done.reading.dietLine.recognisedType).toBe("low_salt");
    expect(Date.parse(done.reading.readAt)).not.toBeNaN();

    expect(providerMock.readSheetStream).toHaveBeenCalledTimes(1);
    expect(providerMock.readSheetStream.mock.calls[0][0]).toEqual([IMAGE]);
  });

  it("emits a single unknown event and nothing else for an unrecognised sheet", async () => {
    respondWith({
      sheetType: "unknown",
      warningSigns: [],
      medicines: [],
      followUp: [],
      dietLine: null,
      activityLine: null,
      hospitalContact: null,
      unreadable: [],
    });

    const response = await POST(post({ images: [IMAGE] }));
    const lines = await events(response);

    expect(response.status).toBe(200);
    expect(lines.map((line) => line.event)).toEqual(["status", "status", "status", "unknown"]);
  });

  it("reports the filter counts when a card had to be re-phrased", async () => {
    const reading = fixture();
    reading.medicines[0].spoken = {
      yue: "用嚟治療。",
      cmn: "用来治疗。",
      en: "This is what treats it.",
    };
    respondWith(reading);

    providerMock.phrase.mockResolvedValue({
      result: {
        spoken: {
          yue: "藥名 Amlodipine，5mg。",
          cmn: "药名 Amlodipine，5mg。",
          en: "The sheet lists Amlodipine, 5mg.",
        },
      },
      usage: USAGE,
    });

    const lines = await events(await POST(post({ images: [IMAGE] })));
    const done = lines.at(-1) as { event: string; filter: unknown };

    expect(providerMock.phrase).toHaveBeenCalledTimes(1);
    expect(done.event).toBe("done");
    expect(done.filter).toEqual({ regenerated: 1, templated: 0 });
  });

  it("accepts two pages", async () => {
    respondWith(fixture());
    const response = await POST(post({ images: [IMAGE, { ...IMAGE, mediaType: "image/png" }] }));
    expect(response.status).toBe(200);
    expect(providerMock.readSheetStream.mock.calls[0][0]).toHaveLength(2);
  });

  /**
   * The whole stack. A Hong Kong patient is discharged carrying 出院紙, 覆診紙, 繳費單, 病假紙,
   * 抽血紙 and 治療處方 (docs/real-sheet-evidence.md), and the follow-up date is printed on a
   * different page from the medicines — so six pages in one read is the ordinary case, not an
   * edge case, and every page must reach the model.
   */
  it("accepts six pages, and passes every one of them to the model", async () => {
    respondWith(fixture());
    const stack = Array.from({ length: 6 }, () => IMAGE);
    const response = await POST(post({ images: stack }));
    expect(response.status).toBe(200);
    expect(providerMock.readSheetStream.mock.calls[0][0]).toHaveLength(6);
  });
});

/**
 * The red flags ahead of the reading. The JSON is written warnings-first, so each one is complete
 * in the stream long before the medicines are; the route sends it the moment it is, and sends it
 * again with the final set. What is asserted: the order, that the early copy IS the final copy,
 * that a warning the filter would repair waits for the repair, and that an unusable reading takes
 * its early warnings back with it.
 */
describe("POST /api/read — early warning cards", () => {
  /** Streams the reading's own JSON in small deltas, then settles with it (or throws). */
  function streamed(reading: SheetReading, settle: () => { reading: SheetReading; usage: typeof USAGE }) {
    return async (_images: ImageInput[], onPartialText?: (delta: string) => void) => {
      const text = JSON.stringify(reading);
      for (let i = 0; i < text.length; i += 64) onPartialText?.(text.slice(i, i + 64));
      return settle();
    };
  }

  it("sends each warning as soon as its JSON is complete, ahead of checking and the final cards", async () => {
    const reading = fixture();
    providerMock.readSheetStream.mockImplementation(streamed(reading, () => ({ reading, usage: USAGE })));

    const lines = await events(await POST(post({ images: [IMAGE] })));
    const kinds = lines.map((line) =>
      line.event === "card" ? (line.early === true ? "early" : "card") : (line.event as string),
    );
    expect(kinds.slice(0, 5)).toEqual(["status", "status", "early", "early", "early"]);
    expect(kinds.indexOf("early")).toBeLessThan(kinds.indexOf("card"));
    expect(kinds.filter((k) => k === "early")).toHaveLength(3);
    // The checking status separates the stream from the validated set.
    const checking = lines.findIndex((line) => line.event === "status" && line.phase === "checking");
    expect(checking).toBeGreaterThan(kinds.lastIndexOf("early"));
    expect(checking).toBeLessThan(kinds.indexOf("card"));
    expect(lines.at(-1)?.event).toBe("done");

    // The dedupe contract: one early copy per id, and it is the final copy, byte for byte.
    const early = lines.filter((line) => line.event === "card" && line.early === true);
    const final = lines.filter((line) => line.event === "card" && line.early !== true);
    const ids = early.map((line) => (line.card as { id: string }).id);
    expect(ids).toEqual(["warning-0", "warning-1", "warning-2"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const line of early) {
      const match = final.find((f) => (f.card as { id: string }).id === (line.card as { id: string }).id);
      expect(match?.card).toEqual(line.card);
    }
    // Still every final card, in the fixed order, exactly as before.
    expect(final.map((line) => (line.card as { id: string }).id).slice(0, 4)).toEqual([
      "warning-0",
      "warning-1",
      "warning-2",
      "medicine-0",
    ]);
    expect(lines.some((line) => line.event === "retract")).toBe(false);

    // The one log line carries the count, never a card.
    const logged = vi.mocked(console.info).mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(logged.early).toBe(3);
    expect(JSON.stringify(logged)).not.toContain("胸口痛");
  });

  it("holds back a warning the filter would repair, and lets the final pass say it", async () => {
    const reading = fixture();
    reading.warningSigns[1].action.en = "you must go straight back to A&E";
    providerMock.readSheetStream.mockImplementation(streamed(reading, () => ({ reading, usage: USAGE })));
    providerMock.phrase.mockRejectedValue(new Error("no phrasing today"));

    const lines = await events(await POST(post({ images: [IMAGE] })));
    const early = lines.filter((line) => line.event === "card" && line.early === true);
    expect(early.map((line) => (line.card as { id: string }).id)).toEqual(["warning-0", "warning-2"]);
    const final = lines.filter((line) => line.event === "card" && line.early !== true);
    const repaired = final.find((line) => (line.card as { id: string }).id === "warning-1");
    expect(repaired).toBeDefined();
    expect((repaired?.card as { aiGenerated: boolean }).aiGenerated).toBe(false);
    expect((lines.at(-1) as { filter: unknown }).filter).toEqual({ regenerated: 0, templated: 1 });
  });

  it("retracts the early warnings of an unusable reading before the retry, and before the error", async () => {
    const reading = fixture();
    providerMock.readSheetStream
      .mockImplementationOnce(streamed(reading, () => { throw new ModelOutputError("schema"); }))
      .mockImplementationOnce(streamed(reading, () => ({ reading, usage: USAGE })));

    const lines = await events(await POST(post({ images: [IMAGE] })));
    const kinds = lines.map((line) =>
      line.event === "card" ? (line.early === true ? "early" : "card") : (line.event as string),
    );
    const retractAt = kinds.indexOf("retract");
    expect(retractAt).toBeGreaterThan(kinds.indexOf("early"));
    expect(lines[retractAt]).toEqual({ event: "retract", ids: ["warning-0", "warning-1", "warning-2"] });
    // The retry starts its own progress line and its own early cards after the retraction.
    expect(kinds.slice(retractAt + 1, retractAt + 5)).toEqual(["status", "early", "early", "early"]);
    expect(lines.at(-1)?.event).toBe("done");

    providerMock.readSheetStream.mockImplementation(streamed(reading, () => { throw new ModelOutputError("schema"); }));
    const failed = await events(await POST(post({ images: [IMAGE] })));
    expect(failed.filter((line) => line.event === "retract")).toHaveLength(2);
    expect(failed.at(-2)).toEqual({ event: "retract", ids: ["warning-0", "warning-1", "warning-2"] });
    expect(failed.at(-1)).toEqual({ event: "error", error: "invalid_reading" });
  });

  it("sends nothing early for a sheet that printed no warning signs", async () => {
    const reading = fixture();
    reading.warningSigns = [];
    providerMock.readSheetStream.mockImplementation(streamed(reading, () => ({ reading, usage: USAGE })));
    const lines = await events(await POST(post({ images: [IMAGE] })));
    expect(lines.some((line) => line.event === "card" && line.early === true)).toBe(false);
    expect((lines.find((line) => line.event === "card")?.card as { id: string }).id).toBe("no-warnings");
  });
});

describe("POST /api/read — request validation", () => {
  it("rejects a declared oversize body with 413 before reading it", async () => {
    const response = await POST(
      post({ images: [IMAGE] }, { "content-length": String(9 * 1024 * 1024) }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
    expect(providerMock.readSheetStream).not.toHaveBeenCalled();
  });

  it("rejects an actually oversize body with 413", async () => {
    const huge = "A".repeat(9 * 1024 * 1024);
    const response = await POST(post({ images: [{ ...IMAGE, base64: huge }] }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
    expect(providerMock.readSheetStream).not.toHaveBeenCalled();
  });

  it.each([
    ["no images", { images: [] }],
    // Seven. Six is a whole Hong Kong discharge stack and is accepted; the seventh is refused
    // here so that `components/Capture.tsx` has to refuse it on screen rather than post it and
    // discover the ceiling after the user has done the work (tests/unit/page-limit.test.ts).
    ["seven images", { images: [IMAGE, IMAGE, IMAGE, IMAGE, IMAGE, IMAGE, IMAGE] }],
    ["an unsupported media type", { images: [{ mediaType: "image/gif", base64: "x" }] }],
    ["an empty base64 string", { images: [{ mediaType: "image/jpeg", base64: "" }] }],
    ["an extra field", { images: [IMAGE], dialect: "yue" }],
    ["a missing images field", {}],
  ])("rejects %s with 400", async (_name, body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);

    const json = (await response.json()) as { error: string; detail: string };
    expect(json.error).toBe("bad_request");
    expect(json.detail).toMatch(/^[A-Za-z0-9_.:-]+$/);
    expect(providerMock.readSheetStream).not.toHaveBeenCalled();
  });

  it("never echoes a submitted key back in the detail", async () => {
    const response = await POST(post({ images: [IMAGE], patientName: "Chan Tai Man" }));
    const json = (await response.json()) as { detail: string };
    expect(response.status).toBe(400);
    expect(json.detail).not.toContain("patientName");
    expect(json.detail).not.toContain("Chan");
  });

  it("rejects a body that is not JSON with 400", async () => {
    const response = await POST(post("not json at all"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_request", detail: "invalid_json" });
  });
});

describe("POST /api/read — model failures", () => {
  it("times out a stalled read at the shared deadline and aborts the provider", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    providerMock.readSheetStream.mockImplementation(async (_images: ImageInput[], _on, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return await new Promise<never>(() => {});
    });
    const response = await POST(post({ images: [IMAGE] }));
    const result = events(response);
    await vi.advanceTimersByTimeAsync(240_000);
    const lines = await result;
    expect(lines.at(-1)).toEqual({ event: "error", error: "timed_out" });
    expect(lines.some((line) => line.event === "done")).toBe(false);
    expect(providerMock.readSheetStream).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not call the provider for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await POST(new Request("http://localhost/api/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [IMAGE] }),
      signal: controller.signal,
    }));
    expect(providerMock.readSheetStream).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect((await events(response)).at(-1)).toEqual({ event: "error", error: "cancelled" });
  });

  it("does not retry invalid output when less than five seconds remain", async () => {
    vi.useFakeTimers();
    providerMock.readSheetStream.mockImplementation(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 236_000));
      throw new ModelOutputError("schema");
    });
    const response = await POST(post({ images: [IMAGE] }));
    const result = events(response);
    await vi.advanceTimersByTimeAsync(236_000);
    const lines = await result;
    expect(lines.at(-1)).toEqual({ event: "error", error: "timed_out" });
    expect(providerMock.readSheetStream).toHaveBeenCalledTimes(1);
    expect(lines.some((line) => line.event === "done")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an uncooperative read when the client cancels the stream", async () => {
    let signal: AbortSignal | undefined;
    providerMock.readSheetStream.mockImplementation(async (_images: ImageInput[], _on?: (delta: string) => void, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return await new Promise<never>(() => {});
    });
    const response = await POST(post({ images: [IMAGE] }));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal?.aborted).toBe(true);
  });

  it("retries once on an unusable reading, then answers 422", async () => {
    providerMock.readSheetStream.mockRejectedValue(new ModelOutputError("schema"));

    const response = await POST(post({ images: [IMAGE] }));
    expect(response.status).toBe(200);
    expect((await events(response)).at(-1)).toEqual({ event: "error", error: "invalid_reading" });
    expect(providerMock.readSheetStream).toHaveBeenCalledTimes(2);
  });

  it("recovers when the retry succeeds", async () => {
    providerMock.readSheetStream
      .mockRejectedValueOnce(new ModelOutputError("invalid_json"))
      .mockResolvedValueOnce({ reading: fixture(), usage: USAGE });

    const response = await POST(post({ images: [IMAGE] }));
    expect(response.status).toBe(200);
    expect((await events(response)).at(-1)?.event).toBe("done");
  });

  it("answers 502 when the model is unreachable, without retrying", async () => {
    providerMock.readSheetStream.mockRejectedValue(new ModelUnavailableError(503));

    const response = await POST(post({ images: [IMAGE] }));
    expect(response.status).toBe(200);
    expect((await events(response)).at(-1)).toEqual({ event: "error", error: "model_unavailable" });
    expect(providerMock.readSheetStream).toHaveBeenCalledTimes(1);
  });

  it("answers 502 on a refusal", async () => {
    providerMock.readSheetStream.mockRejectedValue(new ModelRefusalError("policy"));

    const response = await POST(post({ images: [IMAGE] }));
    expect(response.status).toBe(200);
    expect((await events(response)).at(-1)).toEqual({ event: "error", error: "model_unavailable" });
  });

  it("sends an error event as the last line when the stream already started", async () => {
    providerMock.readSheetStream.mockImplementation(
      async (_images: ImageInput[], onPartialText?: (delta: string) => void) => {
        onPartialText?.("partial");
        throw new ModelUnavailableError(500);
      },
    );

    const response = await POST(post({ images: [IMAGE] }));
    // The status is already spent by the time the failure happens.
    expect(response.status).toBe(200);

    const lines = await events(response);
    expect(lines.map((line) => line.event)).toEqual(["status", "status", "error"]);
    expect(lines.at(-1)).toEqual({ event: "error", error: "model_unavailable" });
  });
});
