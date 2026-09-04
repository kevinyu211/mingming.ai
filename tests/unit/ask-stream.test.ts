/**
 * Unit tests for the `/api/ask` client (`lib/client/ask-stream.ts`).
 *
 * `fetch` is replaced with a stub that answers from a `ReadableStream` whose chunks deliberately
 * cut lines in half — and one that cuts a Chinese character in half — because that is what a
 * real streamed response does and it is the single most likely way this parser breaks.
 *
 * The first test is the privacy one: the request body must carry exactly `reading`, `question`
 * and `dialect`, and the question exactly `text` and `inputLanguage` (FR-019, constitution
 * principle V). It is asserted on the key sets, not on a snapshot, so a new field anywhere
 * upstream fails the test instead of silently shipping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SheetReading, SourceReference, Speakable } from "@/lib/domain/schemas";
import { REFERRAL, REFERRAL_RESOURCES } from "@/lib/i18n/referral";
import { NOT_ON_SHEET, REFUSED_MEDICINE_CHANGE } from "@/lib/rules/template-fallback";
import { ASK_ENDPOINT, ask, type AskRequest } from "@/lib/client/ask-stream";

/* -------------------------------------------------------------------------- */
/* Canned data                                                                */
/* -------------------------------------------------------------------------- */

const SOURCE: SourceReference = {
  section: "Discharge Medication(s) & Follow-up Plan",
  lineIndex: 2,
  quote: "3. Atorvastatin 20mg 1 tab nocte",
};

const ANSWER: Speakable = {
  yue: "張紙寫住，白色嗰粒 Atorvastatin 20mg，每晚一次。",
  cmn: "纸上写着，白色那粒 Atorvastatin 20mg，每晚一次。",
  en: "The sheet says the white one is Atorvastatin 20mg, once at night.",
};

const READING: SheetReading = {
  sheetType: "hk_en",
  warningSigns: [],
  medicines: [
    {
      name: "Atorvastatin",
      strength: "20mg",
      amount: "1 tab",
      frequency: "nocte",
      duration: null,
      status: "current",
      spoken: ANSWER,
      source: SOURCE,
    },
  ],
  followUp: [],
  dietLine: null,
  activityLine: null,
  hospitalContact: null,
  unreadable: [],
};

const REQUEST: AskRequest = {
  reading: READING,
  question: { text: "白色嗰粒係朝早定夜晚食？", inputLanguage: "yue" },
  dialect: "yue",
};

/* -------------------------------------------------------------------------- */
/* fetch stubs                                                                */
/* -------------------------------------------------------------------------- */

/** A response body that hands out the given chunks one `read()` at a time. */
function streamOf(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index];
      index += 1;
      controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    },
  });
}

function ok(chunks: readonly (string | Uint8Array)[]): Response {
  return new Response(streamOf(chunks), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function errorResponse(status: number, error?: string): Response {
  return new Response(error === undefined ? null : JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

/** The parsed body of the nth call. */
function sentBody(call = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Request shape: the privacy contract                                        */
/* -------------------------------------------------------------------------- */

describe("the request", () => {
  it("carries exactly reading, question and dialect, and nothing else", async () => {
    fetchMock.mockResolvedValue(ok(['{"event":"outcome","outcome":"not_on_sheet"}\n']));

    await ask(REQUEST);

    const body = sentBody();
    expect(Object.keys(body).sort()).toEqual(["dialect", "question", "reading"]);
    expect(Object.keys(body.question as object).sort()).toEqual(["inputLanguage", "text"]);
    expect(body.dialect).toBe("yue");
    expect(body.reading).toEqual(READING);
  });

  it("drops fields a caller adds to the question or the top level", async () => {
    fetchMock.mockResolvedValue(ok(['{"event":"outcome","outcome":"not_on_sheet"}\n']));

    const leaky = {
      ...REQUEST,
      question: { ...REQUEST.question, label: "阿媽", askedAt: "2026-09-02T12:00:00Z" },
      label: "阿媽",
      plan: { items: [] },
    } as unknown as AskRequest;

    await ask(leaky);

    const body = sentBody();
    expect(Object.keys(body).sort()).toEqual(["dialect", "question", "reading"]);
    expect(Object.keys(body.question as object).sort()).toEqual(["inputLanguage", "text"]);
    expect(JSON.stringify(body)).not.toContain("阿媽");
  });

  it("posts JSON to /api/ask and passes the abort signal through", async () => {
    fetchMock.mockResolvedValue(ok(['{"event":"outcome","outcome":"not_on_sheet"}\n']));
    const controller = new AbortController();

    await ask(REQUEST, { signal: controller.signal });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ASK_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.signal).toBe(controller.signal);
  });

  it("never writes the question or the answer to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    fetchMock.mockResolvedValue(
      ok([
        '{"event":"outcome","outcome":"answered","citedCardId":"medicine-0"}\n',
        `{"event":"answer","answer":${JSON.stringify(ANSWER)}}\n`,
        '{"event":"done"}\n',
      ]),
    );

    await ask(REQUEST);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Streaming                                                                  */
/* -------------------------------------------------------------------------- */

describe("the NDJSON stream", () => {
  it("parses events whose lines are split across chunks", async () => {
    fetchMock.mockResolvedValue(
      ok([
        '{"event":"outcome","outcome":"answ',
        'ered","citedCardId":"medicine-0","source":',
        `${JSON.stringify(SOURCE)}}\n{"event":"ans`,
        `wer","answer":${JSON.stringify(ANSWER).slice(0, 20)}`,
        `${JSON.stringify(ANSWER).slice(20)}}\n`,
        '{"event":"done"}\n',
      ]),
    );

    const outcomes: string[] = [];
    const answers: Speakable[] = [];
    const result = await ask(REQUEST, {
      onOutcome: (event) => outcomes.push(event.outcome),
      onAnswer: (answer) => answers.push(answer),
    });

    expect(result).toEqual({
      outcome: "answered",
      citedCardId: "medicine-0",
      source: SOURCE,
      answer: ANSWER,
    });
    expect(outcomes).toEqual(["answered"]);
    expect(answers).toEqual([ANSWER]);
  });

  it("parses a multi-byte character split across the chunk boundary", async () => {
    const line = `{"event":"answer","answer":${JSON.stringify(ANSWER)}}\n`;
    const bytes = new TextEncoder().encode(line);
    // Cut inside the three-byte encoding of a Chinese character.
    const cut = 40;
    fetchMock.mockResolvedValue(
      ok([
        '{"event":"outcome","outcome":"answered","citedCardId":"medicine-0"}\n',
        bytes.slice(0, cut),
        bytes.slice(cut),
      ]),
    );

    const result = await ask(REQUEST);

    expect(result.answer).toEqual(ANSWER);
  });

  it("reads several events out of one chunk, and a last line with no newline", async () => {
    fetchMock.mockResolvedValue(
      ok([
        '{"event":"outcome","outcome":"answered","citedCardId":"medicine-0"}\n' +
          `{"event":"answer","answer":${JSON.stringify(ANSWER)}}\n` +
          '{"event":"done"}',
      ]),
    );

    const result = await ask(REQUEST);

    expect(result.outcome).toBe("answered");
    expect(result.answer).toEqual(ANSWER);
  });

  it("ignores blank lines and lines that are not JSON", async () => {
    fetchMock.mockResolvedValue(
      ok([
        "\n",
        "not json at all\n",
        '{"event":"outcome","outcome":"answered","citedCardId":"medicine-0"}\n',
        "\n",
        `{"event":"answer","answer":${JSON.stringify(ANSWER)}}\n`,
      ]),
    );

    const result = await ask(REQUEST);

    expect(result.outcome).toBe("answered");
    expect(result.answer).toEqual(ANSWER);
  });
});

/* -------------------------------------------------------------------------- */
/* Outcomes                                                                   */
/* -------------------------------------------------------------------------- */

describe("outcomes", () => {
  it("keeps the server's refusal template when one is sent", async () => {
    fetchMock.mockResolvedValue(
      ok([
        '{"event":"outcome","outcome":"refused_medicine_change"}\n',
        `{"event":"answer","answer":${JSON.stringify(REFUSED_MEDICINE_CHANGE)}}\n`,
        '{"event":"done"}\n',
      ]),
    );

    const result = await ask(REQUEST);

    expect(result.outcome).toBe("refused_medicine_change");
    expect(result.answer).toEqual(REFUSED_MEDICINE_CHANGE);
  });

  it("falls back to the fixed template when an outcome arrives with no sentence", async () => {
    fetchMock.mockResolvedValue(ok(['{"event":"outcome","outcome":"not_on_sheet"}\n']));

    const answers: Speakable[] = [];
    const result = await ask(REQUEST, { onAnswer: (a) => answers.push(a) });

    expect(result.outcome).toBe("not_on_sheet");
    expect(result.answer).toEqual(NOT_ON_SHEET);
    expect(answers).toEqual([NOT_ON_SHEET]);
  });

  it("builds the referral list on the client for a crisis outcome", async () => {
    fetchMock.mockResolvedValue(ok(['{"event":"outcome","outcome":"crisis_referral"}\n']));

    const result = await ask({
      ...REQUEST,
      question: { text: "…", inputLanguage: "en" },
    });

    expect(result.outcome).toBe("crisis_referral");
    expect(result.referral?.text).toBe(REFERRAL.en);
    expect(result.referral?.resources).toEqual(REFERRAL_RESOURCES);
    expect(result.answer).toBeUndefined();
  });

  it("ignores an outcome the contract does not define", async () => {
    fetchMock.mockResolvedValue(ok(['{"event":"outcome","outcome":"diagnosed"}\n']));

    const result = await ask(REQUEST);

    expect(result.outcome).toBe("model_unavailable");
  });
});

/* -------------------------------------------------------------------------- */
/* Failures                                                                   */
/* -------------------------------------------------------------------------- */

describe("failures", () => {
  it("maps 400 to bad_request", async () => {
    fetchMock.mockResolvedValue(errorResponse(400, "bad_request"));

    const failures: string[] = [];
    const result = await ask(REQUEST, { onFailure: (o) => failures.push(o) });

    expect(result).toEqual({ outcome: "bad_request" });
    expect(failures).toEqual(["bad_request"]);
  });

  it("maps 502 to model_unavailable", async () => {
    fetchMock.mockResolvedValue(errorResponse(502, "model_unavailable"));

    const result = await ask(REQUEST);

    expect(result).toEqual({ outcome: "model_unavailable" });
  });

  it("maps any other error status to model_unavailable, body or no body", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500));
    expect((await ask(REQUEST)).outcome).toBe("model_unavailable");

    fetchMock.mockResolvedValueOnce(errorResponse(429, "rate_limited"));
    expect((await ask(REQUEST)).outcome).toBe("model_unavailable");
  });

  it("maps an error event in the stream to its outcome", async () => {
    fetchMock.mockResolvedValue(
      ok([
        '{"event":"outcome","outcome":"answered","citedCardId":"medicine-0"}\n',
        '{"event":"error","error":"model_unavailable"}\n',
      ]),
    );

    const result = await ask(REQUEST);

    expect(result).toEqual({ outcome: "model_unavailable" });
  });

  it("treats a network throw as model_unavailable rather than rejecting", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(ask(REQUEST)).resolves.toEqual({ outcome: "model_unavailable" });
  });

  it("treats a stream that says nothing as model_unavailable", async () => {
    fetchMock.mockResolvedValue(ok([]));

    const result = await ask(REQUEST);

    expect(result).toEqual({ outcome: "model_unavailable" });
  });

  it("treats a stream that breaks before any outcome as model_unavailable", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"event":"out'));
            controller.error(new Error("connection reset"));
          },
        }),
        { status: 200 },
      ),
    );

    await expect(ask(REQUEST)).resolves.toEqual({ outcome: "model_unavailable" });
  });
});
