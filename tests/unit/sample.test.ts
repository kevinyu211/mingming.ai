/**
 * Launch MVP demo paths: English and Traditional Chinese stage sheets load as samples
 * without a model call, and land as the one active sheet in 記錄.
 */
import { describe, expect, it } from "vitest";
import {
  isSampleId,
  LAUNCH_SAMPLES,
  loadSampleReading,
  SAMPLE_IDS,
} from "@/lib/client/sample";
import { SheetReadingSchema } from "@/lib/domain/schemas";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("bundled sample ids", () => {
  it("recognises the launch paths and the older fixtures", () => {
    expect(SAMPLE_IDS).toEqual(["hk_en", "cn_zh", "cn_zh_photo", "demo_en", "demo_zh_hant"]);
    expect(LAUNCH_SAMPLES).toEqual(["demo_en", "demo_zh_hant"]);
    for (const id of SAMPLE_IDS) expect(isSampleId(id)).toBe(true);
    expect(isSampleId("not-a-sheet")).toBe(false);
  });
});

describe("launch demo fixtures parse as sheet readings", () => {
  for (const id of LAUNCH_SAMPLES) {
    it(`${id}.expected.json matches the reading schema`, () => {
      const file = path.join(process.cwd(), "fixtures", "demo", `${id}.expected.json`);
      const json = JSON.parse(readFileSync(file, "utf8"));
      const result = SheetReadingSchema.safeParse(json);
      expect(result.success, JSON.stringify(result.success ? [] : result.error.issues, null, 2)).toBe(
        true,
      );
    });
  }
});

describe("loadSampleReading — launch paths", () => {
  it("loads the English demo as a sample with warning signs first", async () => {
    const { reading, cards } = await loadSampleReading("demo_en");
    expect(reading.sample).toBe(true);
    expect(reading.sheetType).toBe("hk_en");
    expect(cards[0]?.type === "warning" || cards[0]?.type === "noWarnings").toBe(true);
    expect(cards.some((card) => card.type === "medicine")).toBe(true);
  });

  it("loads the Traditional Chinese demo as a sample", async () => {
    const { reading, cards } = await loadSampleReading("demo_zh_hant");
    expect(reading.sample).toBe(true);
    expect(reading.sheetType).toBe("cn_zh");
    expect(cards[0]?.type === "warning" || cards[0]?.type === "noWarnings").toBe(true);
    expect(reading.warningSigns[0]?.source.quote).toMatch(/平臥|氣促|喘醒/);
  });
});
