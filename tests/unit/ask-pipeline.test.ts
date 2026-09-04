/**
 * Unit tests for the `/api/ask` pipeline (T024).
 *
 * The model provider is a mock injected through `deps`, so nothing here needs a key and the two
 * rule gates can be checked the only way that matters: by asserting the provider was never
 * reached. The reading is the `hk_en` fixture, so the card ids and the source references the
 * pipeline emits are the real ones the UI will render.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import hkEnFixture from "../../fixtures/sheets/hk_en.expected.json";
import { REFERRAL, REFERRAL_RESOURCES } from "../../lib/i18n/referral";
import type { ModelProvider, UsageSummary } from "../../lib/model/client";
import { ModelOutputError, ModelUnavailableError } from "../../lib/model/client";
import { checkSpeakable } from "../../lib/rules/banned-terms";
import { buildCards } from "../../lib/rules/card-order";
import {
  NOT_ON_SHEET,
  REFUSED_MEDICINE_CHANGE,
  templateFor,
} from "../../lib/rules/template-fallback";
import {
  AskModelUnavailableError,
  AskReadingSchema,
  runAsk,
  type AskEvent,
  type AskRequest,
} from "../../lib/server/ask-pipeline";

/* ------------------------------------------------------------------ fixtures */

const reading = AskReadingSchema.parse(hkEnFixture);
const cards = buildCards(reading);
const medicine0 = cards.find((card) => card.id === "medicine-0");

const USAGE: UsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  model: "mock",
  ms: 1,
};

/** A clean answer about the first medicine, in all three spoken forms. */
const CLEAN_ANSWER = {
  yue: "張紙寫住 Amlodipine 5mg，每日一次。",
  cmn: "纸上写着 Amlodipine 5mg，每天一次。",
  en: "The sheet says Amlodipine 5mg, once a day.",
};

/** The same answer with a banned word in it (治療 / 治疗, and "treats" in English). */
const DIRTY_ANSWER = {
  yue: "呢隻藥係用嚟治療高血壓嘅。",
  cmn: "这个药是用来治疗高血压的。",
  en: "This one treats high blood pressure.",
};

const answer = vi.fn<ModelProvider["answer"]>();
const phrase = vi.fn<ModelProvider["phrase"]>();

const provider: ModelProvider = {
  readSheet: vi.fn<ModelProvider["readSheet"]>(),
  readSheetStream: vi.fn<ModelProvider["readSheetStream"]>(),
  answer,
  phrase,
};

function ask(text: string, inputLanguage: AskRequest["question"]["inputLanguage"] = "yue"): AskRequest {
  return { reading, question: { text, inputLanguage }, dialect: "yue" };
}

async function collect(text: string, inputLanguage?: AskRequest["question"]["inputLanguage"]) {
  const events: AskEvent[] = [];
  for await (const event of runAsk(ask(text, inputLanguage), { provider })) events.push(event);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* --------------------------------------------------------------- the gates */

describe("rule gates run before any model call", () => {
  it("answers a crisis question with the referral card and never calls the model", async () => {
    const events = await collect("我唔想再活落去。", "yue");

    expect(events).toEqual([
      {
        event: "outcome",
        outcome: "crisis_referral",
        referral: { text: REFERRAL.yue, resources: REFERRAL_RESOURCES },
      },
      { event: "done" },
    ]);
    expect(answer).not.toHaveBeenCalled();
    expect(phrase).not.toHaveBeenCalled();
  });

  it("uses the input language of the question for the referral text", async () => {
    const events = await collect("I want to die.", "en");
    const [outcome] = events;

    expect(outcome).toMatchObject({ outcome: "crisis_referral", referral: { text: REFERRAL.en } });
    expect(answer).not.toHaveBeenCalled();
  });

  it("refuses a medicine-change question with the template and never calls the model", async () => {
    const events = await collect("可唔可以唔食呢隻藥？");

    expect(events).toEqual([
      { event: "outcome", outcome: "refused_medicine_change" },
      { event: "answer", answer: REFUSED_MEDICINE_CHANGE },
      { event: "done" },
    ]);
    expect(answer).not.toHaveBeenCalled();
    expect(phrase).not.toHaveBeenCalled();
  });

  it("refuses in English too", async () => {
    const events = await collect("Can she stop the Metformin?", "en");

    expect(events[0]).toEqual({ event: "outcome", outcome: "refused_medicine_change" });
    expect(answer).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------- the answer */

describe("grounded answers", () => {
  it("emits outcome, answer and done for a citation the server can verify", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: ["medicine-0"], answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    const events = await collect("白色嗰粒係朝早定夜晚食？");

    expect(events).toEqual([
      {
        event: "outcome",
        outcome: "answered",
        citedCardIds: ["medicine-0"],
        sources: [medicine0?.source],
      },
      { event: "answer", answer: CLEAN_ANSWER },
      { event: "done" },
    ]);
    // The source is the fixture's own line, not something the model supplied.
    expect(medicine0?.source?.quote).toBe("1. Amlodipine 5mg 1 tab daily");
  });

  it("passes the built cards, the question and the dialect to the provider", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: ["medicine-0"], answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    await collect("白色嗰粒點食？");

    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith({
      cards,
      question: "白色嗰粒點食？",
      inputLanguage: "yue",
      dialect: "yue",
    });
  });
});

/* ------------------------------------------------------- grounding enforced */

describe("grounding is enforced server-side", () => {
  const NOT_ON_SHEET_EVENTS: AskEvent[] = [
    { event: "outcome", outcome: "not_on_sheet" },
    { event: "answer", answer: NOT_ON_SHEET },
    { event: "done" },
  ];

  it("falls back to the template when the model does not ground the answer", async () => {
    answer.mockResolvedValue({
      result: { kind: "none" as const, citedCardIds: ["medicine-0"], answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    expect(await collect("佢可以食咩水果？")).toEqual(NOT_ON_SHEET_EVENTS);
  });

  it("falls back to the template when the cited card id does not exist", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: ["medicine-99"], answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    expect(await collect("佢可以食咩水果？")).toEqual(NOT_ON_SHEET_EVENTS);
  });

  it("falls back to the template when the citation is null", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: [], answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    expect(await collect("佢可以食咩水果？")).toEqual(NOT_ON_SHEET_EVENTS);
  });

  it("falls back to the template when the answer is null", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: ["medicine-0"], answer: null },
      usage: USAGE,
    });

    expect(await collect("佢可以食咩水果？")).toEqual(NOT_ON_SHEET_EVENTS);
  });

  it("treats unusable model output as not_on_sheet, not as an outage", async () => {
    answer.mockRejectedValue(new ModelOutputError("schema", []));

    expect(await collect("佢可以食咩水果？")).toEqual(NOT_ON_SHEET_EVENTS);
  });

  it("throws AskModelUnavailableError when the model cannot be reached", async () => {
    answer.mockRejectedValue(new ModelUnavailableError(500));

    await expect(collect("白色嗰粒點食？")).rejects.toBeInstanceOf(AskModelUnavailableError);
  });
});

/* ----------------------------------------------------------- banned terms */

describe("the banned-term filter runs on the answer", () => {
  it("regenerates once with the matched terms, then falls back to the template", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: ["medicine-0"], answer: DIRTY_ANSWER },
      usage: USAGE,
    });
    // The rephrase is still dirty, so the fixed template is the floor.
    phrase.mockResolvedValue({ result: { spoken: DIRTY_ANSWER }, usage: USAGE });

    const events = await collect("呢隻藥做咩用？");
    const template = templateFor("medicine", medicine0?.facts ?? {});

    expect(phrase).toHaveBeenCalledTimes(1);
    expect(phrase).toHaveBeenCalledWith({
      cardType: "medicine",
      facts: medicine0?.facts,
      source: medicine0?.source,
      avoid: expect.arrayContaining(["治療", "治疗"]),
      dialect: "both",
    });
    expect(events).toEqual([
      { event: "outcome", outcome: "answered", citedCardIds: ["medicine-0"], sources: [medicine0?.source] },
      { event: "answer", answer: template },
      { event: "done" },
    ]);
    // Whatever is emitted has itself passed the filter.
    expect(checkSpeakable(template).ok).toBe(true);
  });

  it("keeps a clean rephrase when the second attempt passes", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: ["medicine-0"], answer: DIRTY_ANSWER },
      usage: USAGE,
    });
    phrase.mockResolvedValue({ result: { spoken: CLEAN_ANSWER }, usage: USAGE });

    const events = await collect("呢隻藥做咩用？");

    expect(events[1]).toEqual({ event: "answer", answer: CLEAN_ANSWER });
  });

  it("falls back to the template when the rephrase call itself fails", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: ["medicine-0"], answer: DIRTY_ANSWER },
      usage: USAGE,
    });
    phrase.mockRejectedValue(new ModelUnavailableError(503));

    const events = await collect("呢隻藥做咩用？");

    expect(events[1]).toEqual({
      event: "answer",
      answer: templateFor("medicine", medicine0?.facts ?? {}),
    });
  });

  it("never calls phrase when the first answer is clean", async () => {
    answer.mockResolvedValue({
      result: { kind: "sheet" as const, citedCardIds: ["medicine-0"], answer: CLEAN_ANSWER },
      usage: USAGE,
    });

    await collect("白色嗰粒點食？");

    expect(phrase).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------- the schema */

describe("the request schema keeps profile data out", () => {
  it("rejects an extra top-level key", () => {
    const parsed = (
      AskReadingSchema.safeParse({ ...reading, label: "阿媽" })
    );
    expect(parsed.success).toBe(false);
  });

  it("accepts a stored reading with recognisedType, readAt and sample", () => {
    const stored = {
      ...reading,
      dietLine: reading.dietLine === null ? null : { ...reading.dietLine, recognisedType: "low_salt" },
      readAt: "2026-09-02T00:00:00.000Z",
      sample: true,
    };
    expect(AskReadingSchema.safeParse(stored).success).toBe(true);
  });
});
