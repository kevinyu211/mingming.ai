/**
 * Unit tests for the read pipeline. The provider is a stub object with one `phrase` method, so
 * nothing here reaches the network and no API key is needed — which is the reason the pipeline
 * takes the provider as an argument instead of calling `getModelProvider()` itself.
 *
 * What is asserted: the fixed card order, the rule-set diet type, and the three ways a banned-term
 * hit can end (clean re-phrase, template, no hit at all).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { PhraseInput } from "@/lib/model/prompts";
import type { SheetReading, Speakable } from "@/lib/domain/schemas";
import type { UsageSummary } from "@/lib/model/client";
import { checkSpeakable } from "@/lib/rules/banned-terms";
import { templateFor } from "@/lib/rules/template-fallback";
import { SEE_THE_SHEET, runReadingPipeline, safeTemplate } from "@/lib/server/reading-pipeline";

/* -------------------------------------------------------------------------- */
/* Fixtures and stubs                                                         */
/* -------------------------------------------------------------------------- */

const HK_EN: SheetReading = JSON.parse(
  readFileSync(path.join(process.cwd(), "fixtures/sheets/hk_en.expected.json"), "utf8"),
) as SheetReading;

/** A deep clone, so a mutation in one test cannot leak into another. */
function fixture(): SheetReading {
  return JSON.parse(JSON.stringify(HK_EN)) as SheetReading;
}

const USAGE: UsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  model: "stub",
  ms: 0,
};

const NOW = () => new Date("2026-09-02T04:05:06.000Z");

/** A provider stub whose only job is to hand back one phrasing. */
function stubProvider(spoken: Speakable | ((input: PhraseInput) => Speakable)) {
  const phrase = vi.fn(async (input: PhraseInput) => ({
    result: { spoken: typeof spoken === "function" ? spoken(input) : spoken },
    usage: USAGE,
  }));
  return { phrase };
}

const NEVER_CALLED = stubProvider({ yue: "unused", cmn: "unused", en: "unused" });

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("runReadingPipeline", () => {
  it("flows the Hong Kong fixture through with warning signs first and no filter hits", async () => {
    const provider = stubProvider({ yue: "unused", cmn: "unused", en: "unused" });
    const result = await runReadingPipeline(fixture(), provider, { now: NOW });

    expect(result.kind).toBe("reading");
    if (result.kind !== "reading") return;

    expect(result.cards.map((card) => card.type)).toEqual([
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
    expect(result.reading.dietLine?.recognisedType).toBe("low_salt");
    expect(result.reading.readAt).toBe("2026-09-02T04:05:06.000Z");
    expect(result.filter).toEqual({ regenerated: 0, templated: 0 });
    expect(provider.phrase).not.toHaveBeenCalled();

    // Principle VI: nothing that leaves the pipeline may trip the filter.
    for (const card of result.cards) expect(checkSpeakable(card.body).ok).toBe(true);
  });

  it("re-phrases once, naming the matched term, and keeps a clean result", async () => {
    const reading = fixture();
    reading.medicines[0].spoken = {
      yue: "呢隻藥係用嚟治療高血壓。",
      cmn: "这个药是用来治疗高血压的。",
      en: "This one treats high blood pressure.",
    };

    const clean: Speakable = {
      yue: "藥名 Amlodipine，5mg，每次一粒，每日一次。",
      cmn: "药名 Amlodipine，5mg，每次一片，每天一次。",
      en: "The sheet lists Amlodipine, 5mg, 1 tab each time, once a day.",
    };
    const provider = stubProvider(clean);
    const result = await runReadingPipeline(reading, provider, { now: NOW });

    expect(result.kind).toBe("reading");
    if (result.kind !== "reading") return;

    expect(provider.phrase).toHaveBeenCalledTimes(1);
    const input = provider.phrase.mock.calls[0][0];
    expect(input.cardType).toBe("medicine");
    expect(input.avoid).toContain("治療");
    expect(input.avoid).toContain("治疗");
    expect(input.facts).toMatchObject({ name: "Amlodipine", strength: "5mg" });

    const medicine = result.cards.find((card) => card.id === "medicine-0");
    expect(medicine?.body).toEqual(clean);
    expect(medicine?.aiGenerated).toBe(true);
    expect(result.filter).toEqual({ regenerated: 1, templated: 0 });

    // The stored reading carries the repaired text, so a re-render cannot resurrect the original.
    expect(result.reading.medicines[0].spoken).toEqual(clean);
  });

  it("falls back to the fixed template when the re-phrase trips the filter again", async () => {
    const reading = fixture();
    reading.medicines[0].spoken = {
      yue: "呢隻藥係用嚟治療高血壓。",
      cmn: "这个药是用来治疗高血压的。",
      en: "This one treats high blood pressure.",
    };

    const provider = stubProvider({
      yue: "仲係講緊治療。",
      cmn: "还是在讲治疗。",
      en: "Still talking about how it treats things.",
    });
    const result = await runReadingPipeline(reading, provider, { now: NOW });

    expect(result.kind).toBe("reading");
    if (result.kind !== "reading") return;

    expect(provider.phrase).toHaveBeenCalledTimes(1);
    expect(result.filter).toEqual({ regenerated: 0, templated: 1 });

    const medicine = result.cards.find((card) => card.id === "medicine-0");
    expect(medicine?.body).toEqual(
      templateFor("medicine", {
        name: "Amlodipine",
        strength: "5mg",
        amount: "1 tab",
        frequency: "daily",
        duration: null,
      }),
    );
    // A template is rule-generated, so the AI label comes off with the AI text.
    expect(medicine?.aiGenerated).toBe(false);
    expect(checkSpeakable(medicine!.body).ok).toBe(true);
  });

  it("uses the template when the phrase call fails outright, without failing the read", async () => {
    const reading = fixture();
    reading.medicines[0].spoken = { yue: "治療。", cmn: "治疗。", en: "It treats it." };

    const provider = {
      phrase: vi.fn(async () => {
        throw new Error("provider down");
      }),
    };
    const result = await runReadingPipeline(reading, provider, { now: NOW });

    expect(result.kind).toBe("reading");
    if (result.kind !== "reading") return;
    expect(result.filter).toEqual({ regenerated: 0, templated: 1 });
    expect(result.cards).toHaveLength(9);
  });

  it("produces no cards for a sheet it does not recognise", async () => {
    const unknown: SheetReading = {
      sheetType: "unknown",
      warningSigns: [],
      medicines: [],
      followUp: [],
      dietLine: null,
      activityLine: null,
      hospitalContact: null,
      unreadable: [],
    };

    const result = await runReadingPipeline(unknown, NEVER_CALLED, { now: NOW });
    expect(result).toEqual({ kind: "unknown" });
    expect(NEVER_CALLED.phrase).not.toHaveBeenCalled();
  });

  it("puts the rule-generated noWarnings card first when the sheet prints no warning signs", async () => {
    const reading = fixture();
    reading.warningSigns = [];

    const result = await runReadingPipeline(reading, NEVER_CALLED, { now: NOW });
    expect(result.kind).toBe("reading");
    if (result.kind !== "reading") return;

    expect(result.cards[0].type).toBe("noWarnings");
    expect(result.cards[0].aiGenerated).toBe(false);
    expect(result.cards.filter((card) => card.type === "warning")).toHaveLength(0);
    expect(result.filter).toEqual({ regenerated: 0, templated: 0 });
  });

  it("rejects a reading that does not match the schema", async () => {
    const broken = { ...fixture(), medicines: [{ name: "Amlodipine" }] } as unknown as SheetReading;
    await expect(runReadingPipeline(broken, NEVER_CALLED)).rejects.toMatchObject({
      code: "invalid_output:schema",
    });
  });

  /**
   * tests/eval/stress.md: on `dense` the page prints "Breathless at rest" and six of eight runs
   * quoted "Breathlessness at rest". Nothing on the server can see the photograph, so the quote
   * itself cannot be checked — but a medicine's own fields and its own quote are copied off the
   * same printed line, so they can be checked against each other.
   */
  it("marks a medicine whose name is not in its own quote, and still shows it", async () => {
    const reading = fixture();
    reading.medicines[0].name = "Amlodipine besylate";

    const result = await runReadingPipeline(reading, NEVER_CALLED, { now: NOW });
    expect(result.kind).toBe("reading");
    if (result.kind !== "reading") return;

    const card = result.cards.find((c) => c.id === "medicine-0");
    expect(card?.unverified).toBe(true);
    // Kept, not dropped: losing a medicine is worse than showing a doubtful one.
    expect(card?.facts?.name).toBe("Amlodipine besylate");
    expect(result.cards.filter((c) => c.type === "medicine")).toHaveLength(3);
  });

  it("marks a medicine whose strength disagrees with its own quote", async () => {
    const reading = fixture();
    reading.medicines[0].strength = "10mg";

    const result = await runReadingPipeline(reading, NEVER_CALLED, { now: NOW });
    if (result.kind !== "reading") throw new Error("expected a reading");
    expect(result.cards.find((c) => c.id === "medicine-0")?.unverified).toBe(true);
  });

  it("leaves a medicine unmarked when its fields are all findable in its quote", async () => {
    const result = await runReadingPipeline(fixture(), NEVER_CALLED, { now: NOW });
    if (result.kind !== "reading") throw new Error("expected a reading");
    for (const card of result.cards) expect(card.unverified).toBeUndefined();
  });

  it("does not fault a medicine over spacing or width alone", async () => {
    const reading = fixture();
    const quote = reading.medicines[0].source.quote;
    // "5mg" printed, "5 mg" typed: the same value, spelled with a space. Folding is comparison
    // only — the stored field keeps exactly what was returned.
    reading.medicines[0].strength = `${reading.medicines[0].strength?.replace(/(\d)(\D)/, "$1 $2")}`;
    expect(reading.medicines[0].strength).not.toBe(quote);

    const result = await runReadingPipeline(reading, NEVER_CALLED, { now: NOW });
    if (result.kind !== "reading") throw new Error("expected a reading");
    expect(result.cards.find((c) => c.id === "medicine-0")?.unverified).toBeUndefined();
  });

  it("marks a medicine that cites no line at all", async () => {
    const reading = fixture();
    reading.medicines[0].source = { ...reading.medicines[0].source, quote: "" };

    const result = await runReadingPipeline(reading, NEVER_CALLED, { now: NOW });
    if (result.kind !== "reading") throw new Error("expected a reading");
    expect(result.cards.find((c) => c.id === "medicine-0")?.unverified).toBe(true);
  });

  it("keeps the unverified mark through a banned-term repair", async () => {
    const reading = fixture();
    reading.medicines[0].name = "Amlodipine besylate";
    reading.medicines[0].spoken = { yue: "治療。", cmn: "治疗。", en: "It treats it." };
    const clean: Speakable = { yue: "食藥。", cmn: "吃药。", en: "Take the tablet." };

    const result = await runReadingPipeline(reading, stubProvider(clean), { now: NOW });
    if (result.kind !== "reading") throw new Error("expected a reading");
    const card = result.cards.find((c) => c.id === "medicine-0");
    expect(card?.body).toEqual(clean);
    expect(card?.unverified).toBe(true);
  });

  /**
   * The repair path is where a stopped medicine is most dangerous: the sentence saying the page
   * stopped it lives only in the model's wording, and that is precisely what gets discarded here.
   *
   * This used to fall through to `SEE_THE_SHEET`, which was safe but threw the drug's name away.
   * The live stress runs showed how often it fires — on `fixtures/stress/mixed.png`, one read in
   * three had the model write `spoken` text for a withdrawn drug that reads like a live dose
   * ("0.25mg 每日"), the numeric-target rule rejected it, and the family was left being told to
   * look at a sheet without being told what to look for.
   *
   * `templateFor` now dispatches on `facts.status`, so the rebuilt card names the drug verbatim
   * and attributes the fact to the page. What must never come back is a DOSE.
   */
  it("rebuilds a stopped medicine as a named ended medicine, never as a dose", async () => {
    const reading = fixture();
    reading.medicines[0].status = "stopped";
    reading.medicines[0].spoken = { yue: "治療。", cmn: "治疗。", en: "It treats it." };

    const provider = {
      phrase: vi.fn(async () => {
        throw new Error("provider down");
      }),
    };
    const result = await runReadingPipeline(reading, provider, { now: NOW });
    if (result.kind !== "reading") throw new Error("expected a reading");

    const card = result.cards.find((c) => c.id === "medicine-0");
    expect(card?.stopped).toBe(true);
    expect(result.filter).toEqual({ regenerated: 0, templated: 1 });

    // The drug is named, so the family knows which box on the table this is about.
    for (const spoken of Object.values(card?.body ?? {})) {
      expect(spoken).toContain("Amlodipine");
    }
    // ...and no dose survives. The frequency is what tripped the filter in the first place, so a
    // repair that reintroduced it would be the original bug wearing a template.
    const body = Object.values(card?.body ?? {}).join(" ");
    for (const dose of ["每日", "每天", "daily", "1 tab", "1 粒", "14"]) {
      expect(body).not.toContain(dose);
    }
    // The generic "look at the sheet" fallback is no longer the answer for this case.
    expect(card?.body).not.toEqual(SEE_THE_SHEET);
    expect(card?.body).toEqual(templateFor("medicine", card?.facts ?? {}));
  });
});

describe("safeTemplate", () => {
  it("returns the template when it is clean", () => {
    const facts = { name: "Amlodipine", strength: "5mg", amount: "1 tab", frequency: "daily" };
    expect(safeTemplate("medicine", facts)).toEqual(templateFor("medicine", facts));
  });

  it("falls back to a fixed sentence when even the template trips the filter", () => {
    // The documented caveat: the diet template quotes the printed line verbatim, so a sheet that
    // prints a numeric target renders into a filtered string.
    const facts = { raw: "低鹽飲食，鹽 2 克/日" };
    expect(checkSpeakable(templateFor("diet", facts)).ok).toBe(false);
    expect(safeTemplate("diet", facts)).toEqual(SEE_THE_SHEET);
  });

  it("keeps the last-resort sentence itself clean", () => {
    expect(checkSpeakable(SEE_THE_SHEET).ok).toBe(true);
  });
});
