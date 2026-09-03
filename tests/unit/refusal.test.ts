import { describe, expect, it } from "vitest";
import {
  detectMedicineChange,
  normaliseQuestion,
  type MedicineChangeReason,
} from "@/lib/rules/refusal";

/**
 * FR-011 / User Story 1 scenario 8. The table is the contract: every question that asks to
 * change, skip, stop, double, add or move a medicine must refuse before any model call, and
 * every question about what the sheet already prints must pass through.
 */

type Case = [question: string, reason: MedicineChangeReason];

const CANTONESE: Case[] = [
  ["可唔可以唔食？", "skip"],
  ["唔食得唔得？", "skip"],
  ["佢唔想食呢隻藥", "skip"],
  ["可以唔跟住食嗎？", "skip"],
  ["今晚唔食一次得唔得？", "skip"],
  ["停咗佢好唔好？", "stop"],
  ["可唔可以停藥？", "stop"],
  ["唔再食得唔得？", "stop"],
  ["食少啲得唔得？", "change_dose"],
  ["可唔可以食多啲？", "change_dose"],
  ["可唔可以減藥？", "change_dose"],
  ["想改藥得唔得？", "change_dose"],
  ["換藥好唔好？", "change_dose"],
  ["自己減得唔得？", "change_dose"],
  ["食半粒得唔得？", "change_dose"],
  ["一次食兩粒得唔得？", "double"],
  ["加多粒得唔得？", "double"],
  ["食多次得唔得？", "double"],
  ["一次過食晒得唔得？", "double"],
  ["漏咗食，補返兩粒好唔好？", "double"],
  ["可以加藥嗎？", "add"],
  ["可唔可以食多隻藥？", "add"],
  ["可以食埋啲維他命嗎？", "add"],
  ["可唔可以改晏晝食？", "timing_change"],
  ["遲啲先食得唔得？", "timing_change"],
];

const MANDARIN: Case[] = [
  ["能不能不吃？", "skip"],
  ["可以不吃吗？", "skip"],
  ["她不想吃药了", "skip"],
  ["可以停药吗？", "stop"],
  ["停药会怎样？", "stop"],
  ["少吃一点行吗？", "change_dose"],
  ["能减药吗？", "change_dose"],
  ["可以改药吗？", "change_dose"],
  ["换药可以吗？", "change_dose"],
  ["我自己调可以吗？", "change_dose"],
  ["多吃一片可以吗？", "double"],
  ["吃两片行不行？", "double"],
  ["一次吃两次的量行吗？", "double"],
  ["漏吃了要补吗？", "double"],
  ["想加药可以吗？", "add"],
  ["能不能晚点吃？", "timing_change"],
  ["可以把时间改到下午吗？", "timing_change"],
];

const ENGLISH: Case[] = [
  ["can she skip tonight's dose?", "skip"],
  ["can I not take the tablet?", "skip"],
  ["she doesn't want it — don't take it tonight?", "skip"],
  ["can I stop taking it?", "stop"],
  ["should she stop the tablet if she feels fine?", "stop"],
  ["should she double the dose?", "double"],
  ["can she take two tonight?", "double"],
  ["is an extra dose ok?", "double"],
  ["she missed a dose, should she take two?", "double"],
  ["can we halve the tablet?", "change_dose"],
  ["can I cut it in half?", "change_dose"],
  ["can I change the dose?", "change_dose"],
  ["can she switch to another medicine?", "change_dose"],
  ["can I adjust her medicine?", "change_dose"],
  ["can she also take panadol?", "add"],
  ["can I add a supplement?", "add"],
  ["can she take it later instead?", "timing_change"],
  ["can we change the dose time?", "timing_change"],
];

const POSITIVES: Case[] = [...CANTONESE, ...MANDARIN, ...ENGLISH];

/** Questions about what the sheet already prints. These MUST reach the model. */
const NEGATIVES: string[] = [
  "白色嗰粒係朝早定夜晚食？",
  "呢隻藥係咩嚟？",
  "幾時覆診？",
  "Metformin 要唔要隨餐？",
  "一日食幾多次？",
  "出院紙寫咗幾多隻藥？",
  "呢隻藥食幾耐？",
  "邊隻係降血壓藥？",
  "覆診要帶咩？",
  "一天要吃多少次？",
  "药单上写的是一天几次？",
  "when do I take the white pill",
  "what is Amlodipine for",
  "how many tablets did the doctor write",
  "what time is the follow-up appointment?",
  "does she take it with food?",
  "which pill is for blood pressure?",
  "does she also take it at night?",
  "可唔可以食多樣餸？",
];

describe("detectMedicineChange — refuses medicine changes (FR-011)", () => {
  it("covers at least 25 positives across Cantonese, Mandarin and English", () => {
    expect(POSITIVES.length).toBeGreaterThanOrEqual(25);
    expect(CANTONESE.length).toBeGreaterThan(0);
    expect(MANDARIN.length).toBeGreaterThan(0);
    expect(ENGLISH.length).toBeGreaterThan(0);
  });

  for (const [question, reason] of POSITIVES) {
    it(`refuses ${question} as ${reason}`, () => {
      const result = detectMedicineChange(question);
      expect(result.refuse, `expected a refusal for ${question}`).toBe(true);
      expect(result.reason).toBe(reason);
      expect(result.matched.length).toBeGreaterThan(0);
    });
  }
});

describe("detectMedicineChange — informational questions pass through", () => {
  it("covers at least 12 negatives", () => {
    expect(NEGATIVES.length).toBeGreaterThanOrEqual(12);
  });

  for (const question of NEGATIVES) {
    it(`allows ${question}`, () => {
      const result = detectMedicineChange(question);
      expect(result.refuse, `unexpected refusal (${result.reason}: ${result.matched})`).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.matched).toBe("");
    });
  }
});

describe("detectMedicineChange — normalisation", () => {
  it("folds full-width punctuation and letters (NFKC)", () => {
    expect(normaliseQuestion("可唔可以唔食？？！").compact).toBe("可唔可以唔食");
    expect(normaliseQuestion("ＳＫＩＰ　ｔｈｅ　ｄｏｓｅ").spaced).toBe("skip the dose");
    expect(detectMedicineChange("ＳＫＩＰ　ｔｈｅ　ｄｏｓｅ").reason).toBe("skip");
  });

  it("treats traditional and simplified forms of the same term alike", () => {
    for (const [trad, simp] of [
      ["停藥得唔得？", "停药得不得？"],
      ["可以減藥嗎？", "可以减药吗？"],
      ["換藥好唔好？", "换药好不好？"],
      ["食兩粒得唔得？", "吃两粒行不行？"],
    ]) {
      const a = detectMedicineChange(trad);
      const b = detectMedicineChange(simp);
      expect(a.refuse).toBe(true);
      expect(b.refuse).toBe(true);
      expect(a.reason).toBe(b.reason);
    }
  });

  it("ignores stray whitespace inside a Chinese phrase", () => {
    expect(detectMedicineChange("停 藥 得唔得").reason).toBe("stop");
  });

  it("handles mixed-language questions", () => {
    expect(detectMedicineChange("Metformin 可唔可以唔食？").reason).toBe("skip");
    expect(detectMedicineChange("can I 停药?").reason).toBe("stop");
    expect(detectMedicineChange("阿媽 missed a dose, 可以 take two 嗎？").reason).toBe("double");
    expect(detectMedicineChange("Metformin 要唔要隨餐？").refuse).toBe(false);
  });

  it("returns the matched substring so the refusal can be logged without the question", () => {
    expect(detectMedicineChange("可以停藥嗎？").matched).toContain("停药");
    expect(detectMedicineChange("can she take two?").matched).toContain("take two");
  });
});
