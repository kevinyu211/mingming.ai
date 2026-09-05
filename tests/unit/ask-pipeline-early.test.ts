/**
 * The early sentence: `/api/ask` hands the reader's own spoken form to the phone the moment it has
 * closed its quote, and every gate the full answer passes is applied to it first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import hkEnFixture from "../../fixtures/sheets/hk_en.expected.json";
import type { EarlyAnswer, ModelProvider, UsageSummary } from "../../lib/model/client";
import { ModelUnavailableError } from "../../lib/model/client";
import { buildCards } from "../../lib/rules/card-order";
import {
  AskModelUnavailableError,
  AskReadingSchema,
  earlyGate,
  runAsk,
  type AskEvent,
  type AskRequest,
} from "../../lib/server/ask-pipeline";

const reading = AskReadingSchema.parse(hkEnFixture);
const cards = buildCards(reading);

const USAGE: UsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  model: "mock",
  ms: 1,
};

const CLEAN = {
  yue: "張紙寫住 Amlodipine 5mg，每日一次。",
  cmn: "纸上写着 Amlodipine 5mg，每天一次。",
  en: "The sheet says Amlodipine 5mg, once a day.",
};

const answer = vi.fn<NonNullable<ModelProvider["answer"]>>();
const answerStream = vi.fn<NonNullable<ModelProvider["answerStream"]>>();
const phrase = vi.fn<ModelProvider["phrase"]>();

const provider: ModelProvider = {
  readSheet: vi.fn<ModelProvider["readSheet"]>(),
  readSheetStream: vi.fn<ModelProvider["readSheetStream"]>(),
  answer,
  answerStream,
  phrase,
};

function request(dialect: AskRequest["dialect"] = "yue"): AskRequest {
  return { reading, question: { text: "幾時食 Amlodipine？", inputLanguage: "yue" }, dialect };
}

async function collect(input: AskRequest = request()) {
  const events: AskEvent[] = [];
  for await (const event of runAsk(input, { provider })) events.push(event);
  return events;
}

/** A provider whose stream reports `early` first, then settles with `final` (or throws). */
function streaming(early: EarlyAnswer | null, final: () => unknown) {
  answerStream.mockImplementation(async (_input, onEarly) => {
    if (early !== null) onEarly?.(early);
    await Promise.resolve();
    const result = final();
    return { result: result as Awaited<ReturnType<ModelProvider["answer"]>>["result"], usage: USAGE };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the early sentence", () => {
  it("is sent before the outcome, and the final answer carries the same string", async () => {
    streaming(
      { kind: "sheet", citedCardIds: ["medicine-0"], text: CLEAN.yue },
      () => ({ kind: "sheet", citedCardIds: ["medicine-0"], answer: CLEAN }),
    );
    const events = await collect();

    expect(events.map((event) => event.event)).toEqual(["early", "outcome", "answer", "done"]);
    expect(events[0]).toEqual({ event: "early", dialect: "yue", outcome: "answered", text: CLEAN.yue });
    expect(events[2]).toEqual({ event: "answer", answer: CLEAN });
    expect(answer).not.toHaveBeenCalled();
  });

  it("is sent for a general explanation as `explained`", async () => {
    streaming(
      { kind: "general", citedCardIds: [], text: "空腹即係冇食嘢。" },
      () => ({ kind: "general", citedCardIds: [], answer: { yue: "空腹即係冇食嘢。", cmn: "空腹就是没吃东西。", en: "Fasting means not having eaten." } }),
    );
    const events = await collect();
    expect(events[0]).toEqual({ event: "early", dialect: "yue", outcome: "explained", text: "空腹即係冇食嘢。" });
    expect(events[1]).toEqual({ event: "outcome", outcome: "explained" });
  });

  it("stays what was said when a banned term in another language sends the answer through phrase", async () => {
    const dirtyElsewhere = { ...CLEAN, en: "This one treats high blood pressure." };
    streaming(
      { kind: "sheet", citedCardIds: ["medicine-0"], text: CLEAN.yue },
      () => ({ kind: "sheet", citedCardIds: ["medicine-0"], answer: dirtyElsewhere }),
    );
    const rephrased = {
      yue: "張紙寫住 Amlodipine 5mg，每日一次。（重寫）",
      cmn: "纸上写着 Amlodipine 5mg，每天一次。（重写）",
      en: "The sheet says Amlodipine 5mg, once a day (rewritten).",
    };
    phrase.mockResolvedValue({ result: { spoken: rephrased }, usage: USAGE });

    const events = await collect();
    const final = events.find((event) => event.event === "answer");
    expect(phrase).toHaveBeenCalledTimes(1);
    expect(final).toEqual({ event: "answer", answer: { ...rephrased, yue: CLEAN.yue } });
  });

  it("uses the plain answer path when the provider has no stream", async () => {
    const plain: ModelProvider = { ...provider, answerStream: undefined };
    answer.mockResolvedValue({
      result: { kind: "sheet", citedCardIds: ["medicine-0"], answer: CLEAN },
      usage: USAGE,
    });
    const events: AskEvent[] = [];
    for await (const event of runAsk(request(), { provider: plain })) events.push(event);
    expect(events.map((event) => event.event)).toEqual(["outcome", "answer", "done"]);
  });

  it("becomes a 502 when the stream breaks after the sentence was sent", async () => {
    streaming({ kind: "sheet", citedCardIds: ["medicine-0"], text: CLEAN.yue }, () => {
      throw new ModelUnavailableError(503);
    });
    const events: AskEvent[] = [];
    await expect(async () => {
      for await (const event of runAsk(request(), { provider })) events.push(event);
    }).rejects.toBeInstanceOf(AskModelUnavailableError);
    // The sentence went out before the break; the route turns the throw into an in-band error.
    expect(events).toEqual([{ event: "early", dialect: "yue", outcome: "answered", text: CLEAN.yue }]);
  });
});

describe("the early gates", () => {
  it("refuse a sentence with a banned term, and the full path still repairs it", async () => {
    streaming(
      { kind: "sheet", citedCardIds: ["medicine-0"], text: "呢隻藥係用嚟治療高血壓嘅。" },
      () => ({
        kind: "sheet",
        citedCardIds: ["medicine-0"],
        answer: { yue: "呢隻藥係用嚟治療高血壓嘅。", cmn: "这个药是用来治疗高血压的。", en: "This one treats high blood pressure." },
      }),
    );
    phrase.mockResolvedValue({ result: { spoken: CLEAN }, usage: USAGE });
    const events = await collect();
    expect(events.map((event) => event.event)).toEqual(["outcome", "answer", "done"]);
    expect(events[1]).toEqual({ event: "answer", answer: CLEAN });
  });

  it("refuse a sheet answer that cites nothing this server built", () => {
    expect(earlyGate({ kind: "sheet", citedCardIds: ["not-a-card"], text: CLEAN.yue }, cards)).toBeNull();
    expect(earlyGate({ kind: "sheet", citedCardIds: null, text: CLEAN.yue }, cards)).toBeNull();
    expect(earlyGate({ kind: "sheet", citedCardIds: ["medicine-0"], text: CLEAN.yue }, cards)).toEqual({
      outcome: "answered",
      text: CLEAN.yue,
    });
  });

  it("refuse `none`, blanks and a number about the person", () => {
    expect(earlyGate({ kind: "none", citedCardIds: [], text: "x" }, cards)).toBeNull();
    expect(earlyGate({ kind: "general", citedCardIds: [], text: "   " }, cards)).toBeNull();
    expect(earlyGate({ kind: "general", citedCardIds: [], text: "你應該食 2 粒。" }, cards)).toBeNull();
  });

  it("send nothing early when the stream settles before any sentence", async () => {
    streaming(null, () => ({ kind: "sheet", citedCardIds: ["medicine-0"], answer: CLEAN }));
    const events = await collect();
    expect(events.map((event) => event.event)).toEqual(["outcome", "answer", "done"]);
  });
});
