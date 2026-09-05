/**
 * The three conversational kinds `/api/ask` gained in 1.2.0 — `chat`, `off_topic`, `boundary` —
 * the printed-number exemption, and the early/final agreement the live 「空腹係咩意思？」 failure
 * showed was missing (early=explained, final=not_on_sheet, from one English word).
 *
 * Same shape as ask-pipeline.test.ts: a mocked provider, the `hk_en` fixture, and assertions on
 * the event stream. The fixture gains one warning sign that prints a threshold, as the
 * heart-failure sheet does, so the number rules can be exercised against a real card id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import hkEnFixture from "../../fixtures/sheets/hk_en.expected.json";
import type { EarlyAnswer, ModelProvider, UsageSummary } from "../../lib/model/client";
import { checkSpeakable } from "../../lib/rules/banned-terms";
import { buildCards } from "../../lib/rules/card-order";
import {
  BOUNDARY,
  NOT_ON_SHEET,
  OFF_TOPIC,
  SMALL_TALK,
} from "../../lib/rules/template-fallback";
import {
  AskReadingSchema,
  earlyGate,
  runAsk,
  type AskEvent,
  type AskRequest,
} from "../../lib/server/ask-pipeline";

const base = AskReadingSchema.parse(hkEnFixture);

/** The fixture plus a warning sign with a printed threshold, exactly as a real sheet prints one. */
const reading = AskReadingSchema.parse({
  ...base,
  warningSigns: [
    ...base.warningSigns,
    {
      symptom: {
        yue: "血糖低過 4.0 mmol/L 而且冒汗",
        cmn: "血糖低于 4.0 mmol/L 而且冒汗",
        en: "Blood sugar below 4.0 mmol/L with sweating",
      },
      action: { yue: "即刻去急症室", cmn: "马上去急诊", en: "go straight to A&E" },
      source: {
        section: "Warning signs",
        lineIndex: 4,
        quote: "Blood sugar below 4.0 mmol/L with sweating — return to A&E",
      },
    },
  ],
});
const cards = buildCards(reading);
const SUGAR = `warning-${reading.warningSigns.length - 1}`;
const sugarCard = cards.find((card) => card.id === SUGAR);
const warning0 = cards.find((card) => card.id === "warning-0");

const USAGE: UsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  model: "mock",
  ms: 1,
};

const HELLO = {
  yue: "我幾好呀！想繼續講張紙嘅嘢嗎？",
  cmn: "我挺好的！想继续讲纸上的内容吗？",
  en: "I'm good, thanks! Shall we carry on with the sheet?",
};
const MATHS = {
  yue: "哈，數學唔係我強項，我淨係識睇出院紙。",
  cmn: "哈，数学不是我的强项，我只会看出院纸。",
  en: "Ha — sums aren't my thing; I only do the discharge sheet.",
};
const DIZZY = {
  yue: "正唔正常我話唔到你知，要問醫生。張紙寫住如果胸口痛就要即刻返急症室。",
  cmn: "正不正常我说不了，要问医生。纸上写着如果胸口痛就要马上回急诊。",
  en: "Whether that's normal isn't mine to say — that's for the doctor. The sheet says to go straight back to A&E if there's chest pain.",
};
/** Advice in every language: what a reply must never be, whichever kind it claims. */
const ADVICE = {
  yue: "你應該食多啲。",
  cmn: "你应该吃多点。",
  en: "You should eat more.",
};

const answer = vi.fn<ModelProvider["answer"]>();
const answerStream = vi.fn<NonNullable<ModelProvider["answerStream"]>>();
const phrase = vi.fn<ModelProvider["phrase"]>();

const provider: ModelProvider = {
  readSheet: vi.fn<ModelProvider["readSheet"]>(),
  readSheetStream: vi.fn<ModelProvider["readSheetStream"]>(),
  answer,
  phrase,
};
const streamingProvider: ModelProvider = { ...provider, answerStream };

function request(text: string, dialect: AskRequest["dialect"] = "yue"): AskRequest {
  return { reading, question: { text, inputLanguage: dialect }, dialect };
}

async function collect(text: string, using: ModelProvider = provider): Promise<AskEvent[]> {
  const events: AskEvent[] = [];
  for await (const event of runAsk(request(text), { provider: using })) events.push(event);
  return events;
}

/** A provider whose stream reports `early` first, then settles with `final`. */
function streaming(early: EarlyAnswer | null, final: () => unknown): void {
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

/* ---------------------------------------------------------------- chat, off_topic */

describe("a greeting and an off-topic request each get their own reply", () => {
  it("answers a greeting in kind, citing nothing", async () => {
    answer.mockResolvedValue({ result: { kind: "chat", citedCardIds: [], answer: HELLO }, usage: USAGE });

    expect(await collect("hi ming, how are you?")).toEqual([
      { event: "outcome", outcome: "chat" },
      { event: "answer", answer: HELLO },
      { event: "done" },
    ]);
    expect(phrase).not.toHaveBeenCalled();
  });

  it("redirects an off-topic request with the model's own line", async () => {
    answer.mockResolvedValue({ result: { kind: "off_topic", citedCardIds: [], answer: MATHS }, usage: USAGE });

    expect(await collect("15乘12係幾多？")).toEqual([
      { event: "outcome", outcome: "off_topic" },
      { event: "answer", answer: MATHS },
      { event: "done" },
    ]);
  });

  it("falls to the fixed sentence when the model's wording trips the filter", async () => {
    answer.mockResolvedValue({ result: { kind: "chat", citedCardIds: [], answer: ADVICE }, usage: USAGE });
    expect(await collect("hi")).toEqual([
      { event: "outcome", outcome: "chat" },
      { event: "answer", answer: SMALL_TALK },
      { event: "done" },
    ]);

    answer.mockResolvedValue({ result: { kind: "off_topic", citedCardIds: [], answer: ADVICE }, usage: USAGE });
    expect(await collect("tell me a joke")).toEqual([
      { event: "outcome", outcome: "off_topic" },
      { event: "answer", answer: OFF_TOPIC },
      { event: "done" },
    ]);
    // Neither kind has a card to rephrase from, so the repair call is never made.
    expect(phrase).not.toHaveBeenCalled();
  });

  it("ignores a citation on a kind that cites nothing", async () => {
    answer.mockResolvedValue({
      result: { kind: "chat", citedCardIds: ["medicine-0"], answer: HELLO },
      usage: USAGE,
    });
    const [outcome] = await collect("thanks!");
    expect(outcome).toEqual({ event: "outcome", outcome: "chat" });
  });
});

/* ------------------------------------------------------------------- boundary */

describe("a judgement about the person is handed to the doctor", () => {
  it("cites the cards it quotes, every id verified", async () => {
    answer.mockResolvedValue({
      result: { kind: "boundary", citedCardIds: ["warning-0", "not-a-card"], answer: DIZZY },
      usage: USAGE,
    });

    expect(await collect("我今日有啲頭暈，正唔正常？")).toEqual([
      { event: "outcome", outcome: "boundary", citedCardIds: ["warning-0"], sources: [warning0?.source] },
      { event: "answer", answer: DIZZY },
      { event: "done" },
    ]);
  });

  it("stands without a citation, because the closest card may be none", async () => {
    answer.mockResolvedValue({ result: { kind: "boundary", citedCardIds: [], answer: DIZZY }, usage: USAGE });

    const [outcome] = await collect("我最近好攰，係咪個病嘅問題？");
    expect(outcome).toEqual({ event: "outcome", outcome: "boundary", citedCardIds: [], sources: [] });
  });

  it("falls to the fixed sentence, citing nothing, when the wording fails the filter", async () => {
    answer.mockResolvedValue({
      result: { kind: "boundary", citedCardIds: ["warning-0"], answer: ADVICE },
      usage: USAGE,
    });

    expect(await collect("我成日咁攰，係咪正常？")).toEqual([
      { event: "outcome", outcome: "boundary", citedCardIds: [], sources: [] },
      { event: "answer", answer: BOUNDARY },
      { event: "done" },
    ]);
    expect(phrase).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------ printed numbers */

describe("a number the page prints is not a target the app set", () => {
  const SUGAR_ANSWER = {
    yue: "張紙寫住血糖低過 4.0 mmol/L 就要去急症室。",
    cmn: "纸上写着血糖低于 4.0 mmol/L 就要去急诊。",
    en: "The sheet says below 4.0 mmol/L means A&E.",
  };

  it("lets a sheet answer quote the printed threshold", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet", citedCardIds: [SUGAR], answer: SUGAR_ANSWER },
      usage: USAGE,
    });

    const events = await collect("血糖低過幾多要去急症室？");
    expect(events[0]).toEqual({
      event: "outcome",
      outcome: "answered",
      citedCardIds: [SUGAR],
      sources: [sugarCard?.source],
    });
    expect(events[1]).toEqual({ event: "answer", answer: SUGAR_ANSWER });
    expect(phrase).not.toHaveBeenCalled();
  });

  it("still refuses a number the cited line does not print, and repairs from the printed facts", async () => {
    const INVENTED = {
      yue: "血糖要keep喺 7.0 mmol/L 以下。",
      cmn: "血糖要保持在 7.0 mmol/L 以下。",
      en: "Keep blood sugar under 7.0 mmol/L.",
    };
    answer.mockResolvedValue({
      result: { kind: "sheet", citedCardIds: [SUGAR], answer: INVENTED },
      usage: USAGE,
    });
    phrase.mockResolvedValue({ result: { spoken: INVENTED }, usage: USAGE });

    const events = await collect("血糖要幾多？");
    expect(phrase).toHaveBeenCalledTimes(1);
    expect(phrase.mock.calls[0][0].avoid).toEqual(expect.arrayContaining(["7.0 mmol"]));
    // The template is built from the printed facts, so it carries the page's 4.0 and never the 7.0.
    expect(events[0]).toMatchObject({ event: "outcome", outcome: "answered", citedCardIds: [SUGAR] });
    const spoken = events[1];
    expect(spoken.event).toBe("answer");
    if (spoken.event === "answer") {
      expect(JSON.stringify(spoken.answer)).not.toContain("7.0");
      expect(spoken.answer.yue).toContain("4.0 mmol/L");
    }
  });

  it("gives a general explanation no such exemption", async () => {
    answer.mockResolvedValue({
      result: { kind: "general", citedCardIds: [], answer: SUGAR_ANSWER },
      usage: USAGE,
    });

    expect(await collect("低血糖係咩？")).toEqual([
      { event: "outcome", outcome: "not_on_sheet" },
      { event: "answer", answer: NOT_ON_SHEET },
      { event: "done" },
    ]);
  });

  it("lets the early sentence carry a number only its cited line prints", () => {
    const text = "血糖低過 4.0 mmol/L 要去急症室。";
    expect(earlyGate({ kind: "sheet", citedCardIds: [SUGAR], text }, cards)).toEqual({
      outcome: "answered",
      text,
    });
    expect(earlyGate({ kind: "sheet", citedCardIds: ["medicine-0"], text }, cards)).toBeNull();
    expect(earlyGate({ kind: "general", citedCardIds: [], text }, cards)).toBeNull();
  });
});

/* -------------------------------------------------- early and final agree */

describe("what was said early is what the final answer says", () => {
  it("keeps a general explanation whose English form alone trips the filter", async () => {
    const yue = "空腹即係抽血之前唔食嘢。";
    streaming({ kind: "general", citedCardIds: [], text: yue }, () => ({
      kind: "general",
      citedCardIds: [],
      answer: {
        yue,
        cmn: "空腹就是抽血前不吃东西。",
        en: "Fasting means not eating before the treatment.",
      },
    }));

    const events = await collect("空腹係咩意思？", streamingProvider);
    expect(events[0]).toEqual({ event: "early", dialect: "yue", outcome: "explained", text: yue });
    expect(events[1]).toEqual({ event: "outcome", outcome: "explained" });
    expect(events[2].event).toBe("answer");
    if (events[2].event === "answer") {
      expect(events[2].answer.yue).toBe(yue);
      expect(events[2].answer.cmn).toBe("空腹就是抽血前不吃东西。");
      // The failed English form is replaced by the clean sentence the phone already said.
      expect(events[2].answer.en).toBe(yue);
      expect(checkSpeakable(events[2].answer).ok).toBe(true);
    }
  });

  it("still refuses a general explanation whose own form fails", async () => {
    streaming(null, () => ({ kind: "general", citedCardIds: [], answer: ADVICE }));

    expect(await collect("空腹係咩意思？", streamingProvider)).toEqual([
      { event: "outcome", outcome: "not_on_sheet" },
      { event: "answer", answer: NOT_ON_SHEET },
      { event: "done" },
    ]);
  });

  it("sends a greeting, a redirect and a boundary early, and never a none", () => {
    expect(earlyGate({ kind: "chat", citedCardIds: [], text: HELLO.yue }, cards)).toEqual({
      outcome: "chat",
      text: HELLO.yue,
    });
    expect(earlyGate({ kind: "off_topic", citedCardIds: [], text: MATHS.yue }, cards)).toEqual({
      outcome: "off_topic",
      text: MATHS.yue,
    });
    expect(earlyGate({ kind: "boundary", citedCardIds: ["warning-0"], text: DIZZY.yue }, cards)).toEqual({
      outcome: "boundary",
      text: DIZZY.yue,
    });
    // A boundary reply may cite nothing; a sheet answer may not.
    expect(earlyGate({ kind: "boundary", citedCardIds: [], text: DIZZY.yue }, cards)).toEqual({
      outcome: "boundary",
      text: DIZZY.yue,
    });
    expect(earlyGate({ kind: "sheet", citedCardIds: [], text: DIZZY.yue }, cards)).toBeNull();
    expect(earlyGate({ kind: "none", citedCardIds: [], text: "x" }, cards)).toBeNull();
    expect(earlyGate({ kind: "chat", citedCardIds: [], text: ADVICE.yue }, cards)).toBeNull();
  });

  it("keeps the demo's not-on-the-sheet beat exactly as it was", async () => {
    answer.mockResolvedValue({ result: { kind: "none", citedCardIds: [], answer: null }, usage: USAGE });

    expect(await collect("白色嗰粒係朝早定夜晚食？")).toEqual([
      { event: "outcome", outcome: "not_on_sheet" },
      { event: "answer", answer: NOT_ON_SHEET },
      { event: "done" },
    ]);
  });
});
