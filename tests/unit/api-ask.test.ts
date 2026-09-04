/**
 * Route tests for `POST /api/ask` (T024).
 *
 * The handler is called with a real `Request` and its NDJSON body is read back, so what is
 * asserted is the wire format the client parses: one JSON object per line, in order.
 * `lib/model/client` is mocked at the module level (the route resolves the provider itself), with
 * the real error classes kept so the 502 path is exercised for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import hkEnFixture from "../../fixtures/sheets/hk_en.expected.json";
import { REFERRAL } from "../../lib/i18n/referral";
import { buildCards } from "../../lib/rules/card-order";
import { NOT_ON_SHEET, REFUSED_MEDICINE_CHANGE } from "../../lib/rules/template-fallback";
import { AskReadingSchema } from "../../lib/server/ask-pipeline";

const { answerMock, phraseMock } = vi.hoisted(() => ({
  answerMock: vi.fn(),
  phraseMock: vi.fn(),
}));

vi.mock("@/lib/model/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/model/client")>();
  return {
    ...actual,
    getModelProvider: () => ({
      readSheet: vi.fn(),
      readSheetStream: vi.fn(),
      answer: answerMock,
      phrase: phraseMock,
    }),
  };
});

const { POST } = await import("@/app/api/ask/route");
const { ModelUnavailableError } = await import("@/lib/model/client");

/* ------------------------------------------------------------------ fixtures */

const reading = AskReadingSchema.parse(hkEnFixture);
const medicine0 = buildCards(reading).find((card) => card.id === "medicine-0");

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  model: "mock",
  ms: 1,
};

const ANSWER = {
  yue: "張紙寫住 Amlodipine 5mg，每日一次。",
  cmn: "纸上写着 Amlodipine 5mg，每天一次。",
  en: "The sheet says Amlodipine 5mg, once a day.",
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function askBody(text: string, inputLanguage: "yue" | "cmn" | "en" = "yue") {
  return { reading, question: { text, inputLanguage }, dialect: "yue" };
}

/** Read the whole body and split it back into events; the client parses the same lines. */
async function events(response: Response): Promise<unknown[]> {
  return (await response.text())
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  infoSpy.mockRestore();
});

/* -------------------------------------------------------------- happy path */

describe("POST /api/ask", () => {
  it("streams outcome, answer and done as newline-delimited JSON", async () => {
    answerMock.mockResolvedValue({
      result: { grounded: true, citedCardIds: ["medicine-0"], answer: ANSWER },
      usage: USAGE,
    });

    const response = await POST(post(askBody("白色嗰粒係朝早定夜晚食？")));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await events(response)).toEqual([
      {
        event: "outcome",
        outcome: "answered",
        citedCardIds: ["medicine-0"],
        sources: [medicine0?.source],
      },
      { event: "answer", answer: ANSWER },
      { event: "done" },
    ]);
  });

  it("logs one line carrying the outcome and a duration, and nothing from the body", async () => {
    answerMock.mockResolvedValue({
      result: { grounded: true, citedCardIds: ["medicine-0"], answer: ANSWER },
      usage: USAGE,
    });

    const response = await POST(post(askBody("白色嗰粒係朝早定夜晚食？")));
    await response.text();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith({
      route: "ask",
      outcome: "answered",
      ms: expect.any(Number),
    });
    // Nothing from the question, the sheet or the answer reaches the log.
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain("白色");
    expect(logged).not.toContain("Amlodipine");
  });

  it("returns the crisis referral without reaching the model", async () => {
    const response = await POST(post(askBody("我唔想再活落去。")));

    expect(response.status).toBe(200);
    const stream = await events(response);
    expect(stream[0]).toMatchObject({
      event: "outcome",
      outcome: "crisis_referral",
      referral: { text: REFERRAL.yue },
    });
    expect(stream[stream.length - 1]).toEqual({ event: "done" });
    expect(answerMock).not.toHaveBeenCalled();
  });

  it("returns the medicine-change refusal without reaching the model", async () => {
    const response = await POST(post(askBody("可唔可以唔食呢隻藥？")));

    expect(await events(response)).toEqual([
      { event: "outcome", outcome: "refused_medicine_change" },
      { event: "answer", answer: REFUSED_MEDICINE_CHANGE },
      { event: "done" },
    ]);
    expect(answerMock).not.toHaveBeenCalled();
  });

  it("streams not_on_sheet when the model's citation cannot be verified", async () => {
    answerMock.mockResolvedValue({
      result: { grounded: true, citedCardIds: ["medicine-99"], answer: ANSWER },
      usage: USAGE,
    });

    const response = await POST(post(askBody("佢可以食咩水果？")));

    expect(await events(response)).toEqual([
      { event: "outcome", outcome: "not_on_sheet" },
      { event: "answer", answer: NOT_ON_SHEET },
      { event: "done" },
    ]);
  });
});

/* ------------------------------------------------------------- bad requests */

describe("request validation", () => {
  it("rejects an extra top-level key with 400 and never calls the model", async () => {
    const response = await POST(post({ ...askBody("白色嗰粒點食？"), label: "阿媽" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_request" });
    expect(answerMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects an empty question and an over-long one", async () => {
    expect((await POST(post(askBody("")))).status).toBe(400);
    expect((await POST(post(askBody("字".repeat(501))))).status).toBe(400);
  });

  it("rejects an unknown dialect", async () => {
    const response = await POST(post({ ...askBody("白色嗰粒點食？"), dialect: "fr" }));

    expect(response.status).toBe(400);
  });

  it("accepts en as a dialect, now that every card is spoken in English too", async () => {
    const response = await POST(post({ ...askBody("白色嗰粒點食？"), dialect: "en" }));

    expect(response.status).toBe(200);
  });
});

/* -------------------------------------------------------------- model down */

describe("model failures", () => {
  it("answers 502 model_unavailable when the provider cannot be reached", async () => {
    answerMock.mockRejectedValue(new ModelUnavailableError(503));

    const response = await POST(post(askBody("白色嗰粒點食？")));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "model_unavailable" });
    expect(infoSpy).toHaveBeenCalledWith({
      route: "ask",
      outcome: "model_unavailable",
      ms: expect.any(Number),
    });
  });
});
