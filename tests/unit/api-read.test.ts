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
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(lines.map((line) => line.event)).toEqual(["status", "status", "unknown"]);
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
    ["three images", { images: [IMAGE, IMAGE, IMAGE] }],
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
  it("retries once on an unusable reading, then answers 422", async () => {
    providerMock.readSheetStream.mockRejectedValue(new ModelOutputError("schema"));

    const response = await POST(post({ images: [IMAGE] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_reading" });
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
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "model_unavailable" });
    expect(providerMock.readSheetStream).toHaveBeenCalledTimes(1);
  });

  it("answers 502 on a refusal", async () => {
    providerMock.readSheetStream.mockRejectedValue(new ModelRefusalError("policy"));

    const response = await POST(post({ images: [IMAGE] }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "model_unavailable" });
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
