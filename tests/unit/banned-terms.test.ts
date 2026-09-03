import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/domain/schemas";
import {
  BANNED_TERMS,
  BANNED_TERM_SUMMARY,
  ALL_BANNED_RULES,
  checkCard,
  checkSpeakable,
  checkText,
  isExemptQuote,
  normalise,
} from "@/lib/rules/banned-terms";

/** Every group of research.md R14 must be populated. */
describe("BANNED_TERMS", () => {
  it("has all three groups and unique rule ids", () => {
    expect(BANNED_TERMS.zh.length).toBeGreaterThan(0);
    expect(BANNED_TERMS.en.length).toBeGreaterThan(0);
    expect(BANNED_TERMS.numeric.length).toBeGreaterThan(0);
    const ids = ALL_BANNED_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of ALL_BANNED_RULES) {
      expect(rule.pattern.flags, `${rule.id} needs the g flag for matchAll`).toContain("g");
    }
  });

  it("exposes a human-readable summary for the submission document", () => {
    expect(BANNED_TERM_SUMMARY.length).toBe(ALL_BANNED_RULES.length);
    for (const label of BANNED_TERM_SUMMARY) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("checkText — Chinese hits in both scripts", () => {
  const hits: [name: string, text: string][] = [
    ["diagnose (traditional)", "醫生嘅診斷係肺炎"],
    ["diagnose (simplified)", "医生的诊断是肺炎"],
    ["treat (traditional)", "呢個治療要做兩星期"],
    ["treat (simplified)", "这个治疗要做两星期"],
    ["prescribe (traditional)", "醫生開咗處方"],
    ["prescribe (simplified)", "医生开了处方"],
    ["cure (traditional)", "食完就會治癒"],
    ["cure (simplified)", "吃完就会治愈"],
    ["can eat", "呢啲嘢能吃"],
    ["cannot eat", "呢啲嘢不能吃"],
    ["cannot eat, Cantonese", "呢啲嘢唔食得"],
    ["食得 followed by 唔", "呢個食得唔食得？"],
    ["建議你 + verb (traditional)", "建議你食少啲鹽"],
    ["建议你 + verb (simplified)", "建议你吃少点盐"],
    ["應該 + 食 (traditional)", "你應該食多啲菜"],
    ["应该 + 吃 (simplified)", "你应该吃多点菜"],
    ["stop medicine (traditional)", "可以停藥喇"],
    ["stop medicine (simplified)", "可以停药了"],
    ["add medicine (traditional)", "要加藥"],
    ["add medicine (simplified)", "要加药"],
    ["reduce medicine (traditional)", "可以減藥"],
    ["reduce medicine (simplified)", "可以减药"],
  ];
  for (const [name, text] of hits) {
    it(`flags ${name}`, () => {
      const result = checkText(text);
      expect(result.ok, `expected a hit in ${text}, got none`).toBe(false);
      expect(result.matches.length).toBeGreaterThan(0);
    });
  }
});

describe("checkText — English hits", () => {
  const hits: [name: string, text: string][] = [
    ["diagnos*", "This is a diagnosis of pneumonia"],
    ["diagnose", "We diagnose the condition"],
    ["treat*", "Continue the treatment at home"],
    ["cure*", "This will cure the infection"],
    ["prescri*", "The prescription is attached"],
    ["you should", "You should rest for a week"],
    ["you must", "You must avoid salt"],
    ["safe to eat", "Congee is safe to eat"],
    ["cannot eat", "You cannot eat seafood"],
    ["can eat", "She can eat rice"],
  ];
  for (const [name, text] of hits) {
    it(`flags ${name}`, () => {
      expect(checkText(text).ok, `expected a hit in ${text}`).toBe(false);
    });
  }

  it("is case-insensitive", () => {
    expect(checkText("DIAGNOSIS").ok).toBe(false);
    expect(checkText("You Should Rest").ok).toBe(false);
  });
});

describe("checkText — numeric targets about the person", () => {
  const hits: [name: string, text: string][] = [
    ["grams per day", "鹽 2g/日"],
    ["克 per 天", "每次 5克/天"],
    ["mg per kg", "1.5 mg per kg"],
    ["g/day in English", "Keep salt under 5 g/day"],
    ["每天要 + number", "每天要食 60 克蔬菜"],
    ["每日需要 + number", "每日需要 1 杯水"],
    ["BP target before the number", "血壓目標 120/80"],
    ["BP target, simplified", "血压目标 130/85"],
    ["number before the keyword", "120/80 係目標"],
    ["English BP target", "Target BP 130/80"],
    ["mmol glucose", "空腹血糖 6.5 mmol/L"],
    ["mg/dL glucose", "Glucose 110 mg/dL"],
    ["kcal", "每餐 500 kcal"],
    ["卡路里", "一日 1800 卡路里"],
    ["大卡", "1500大卡"],
  ];
  for (const [name, text] of hits) {
    it(`flags ${name}`, () => {
      expect(checkText(text).ok, `expected a hit in ${text}`).toBe(false);
    });
  }
});

describe("checkText — near-misses that must pass", () => {
  const passes: [name: string, text: string][] = [
    ["a section heading inside prose", "Treatment and Outcome"],
    ["the heading with surrounding text", "Section: Treatment and Outcome, page 2"],
    ["a medicine strength", "5mg"],
    ["a sub-gram strength", "0.5g"],
    ["a strength with spacing", "0.5 g"],
    ["a full printed medicine line", "20mg 1 tab nocte"],
    ["the Cantonese word for BP medicine", "血壓藥"],
    ["the Mandarin word for BP medicine", "血压药"],
    ["a follow-up date", "2026-09-15"],
    ["a slashed date", "覆診日期 2026/09/15"],
    ["a plain dose count", "每次 1 粒"],
    ["a verbatim frequency", "每日一次"],
    ["a duration", "食 5 日"],
    ["retreat, no word boundary", "The patient will retreat to bed"],
    ["secure, no word boundary", "The dressing is secure"],
    ["procure, no word boundary", "Procured from the pharmacy"],
    ["a pharmacy phone line", "藥劑師電話 2300 6666"],
  ];
  for (const [name, text] of passes) {
    it(`passes ${name}`, () => {
      const result = checkText(text);
      expect(result.ok, `unexpected hits ${JSON.stringify(result.matches)} in ${text}`).toBe(true);
    });
  }

  it("does not read a medicine strength next to a frequency as a rate", () => {
    // The template always puts a comma between them; this is the shape it produces.
    expect(checkText("藥名 Amlodipine，5mg，每次 1粒，每日一次。").ok).toBe(true);
    expect(checkText("药名 Amlodipine，5毫克，每次 1粒，每日一次。").ok).toBe(true);
  });
});

describe("normalise", () => {
  it("folds full-width digits and punctuation so an evasion still matches", () => {
    expect(normalise("１２０／８０")).toBe("120/80");
    expect(checkText("血壓目標　１２０／８０").ok).toBe(false);
  });

  it("collapses whitespace so the Treatment-and-Outcome exemption still applies", () => {
    expect(normalise("Treatment   and\n Outcome")).toBe("Treatment and Outcome");
    expect(checkText("Treatment   and\n Outcome").ok).toBe(true);
  });

  it("drops zero-width characters used to split a banned term", () => {
    expect(checkText("診\u200B斷").ok).toBe(false);
    expect(checkText("治\uFEFF療").ok).toBe(false);
  });

  it("folds slash look-alikes", () => {
    expect(normalise(`120\u204480`)).toBe("120/80");
    expect(checkText(`血壓目標 120\u221580`).ok).toBe(false);
  });

  it("leaves the ideographic full stop alone (it is a rule boundary)", () => {
    expect(normalise("好。")).toBe("好。");
    // 應該 and 食 are in different sentences, so this is not advice to the person.
    expect(checkText("張紙話應該咁樣。食物名稱如下").ok).toBe(true);
  });
});

describe("checkSpeakable", () => {
  it("checks every spoken form and merges the matches", () => {
    expect(
      checkSpeakable({
        yue: "張紙冇印警號。",
        cmn: "纸上没有印警号。",
        en: "The sheet doesn't print any warning signs.",
      }).ok,
    ).toBe(true);
    const hit = checkSpeakable({ yue: "醫生嘅診斷", cmn: "这个治疗", en: "a clean english line" });
    expect(hit.ok).toBe(false);
    expect(hit.matches).toContain("診斷");
    expect(hit.matches).toContain("治疗");
  });

  it("catches a banned term that is only in the English form", () => {
    const hit = checkSpeakable({
      yue: "張紙冇印警號。",
      cmn: "纸上没有印警号。",
      en: "This is what treats the infection.",
    });
    expect(hit.ok, "an English-only hit slipped through checkSpeakable").toBe(false);
    expect(hit.matches).toContain("treats");
  });

  it("catches an English advice phrase the Chinese rules would never see", () => {
    for (const en of ["you should take two", "she cannot eat that", "it is safe to eat"]) {
      const hit = checkSpeakable({ yue: "張紙寫住。", cmn: "纸上写着。", en });
      expect(hit.ok, `"${en}" passed checkSpeakable`).toBe(false);
    }
  });
});

const quote = "Treatment and Outcome: pneumonia, treated with antibiotics";

function card(body: { yue: string; cmn: string; en: string }): Card {
  return {
    id: "c1",
    type: "warning",
    body,
    source: { section: "Treatment and Outcome", lineIndex: 0, quote },
    aiGenerated: true,
  };
}

describe("quote exemption", () => {
  it("checkCard checks the body only, never source.quote", () => {
    const clean = card({
      yue: "張紙寫住：如果發燒，即刻返醫院。",
      cmn: "纸上写着：如果发烧，马上回医院。",
      en: "The sheet says: if she has a fever, go straight back to hospital.",
    });
    const result = checkCard(clean);
    expect(result.ok, `unexpected hits ${JSON.stringify(result.matches)}`).toBe(true);
    // The quote itself would be flagged if it were checked.
    expect(checkText(quote).ok).toBe(false);
  });

  it("checkCard still flags a body that contains a banned term", () => {
    const dirty = card({
      yue: "醫生嘅診斷係肺炎。",
      cmn: "医生的诊断是肺炎。",
      en: "The doctor gave a diagnosis of pneumonia.",
    });
    expect(checkCard(dirty).ok).toBe(false);
  });

  it("isExemptQuote is true only for verbatim page text", () => {
    expect(isExemptQuote("treated with antibiotics", quote)).toBe(true);
    expect(isExemptQuote("Treatment and Outcome", quote)).toBe(true);
    expect(isExemptQuote("醫生嘅診斷係肺炎", quote)).toBe(false);
    expect(isExemptQuote("anything", null)).toBe(false);
    expect(isExemptQuote("", quote)).toBe(false);
  });
});
