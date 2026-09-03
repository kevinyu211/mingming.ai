/**
 * Memory at the `/api/ask` boundary: what the brief is allowed to change, and what it must not.
 *
 * The brief makes the agent feel continuous. It must not make it less careful, so the three
 * things asserted here are all negatives:
 *
 *   - the two rule gates still fire first, still never see the brief, and still make no model call
 *   - a question only the brief could answer is still `not_on_sheet`
 *   - the request schema is still strict, so `memory` is the one field that was added and not a
 *     door left open
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import hkEnFixture from "../../fixtures/sheets/hk_en.expected.json";
import { MAX_BRIEF_CHARS } from "../../lib/memory/context";
import type { ModelProvider, UsageSummary } from "../../lib/model/client";
import { buildAskUserContent } from "../../lib/model/prompts";
import { buildCards } from "../../lib/rules/card-order";
import { NOT_ON_SHEET, REFUSED_MEDICINE_CHANGE } from "../../lib/rules/template-fallback";
import {
  AskReadingSchema,
  AskRequestSchema,
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

const CLEAN_ANSWER = {
  yue: "張紙寫住 Amlodipine 5mg，每日一次。",
  cmn: "纸上写着 Amlodipine 5mg，每天一次。",
  en: "The sheet says Amlodipine 5mg, once a day.",
};

/** A brief about an EARLIER sheet: it names a medicine the current reading does not have. */
const BRIEF = [
  "BACKGROUND — earlier use of this app on this phone. Context only, never a source of facts.",
  "SHEETS ALREADY READ",
  "- 2026-08-19 · Hong Kong English sheet",
  "  medicines: Warfarin 3mg 1 tab daily",
  "  follow-up: Anticoagulation Clinic 1/52",
  "QUESTIONS ALREADY ASKED",
  "- 2026-08-19 · 佢要唔要覆診？ · answered from the sheet (followUp-0)",
].join("\n");

const answer = vi.fn<ModelProvider["answer"]>();
const phrase = vi.fn<ModelProvider["phrase"]>();

const provider: ModelProvider = {
  readSheet: vi.fn<ModelProvider["readSheet"]>(),
  readSheetStream: vi.fn<ModelProvider["readSheetStream"]>(),
  answer,
  phrase,
};

function ask(text: string, memory?: string): AskRequest {
  return {
    reading,
    question: { text, inputLanguage: "yue" },
    dialect: "yue",
    ...(memory === undefined ? {} : { memory }),
  };
}

async function collect(request: AskRequest): Promise<AskEvent[]> {
  const events: AskEvent[] = [];
  for await (const event of runAsk(request, { provider })) events.push(event);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* -------------------------------------------------------------- the schema */

describe("the request schema still keeps profile data out", () => {
  it("accepts the one new field", () => {
    expect(AskRequestSchema.safeParse(ask("幾時覆診？", BRIEF)).success).toBe(true);
  });

  it("still rejects an unknown top-level key", () => {
    const widened = { ...ask("幾時覆診？", BRIEF), label: "阿媽" };
    expect(AskRequestSchema.safeParse(widened).success).toBe(false);
  });

  it("rejects a profile object smuggled in as the memory field", () => {
    const wrong = { ...ask("幾時覆診？"), memory: { label: "阿媽" } };
    expect(AskRequestSchema.safeParse(wrong).success).toBe(false);
  });

  it("rejects a brief longer than the cap: that is not a brief", () => {
    const tooLong = "x".repeat(MAX_BRIEF_CHARS + 1);
    expect(AskRequestSchema.safeParse(ask("幾時覆診？", tooLong)).success).toBe(false);
    expect(AskRequestSchema.safeParse(ask("幾時覆診？", "x".repeat(MAX_BRIEF_CHARS))).success).toBe(
      true,
    );
  });
});

/* ---------------------------------------------------------------- the gates */

describe("the gates are unchanged by memory", () => {
  it("answers a crisis question from the rules, with a brief present and no model call", async () => {
    const events = await collect(ask("我唔想再活落去。", BRIEF));

    expect(events.map((event) => event.event)).toEqual(["outcome", "done"]);
    expect(events[0]).toMatchObject({ outcome: "crisis_referral" });
    expect(answer).not.toHaveBeenCalled();
    expect(phrase).not.toHaveBeenCalled();
  });

  it("refuses a medicine-change question from the rules, with a brief present and no model call", async () => {
    const events = await collect(ask("可唔可以唔食呢隻藥？", BRIEF));

    expect(events).toEqual([
      { event: "outcome", outcome: "refused_medicine_change" },
      { event: "answer", answer: REFUSED_MEDICINE_CHANGE },
      { event: "done" },
    ]);
    expect(answer).not.toHaveBeenCalled();
    expect(phrase).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------- passing it along */

describe("the brief reaches the model as background", () => {
  it("is passed to the answer call alongside the cards", async () => {
    answer.mockResolvedValue({
      result: { grounded: true, citedCardId: "medicine-0", answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    await collect(ask("白色嗰粒點食？", BRIEF));

    expect(answer).toHaveBeenCalledWith({
      cards,
      question: "白色嗰粒點食？",
      inputLanguage: "yue",
      dialect: "yue",
      memory: BRIEF,
    });
  });

  it("is left out entirely when the phone has nothing to say", async () => {
    answer.mockResolvedValue({
      result: { grounded: true, citedCardId: "medicine-0", answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    await collect(ask("白色嗰粒點食？"));
    await collect(ask("白色嗰粒點食？", "   "));

    for (const call of answer.mock.calls) {
      expect(Object.keys(call[0])).not.toContain("memory");
    }
  });

  it("is never given to the rephrase call", async () => {
    answer.mockResolvedValue({
      result: {
        grounded: true,
        citedCardId: "medicine-0",
        // Trips the banned-term filter, so `phrase` runs.
        answer: { yue: "呢隻藥係用嚟治療高血壓。", cmn: "这个药是用来治疗高血压。", en: "It treats it." },
      },
      usage: USAGE,
    });
    phrase.mockResolvedValue({ result: { spoken: CLEAN_ANSWER }, usage: USAGE });

    await collect(ask("呢隻藥做咩用？", BRIEF));

    expect(phrase).toHaveBeenCalledTimes(1);
    expect(Object.keys(phrase.mock.calls[0][0])).not.toContain("memory");
    expect(JSON.stringify(phrase.mock.calls[0][0])).not.toContain("Warfarin");
  });

  it("sits in the prompt as a labelled, uncitable block ahead of the cards", () => {
    const [block] = buildAskUserContent(cards, "白色嗰粒點食？", "yue", "yue", BRIEF);
    const text = block.type === "text" ? block.text : "";

    expect(text).toContain("BACKGROUND");
    expect(text).toContain("not citable");
    expect(text.indexOf("BACKGROUND")).toBeLessThan(text.indexOf("\nCARDS\n"));
    // …and the question is still the last thing the model reads.
    expect(text.indexOf("\nCARDS\n")).toBeLessThan(text.indexOf("QUESTION (asked in"));

    const [plain] = buildAskUserContent(cards, "白色嗰粒點食？", "yue", "yue");
    expect(plain.type === "text" ? plain.text : "").not.toContain("BACKGROUND");
  });
});

/* ------------------------------------------------------- memory is not proof */

describe("memory can never become the source of a medical fact", () => {
  const NOT_ON_SHEET_EVENTS: AskEvent[] = [
    { event: "outcome", outcome: "not_on_sheet" },
    { event: "answer", answer: NOT_ON_SHEET },
    { event: "done" },
  ];

  it("returns not_on_sheet when the answer is only in the brief", async () => {
    // The honest model behaviour for "what about the Warfarin?": the brief mentions it, the
    // cards do not, so nothing on this sheet can be cited.
    answer.mockResolvedValue({
      result: { grounded: false, citedCardId: null, answer: null },
      usage: USAGE,
    });

    expect(await collect(ask("Warfarin 幾時食？", BRIEF))).toEqual(NOT_ON_SHEET_EVENTS);
  });

  it("returns not_on_sheet when the model answers from the brief and claims it was grounded", async () => {
    // Belt and braces: even a model that asserts grounding cannot cite a card that is not in the
    // current reading, so the fabricated citation lands on the template.
    answer.mockResolvedValue({
      result: {
        grounded: true,
        citedCardId: "memory-0",
        answer: {
          yue: "上次張紙寫住 Warfarin 3mg。",
          cmn: "上次那张纸写着 Warfarin 3mg。",
          en: "The earlier sheet said Warfarin 3mg.",
        },
      },
      usage: USAGE,
    });

    expect(await collect(ask("Warfarin 幾時食？", BRIEF))).toEqual(NOT_ON_SHEET_EVENTS);
  });

  it("still answers normally from the current sheet with a brief present", async () => {
    answer.mockResolvedValue({
      result: { grounded: true, citedCardId: "medicine-0", answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    const events = await collect(ask("白色嗰粒點食？", BRIEF));

    expect(events[0]).toMatchObject({ outcome: "answered", citedCardId: "medicine-0" });
    expect(events[1]).toEqual({ event: "answer", answer: CLEAN_ANSWER });
  });
});
