import { describe, expect, it } from "vitest";
import { CardTypeSchema, type CardType, type Speakable } from "@/lib/domain/schemas";
import { checkSpeakable, checkText } from "@/lib/rules/banned-terms";
import {
  CAUTION_SUFFIX,
  NOT_ON_SHEET,
  REFUSED_MEDICINE_CHANGE,
  templateFor,
  type TemplateFacts,
} from "@/lib/rules/template-fallback";

/** Representative facts per card type, in the shape `Card.facts` carries. */
const FACTS: Record<CardType, TemplateFacts> = {
  warning: {
    symptom: "發燒超過 38 度",
    action: "即刻返急症室",
    symptomEn: "her fever goes over 38 degrees",
    actionEn: "go straight back to A&E",
  },
  medicine: {
    name: "Amlodipine",
    strength: "5mg",
    amount: "1 粒",
    frequency: "每日一次",
    duration: "14 日",
  },
  followUp: { clinic: "內科門診", when: "2026-09-15 上午 9:30", tests: "抽血" },
  diet: { raw: "低鹽低脂飲食" },
  activity: { text: "兩星期內唔好提重嘢" },
  unreadable: { section: "覆診安排", description: "呢一格影得太矇" },
  noWarnings: {},
  referral: {},
};

/** The three spoken forms, in the order they are written everywhere else. */
const FORMS = ["yue", "cmn", "en"] as const;

function expectClean(label: string, spoken: Speakable): void {
  for (const dialect of FORMS) {
    const result = checkText(spoken[dialect]);
    expect(
      result.ok,
      `${label} (${dialect}) hit the filter with ${JSON.stringify(result.matches)}: ${spoken[dialect]}`,
    ).toBe(true);
    expect(spoken[dialect].length, `${label} has an empty ${dialect} line`).toBeGreaterThan(0);
  }
  expect(checkSpeakable(spoken).ok, `${label} failed checkSpeakable`).toBe(true);
}

describe("templateFor — every card type passes the banned-term filter", () => {
  const allTypes = CardTypeSchema.options;

  it("covers every CardType in the schema", () => {
    expect(Object.keys(FACTS).sort()).toEqual([...allTypes].sort());
  });

  for (const type of allTypes) {
    it(`${type}: all three spoken forms are clean`, () => {
      expectClean(type, templateFor(type, FACTS[type]));
    });

    it(`${type}: stays clean with no facts at all`, () => {
      expectClean(`${type} (no facts)`, templateFor(type, {}));
    });
  }
});

/**
 * The trilingual guarantee itself, kept separate from the filter suite: a card type that quietly
 * stopped filling one of the three would still pass every "is it clean" assertion above, because
 * an empty string is clean.
 */
describe("templateFor returns all three spoken forms for every card type", () => {
  const allTypes = CardTypeSchema.options;

  for (const type of allTypes) {
    it(`${type}: yue, cmn and en are all present, non-empty and distinct keys`, () => {
      for (const facts of [FACTS[type], {}]) {
        const spoken = templateFor(type, facts);
        expect(Object.keys(spoken).sort()).toEqual(["cmn", "en", "yue"]);
        for (const form of FORMS) {
          expect(typeof spoken[form], `${type}.${form} is not a string`).toBe("string");
          expect(spoken[form].trim().length, `${type}.${form} is empty`).toBeGreaterThan(0);
        }
      }
    });
  }

  it("writes the English form in Latin script, not a copy of the Chinese one", () => {
    for (const type of allTypes) {
      const spoken = templateFor(type, FACTS[type]);
      expect(spoken.en, `${type} repeats the yue line as its en line`).not.toBe(spoken.yue);
      expect(spoken.en, `${type} repeats the cmn line as its en line`).not.toBe(spoken.cmn);
      // The frame is English even when a verbatim fact inside it is Chinese.
      expect(spoken.en, `${type} has no Latin words in its en line`).toMatch(/[A-Za-z]{3,}/);
    }
  });
});

describe("templateFor — medicine", () => {
  it("keeps the drug name, strength and numbers verbatim", () => {
    const spoken = templateFor("medicine", FACTS.medicine);
    for (const dialect of FORMS) {
      expect(spoken[dialect]).toContain("Amlodipine");
      expect(spoken[dialect]).toContain("5mg");
      expect(spoken[dialect]).toContain("1 粒");
      expect(spoken[dialect]).toContain("每日一次");
      expect(spoken[dialect]).toContain("14 日");
    }
  });

  it("says the usage is not printed when frequency is null", () => {
    const spoken = templateFor("medicine", { ...FACTS.medicine, frequency: null });
    expect(spoken.yue).toContain("冇印");
    expect(spoken.yue).toContain("藥劑師");
    expect(spoken.cmn).toMatch(/没有印|未印/);
    expect(spoken.cmn).toContain("药剂师");
    expect(spoken.en).toContain("isn't printed");
    expect(spoken.en).toContain("pharmacist");
    expect(spoken.yue).toContain("Amlodipine");
    expect(spoken.cmn).toContain("Amlodipine");
    expect(spoken.en).toContain("Amlodipine");
    expectClean("medicine (no frequency)", spoken);
  });

  it("does not translate a Chinese drug name either", () => {
    const spoken = templateFor("medicine", {
      name: "阿莫西林膠囊",
      strength: "0.5g",
      amount: "2 粒",
      frequency: "每日三次",
      duration: null,
    });
    // The English line keeps the Chinese drug name too: a name is never transliterated.
    expect(spoken.yue).toContain("阿莫西林膠囊");
    expect(spoken.cmn).toContain("阿莫西林膠囊");
    expect(spoken.en).toContain("阿莫西林膠囊");
    expect(spoken.yue).toContain("0.5g");
    expect(spoken.en).toContain("0.5g");
    expectClean("medicine (chinese name)", spoken);
  });

  it("drops the clauses whose facts are missing, with no dangling punctuation", () => {
    const spoken = templateFor("medicine", {
      name: "Panadol",
      strength: null,
      amount: null,
      frequency: null,
      duration: null,
    });
    expect(spoken.yue).not.toContain("，，");
    expect(spoken.cmn).not.toContain("，，");
    expect(spoken.en).not.toContain(", ,");
    expect(spoken.en).not.toContain("Panadol,");
    expect(spoken.yue).toContain("冇印");
    expectClean("medicine (name only)", spoken);
  });
});

/**
 * The stopped-medicine fallback, and why it exists.
 *
 * On the `mixed` stress fixture, one live run in three has the model write `spoken` text for the
 * entries under 「停用药物（出院后不再服用）」 that reads like a live dose — "Digoxin 0.25mg 每日" —
 * and the numeric-target rule catches it. That is the filter working. What was not working was
 * what came next: the card fell back to a generic "look at the sheet" sentence and the drug's
 * name disappeared, which is the one thing the family must not lose.
 */
describe("templateFor — a medicine the page has stopped", () => {
  const DIGOXIN: TemplateFacts = {
    name: "Digoxin",
    strength: "0.25mg",
    amount: "1 粒",
    frequency: "每日一次",
    duration: "14 日",
    status: "stopped",
  };

  const GLIMEPIRIDE: TemplateFacts = {
    name: "Glimepiride",
    strength: "2mg",
    amount: null,
    frequency: "每日一次，早餐前服",
    duration: null,
    status: "stopped",
  };

  it("names the drug and its strength verbatim, in all three forms", () => {
    for (const facts of [DIGOXIN, GLIMEPIRIDE]) {
      const spoken = templateFor("medicine", facts);
      for (const dialect of FORMS) {
        expect(spoken[dialect]).toContain(facts.name as string);
        expect(spoken[dialect]).toContain(facts.strength as string);
      }
    }
  });

  it("says the PAGE stopped it, and never tells the reader what to do", () => {
    const spoken = templateFor("medicine", DIGOXIN);
    expect(spoken.yue).toContain("張紙寫住");
    expect(spoken.yue).toContain("唔使再食");
    expect(spoken.cmn).toContain("纸上写着");
    expect(spoken.cmn).toContain("不用再吃");
    expect(spoken.en).toContain("The sheet lists");
    expect(spoken.en).toContain("no longer to be taken");
    // Never an instruction in the app's own voice.
    for (const dialect of FORMS) {
      for (const imperative of ["唔好食", "不要吃", "别吃", "stop taking", "do not take"]) {
        expect(spoken[dialect].toLowerCase()).not.toContain(imperative.toLowerCase());
      }
    }
  });

  /**
   * The dose clause is exactly what tripped the filter, so it must not come back through the
   * fallback. A withdrawn drug is never spoken with a frequency, an amount or a duration.
   */
  it("carries no frequency, no amount and no duration at all", () => {
    for (const facts of [DIGOXIN, GLIMEPIRIDE]) {
      const spoken = templateFor("medicine", facts);
      for (const dialect of FORMS) {
        expect(spoken[dialect]).not.toContain("每日");
        expect(spoken[dialect]).not.toContain("每天");
        expect(spoken[dialect]).not.toContain("1 粒");
        expect(spoken[dialect]).not.toContain("14 日");
        expect(spoken[dialect]).not.toContain("早餐前服");
      }
    }
  });

  it("passes the banned-term filter on the exact strings that failed live", () => {
    expectClean("medicine (stopped, Digoxin)", templateFor("medicine", DIGOXIN));
    expectClean("medicine (stopped, Glimepiride)", templateFor("medicine", GLIMEPIRIDE));
    expectClean(
      "medicine (stopped) + caution",
      (() => {
        const spoken = templateFor("medicine", DIGOXIN);
        return {
          yue: `${spoken.yue}${CAUTION_SUFFIX.yue}`,
          cmn: `${spoken.cmn}${CAUTION_SUFFIX.cmn}`,
          en: `${spoken.en} ${CAUTION_SUFFIX.en}`,
        };
      })(),
    );
    // The rejected phrasing itself is caught — this is the shape the fallback replaces.
    expect(checkText("Digoxin 0.25mg 每日").ok).toBe(false);
  });

  it("says something different, and no less honest, for a dose the stay changed", () => {
    const spoken = templateFor("medicine", { ...DIGOXIN, status: "changed" });
    expect(spoken.yue).toContain("Digoxin");
    expect(spoken.yue).toContain("另外列開");
    expect(spoken.cmn).toContain("另外列开");
    expect(spoken.en).toContain("apart from the medicines");
    // Still no dose clause, and still not a claim that the drug is finished.
    expect(spoken.yue).not.toContain("每日");
    expect(spoken.yue).not.toContain("唔使再食");
    expectClean("medicine (changed)", spoken);
  });

  it("leaves an ordinary medicine exactly as it was", () => {
    const plain = templateFor("medicine", FACTS.medicine);
    expect(templateFor("medicine", { ...FACTS.medicine, status: "current" })).toEqual(plain);
    expect(plain.yue).toContain("每日一次");
  });

  it("still says nothing at all when the page named no drug", () => {
    const spoken = templateFor("medicine", { name: null, status: "stopped" });
    expect(spoken.yue).toContain("讀唔到");
    expectClean("medicine (stopped, unnamed)", spoken);
  });
});

describe("templateFor — other card types", () => {
  it("warning repeats the symptom and the action from the sheet", () => {
    const spoken = templateFor("warning", FACTS.warning);
    expect(spoken.yue).toContain("發燒超過 38 度");
    expect(spoken.yue).toContain("即刻返急症室");
    expect(spoken.cmn).toContain("發燒超過 38 度");
    // The English sentence uses the English facts, not the Cantonese ones.
    expect(spoken.en).toContain("her fever goes over 38 degrees");
    expect(spoken.en).toContain("go straight back to A&E");
    expect(spoken.en).not.toContain("發燒");
  });

  it("warning falls back to the Chinese facts when no English pair was supplied", () => {
    const spoken = templateFor("warning", { symptom: "發燒超過 38 度", action: "即刻返急症室" });
    expect(spoken.en).toContain("The sheet says:");
    expect(spoken.en).toContain("發燒超過 38 度");
  });

  it("followUp keeps the clinic, the date and the tests", () => {
    const spoken = templateFor("followUp", FACTS.followUp);
    for (const dialect of FORMS) {
      expect(spoken[dialect]).toContain("內科門診");
      expect(spoken[dialect]).toContain("2026-09-15 上午 9:30");
      expect(spoken[dialect]).toContain("抽血");
    }
  });

  it("diet and activity quote the printed line", () => {
    expect(templateFor("diet", FACTS.diet).yue).toContain("低鹽低脂飲食");
    expect(templateFor("diet", FACTS.diet).en).toContain("低鹽低脂飲食");
    expect(templateFor("activity", FACTS.activity).cmn).toContain("兩星期內唔好提重嘢");
    expect(templateFor("activity", FACTS.activity).en).toContain("兩星期內唔好提重嘢");
  });

  it("unreadable names the section it could not read", () => {
    const spoken = templateFor("unreadable", FACTS.unreadable);
    expect(spoken.yue).toContain("呢部分讀唔到：覆診安排。");
    expect(spoken.cmn).toContain("这部分读不到：覆診安排。");
    expect(spoken.en).toContain("This part couldn't be read: 覆診安排.");
  });

  it("noWarnings says so and points at the hospital, per constitution II", () => {
    const spoken = templateFor("noWarnings", {});
    expect(spoken.yue).toBe("張紙冇印警號。如果覺得唔妥，打返醫院或者去急症室。");
    expect(spoken.cmn).toContain("没有印警号");
    expect(spoken.cmn).toContain("医院");
    expect(spoken.en).toContain("doesn't print any warning signs");
    expect(spoken.en).toContain("A&E");
  });

  it("referral points at the resource list already on screen", () => {
    const spoken = templateFor("referral", {});
    expect(spoken.yue).toContain("資源清單");
    expect(spoken.cmn).toContain("资源清单");
    expect(spoken.en).toContain("on the screen");
  });

  it("throws on an unknown card type", () => {
    expect(() => templateFor("nonsense" as unknown as CardType, {})).toThrow(/Unknown card type/);
  });
});

describe("fixed refusals and the caution suffix", () => {
  it("NOT_ON_SHEET passes the filter", () => {
    expectClean("NOT_ON_SHEET", NOT_ON_SHEET);
    expect(NOT_ON_SHEET.yue).toBe("張紙冇講呢樣。可以問藥劑師或者打張紙上面嘅電話。");
    expect(NOT_ON_SHEET.en).toBe(
      "The sheet doesn't say. Ask the pharmacist, or ring the number printed on the sheet.",
    );
  });

  it("REFUSED_MEDICINE_CHANGE passes the filter and avoids 停藥 / 加藥 / 減藥", () => {
    expectClean("REFUSED_MEDICINE_CHANGE", REFUSED_MEDICINE_CHANGE);
    for (const dialect of FORMS) {
      const line = REFUSED_MEDICINE_CHANGE[dialect];
      for (const banned of ["停藥", "停药", "加藥", "加药", "減藥", "减药", "唔食得", "不能吃"]) {
        expect(line, `${dialect} must not contain ${banned}`).not.toContain(banned);
      }
    }
    expect(REFUSED_MEDICINE_CHANGE.yue).toContain("藥劑師");
    expect(REFUSED_MEDICINE_CHANGE.cmn).toContain("药剂师");
    // The English twin has to dodge "you should" the same way the Chinese one dodges 建議你.
    expect(REFUSED_MEDICINE_CHANGE.en).toContain("pharmacist");
    expect(REFUSED_MEDICINE_CHANGE.en).toContain("the sheet doesn't say");
    expect(REFUSED_MEDICINE_CHANGE.en.toLowerCase()).not.toContain("you should");
  });

  it("CAUTION_SUFFIX labels AI output and passes the filter", () => {
    expectClean("CAUTION_SUFFIX", CAUTION_SUFFIX);
    expect(CAUTION_SUFFIX.yue).toBe("AI 寫嘅，可能有錯。");
    expect(CAUTION_SUFFIX.cmn).toBe("AI 写的，可能有错。");
    expect(CAUTION_SUFFIX.en).toBe("Written by AI — it can get things wrong.");
  });

  it("a template with the caution suffix appended still passes", () => {
    const spoken = templateFor("medicine", FACTS.medicine);
    expectClean("medicine + caution", {
      yue: `${spoken.yue}${CAUTION_SUFFIX.yue}`,
      cmn: `${spoken.cmn}${CAUTION_SUFFIX.cmn}`,
      en: `${spoken.en} ${CAUTION_SUFFIX.en}`,
    });
  });
});
