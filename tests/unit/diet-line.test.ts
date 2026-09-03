import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { applyDietRules, dietPlainSentence, recogniseDiet, recogniseDietAll } from "@/lib/rules/diet-line";
import type { DietLine, DietType, SheetReading, SourceReference, Speakable } from "@/lib/domain/schemas";

const source: SourceReference = { section: "出院医嘱", lineIndex: 2, quote: "低盐饮食" };
const sp = (yue: string, cmn: string, en = `[en] ${yue}`): Speakable => ({ yue, cmn, en });

function readingWithDiet(line: DietLine | null): SheetReading {
  return {
    sheetType: "cn_zh",
    warningSigns: [],
    medicines: [],
    followUp: [],
    dietLine: line,
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
  };
}

const dietLine = (raw: string): DietLine => ({
  raw,
  spoken: sp(`張紙寫住：${raw}。`, `这张纸写着：${raw}。`),
  source: { ...source, quote: raw },
});

describe("recogniseDiet", () => {
  const table: [string | null | undefined, DietType][] = [
    ["低鹽飲食", "low_salt"],
    ["低盐饮食", "low_salt"],
    ["少鹽", "low_salt"],
    ["少盐", "low_salt"],
    ["Low salt diet", "low_salt"],
    ["LOW SODIUM DIET", "low_salt"],
    ["Salt restricted diet", "low_salt"],
    ["低脂飲食", "low_fat"],
    ["少油", "low_fat"],
    ["Low fat diet", "low_fat"],
    ["low-fat", "low_fat"],
    ["Low oil cooking", "low_fat"],
    ["糖尿病飲食", "diabetic"],
    ["糖尿病饮食", "diabetic"],
    ["糖尿饮食", "diabetic"],
    ["DM diet", "diabetic"],
    ["Diabetic diet", "diabetic"],
    ["diabetes diet", "diabetic"],
    ["清淡飲食", "light"],
    ["清淡为主", "light"],
    // Specialised diets lock the food features: always other, even alongside a recognised term.
    ["低蛋白飲食", "other"],
    ["Low protein diet", "other"],
    ["肾病饮食", "other"],
    ["低盐低蛋白饮食", "other"],
    ["Renal diet, low salt", "other"],
    ["kidney diet", "other"],
    ["流質飲食", "other"],
    ["半流质饮食", "other"],
    ["軟食", "other"],
    ["鼻饲", "other"],
    // Nothing recognised.
    ["按醫生指示", "other"],
    ["Regular diet", "other"],
    ["", "other"],
    [null, "other"],
    [undefined, "other"],
  ];

  for (const [raw, expected] of table) {
    it(`${JSON.stringify(raw)} → ${expected}`, () => {
      expect(recogniseDiet(raw)).toBe(expected);
    });
  }
});

describe("recogniseDietAll", () => {
  it("returns combined types in order of appearance", () => {
    expect(recogniseDietAll("低盐低脂饮食")).toEqual(["low_salt", "low_fat"]);
    expect(recogniseDietAll("低脂低盐饮食")).toEqual(["low_fat", "low_salt"]);
    expect(recogniseDietAll("Low salt, low fat")).toEqual(["low_salt", "low_fat"]);
    expect(recogniseDietAll("Low fat / low salt diet")).toEqual(["low_fat", "low_salt"]);
  });

  it("gives the same primary type as recogniseDiet", () => {
    for (const raw of ["低盐低脂饮食", "低脂低盐饮食", "Low salt, low fat", "清淡", "按醫生指示"]) {
      expect(recogniseDiet(raw)).toBe(recogniseDietAll(raw)[0] ?? "other");
    }
  });

  it("is empty for specialised diets and for nothing recognised", () => {
    expect(recogniseDietAll("低盐低脂低蛋白饮食")).toEqual([]);
    expect(recogniseDietAll("按醫生指示")).toEqual([]);
    expect(recogniseDietAll(null)).toEqual([]);
  });
});

describe("dietPlainSentence", () => {
  it("covers a combined low salt / low fat line in all three spoken forms", () => {
    expect(dietPlainSentence(["low_salt", "low_fat"])).toEqual({
      yue: "即係少鹽少油：煮嘢少落鹽同醬油，少煎炸。冇話要戒肉。",
      cmn: "就是少盐少油：做菜少放盐和酱油，少煎炸。没有说要戒肉。",
      en: "That means less salt and less oil: go easy on the salt and soy sauce when cooking, less frying. Nothing there says to give up meat.",
    });
  });

  it("says 清淡 is less oil, salt and sugar, not less meat", () => {
    expect(dietPlainSentence(["light"])).toEqual({
      yue: "清淡係少油、少鹽、少糖，唔係唔食肉。",
      cmn: "清淡就是少油、少盐、少糖，没有说要戒肉。",
      en: "Plain cooking means less oil, less salt and less sugar. It doesn't mean giving up meat.",
    });
  });

  it("talks about sugar and regular meals for a diabetic diet", () => {
    const s = dietPlainSentence(["diabetic"]);
    expect(s).not.toBeNull();
    expect(s?.yue).toContain("少糖");
    expect(s?.cmn).toContain("少糖");
    expect(s?.cmn).toContain("三餐定时");
  });

  it("is null for other, for an empty set, and for a set containing other", () => {
    expect(dietPlainSentence([])).toBeNull();
    expect(dietPlainSentence(["other"])).toBeNull();
    expect(dietPlainSentence(["low_salt", "other"])).toBeNull();
  });

  it("is deterministic and order-sensitive", () => {
    expect(dietPlainSentence(["low_salt", "low_fat"])).toEqual(dietPlainSentence(["low_salt", "low_fat"]));
    expect(dietPlainSentence(["low_fat", "low_salt"])?.yue).toBe(
      "即係少油少鹽：少煎炸，煮嘢少落鹽同醬油。冇話要戒肉。",
    );
  });

  it("never uses a banned term and never states a number about the person", () => {
    const banned = [
      "診斷", "诊断", "治療", "治疗", "處方", "处方", "治癒", "治愈",
      "能吃", "不能吃", "唔食得", "建議你", "建议你", "diagnos", "treat", "cure", "prescri",
    ];
    const sets: DietType[][] = [
      ["low_salt"], ["low_fat"], ["diabetic"], ["light"], ["low_salt", "low_fat"],
      ["low_salt", "low_fat", "diabetic"], ["light", "low_salt"],
    ];
    for (const set of sets) {
      const s = dietPlainSentence(set);
      expect(s).not.toBeNull();
      for (const dialect of [s!.yue, s!.cmn]) {
        expect(dialect).not.toMatch(/\d/);
        for (const term of banned) {
          expect(dialect.toLowerCase()).not.toContain(term.toLowerCase());
        }
      }
    }
  });
});

describe("applyDietRules", () => {
  it("sets recognisedType and appends the plain sentence in both dialects", () => {
    const line = dietLine("低盐低脂饮食");
    const out = applyDietRules(readingWithDiet(line));
    expect(out?.recognisedType).toBe("low_salt");
    expect(out?.raw).toBe("低盐低脂饮食");
    expect(out?.source).toEqual(line.source);
    expect(out?.spoken.yue).toBe(`${line.spoken.yue} 即係少鹽少油：煮嘢少落鹽同醬油，少煎炸。冇話要戒肉。`);
    expect(out?.spoken.cmn).toBe(`${line.spoken.cmn} 就是少盐少油：做菜少放盐和酱油，少煎炸。没有说要戒肉。`);
  });

  it("adds nothing for an unrecognised or specialised line", () => {
    for (const raw of ["按醫生指示", "低盐低蛋白饮食"]) {
      const line = dietLine(raw);
      const out = applyDietRules(readingWithDiet(line));
      expect(out?.recognisedType).toBe("other");
      expect(out?.spoken).toEqual(line.spoken);
    }
  });

  it("returns null when nothing about food is printed", () => {
    expect(applyDietRules(readingWithDiet(null))).toBeNull();
  });

  it("is idempotent", () => {
    const reading = readingWithDiet(dietLine("清淡饮食"));
    const once = applyDietRules(reading);
    const twice = applyDietRules({ ...reading, dietLine: once });
    expect(twice).toEqual(once);
    expect(once?.recognisedType).toBe("light");
  });
});

const fixtureDir = path.resolve(__dirname, "../../fixtures/sheets");
const fixtures = ["hk_en", "cn_zh", "cn_zh_photo"] as const;

describe("fixtures", () => {
  for (const name of fixtures) {
    const file = path.join(fixtureDir, `${name}.expected.json`);
    // Fixtures land with task T006; until then there is nothing to check here.
    it.skipIf(!existsSync(file))(`recognises the diet line of ${name}.expected.json`, () => {
      const reading = JSON.parse(readFileSync(file, "utf8")) as SheetReading;
      const out = applyDietRules(reading);
      if (reading.dietLine === null) {
        expect(out).toBeNull();
        return;
      }
      expect(out?.recognisedType).toBeTypeOf("string");
      expect(["low_salt", "low_fat", "diabetic", "light", "other"]).toContain(out?.recognisedType);
      expect(out?.spoken.yue.startsWith(reading.dietLine.spoken.yue)).toBe(true);
      expect(out?.spoken.cmn.startsWith(reading.dietLine.spoken.cmn)).toBe(true);
    });
  }
});
