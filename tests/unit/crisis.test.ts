import { describe, expect, it } from "vitest";
import { crisisReferral, detectCrisis } from "@/lib/rules/crisis";
import { REFERRAL, REFERRAL_RESOURCES, REFERRAL_LIST_IS_PLACEHOLDER } from "@/lib/i18n/referral";
import { checkText } from "@/lib/rules/banned-terms";

/**
 * FR-014 / User Story 1 scenario 10. The app does not do emotional support: only explicit
 * self-harm, suicide, overdose-with-intent or hopelessness carrying intent shows the referral
 * card. Caregiver exhaustion and "…死" idioms must not.
 */

const POSITIVES: string[] = [
  "我想自殺",
  "我想死",
  "佢話想去死",
  "我唔想活喇",
  "我不想活了",
  "活不下去了",
  "我想了結自己",
  "佢想尋死",
  "我想傷害自己",
  "想割脈",
  "想割腕",
  "我想吞晒啲藥",
  "佢食咗成樽藥",
  "我想食晒啲藥死咗佢",
  "服毒得唔得",
  "冇意思活落去",
  "撐唔住想走",
  "我想跳樓",
  "I want to kill myself",
  "I want to end my life",
  "I've been thinking about suicide",
  "I might hurt myself",
  "she doesn't want to live any more",
  "I want to overdose",
  "she took all the pills on purpose",
  "I can't go on",
];

/** Stress, idioms and ordinary sheet questions: no referral card. */
const NEGATIVES: string[] = [
  "好攰",
  "很累",
  "好煩",
  "壓力大",
  "照顧佢好辛苦",
  "佢個病嚴唔嚴重？",
  "白色嗰粒係朝早定夜晚食？",
  "呢隻藥食完會唔會死人？",
  "佢吞唔到藥點算？",
  "一次過食晒啲藥得唔得？",
  "我想問一次過食晒啲藥得唔得？",
  "佢食咗一排藥都未好",
  "佢受傷自己去咗醫院",
  "I'm exhausted",
  "this is hard",
  "she is very tired today",
  "can she take two tonight?",
];

/** Idiomatic "…死": extremely tired / annoyed, never intent. */
const IDIOMS: string[] = ["累死了", "煩死", "烦死我了", "笑死我", "攰到死", "熱死人"];

describe("detectCrisis — shows the referral card (FR-014)", () => {
  it("covers at least 12 positives", () => {
    expect(POSITIVES.length).toBeGreaterThanOrEqual(12);
  });

  for (const text of POSITIVES) {
    it(`flags ${text}`, () => {
      const result = detectCrisis(text);
      expect(result.crisis, `expected a crisis hit for ${text}`).toBe(true);
      expect(result.matched.length).toBeGreaterThan(0);
      expect(result.isAmbiguous).toBe(false);
    });
  }
});

describe("detectCrisis — ordinary stress and sheet questions pass through", () => {
  it("covers at least 10 negatives including the idioms", () => {
    expect(NEGATIVES.length + IDIOMS.length).toBeGreaterThanOrEqual(10);
  });

  for (const text of NEGATIVES) {
    it(`allows ${text}`, () => {
      const result = detectCrisis(text);
      expect(result.crisis, `unexpected crisis hit: ${result.matched}`).toBe(false);
      expect(result.isAmbiguous).toBe(false);
    });
  }

  for (const text of IDIOMS) {
    it(`treats ${text} as an idiom, not a crisis`, () => {
      const result = detectCrisis(text);
      expect(result.crisis).toBe(false);
      expect(result.isAmbiguous).toBe(true);
      expect(result.matched.length).toBeGreaterThan(0);
    });
  }

  it("does not trigger on 唔想死 / doesn't want to die", () => {
    expect(detectCrisis("佢話唔想死").crisis).toBe(false);
    expect(detectCrisis("我唔想死").crisis).toBe(false);
  });

  it("still triggers when a real phrase sits inside an idiom-heavy sentence", () => {
    const result = detectCrisis("煩死喇，我想死");
    expect(result.crisis).toBe(true);
    expect(result.isAmbiguous).toBe(false);
  });
});

describe("detectCrisis — normalisation", () => {
  it("folds full-width punctuation and letters", () => {
    expect(detectCrisis("我想自殺！！").crisis).toBe(true);
    expect(detectCrisis("Ｉ　ｗａｎｔ　ｔｏ　ｄｉｅ").crisis).toBe(true);
  });

  it("treats traditional and simplified alike", () => {
    for (const [trad, simp] of [
      ["我想自殺", "我想自杀"],
      ["我想傷害自己", "我想伤害自己"],
      ["想割脈", "想割脉"],
      ["我想了結自己", "我想了结自己"],
    ]) {
      expect(detectCrisis(trad).crisis).toBe(true);
      expect(detectCrisis(simp).crisis).toBe(true);
    }
  });

  it("ignores stray whitespace and handles mixed language", () => {
    expect(detectCrisis("我 想 自 殺").crisis).toBe(true);
    expect(detectCrisis("阿媽 said she doesn't want to live").crisis).toBe(true);
  });
});

describe("referral card", () => {
  it("returns fixed text plus the resource list for each input language", () => {
    for (const language of ["yue", "cmn", "en"] as const) {
      const card = crisisReferral(language);
      expect(card.text).toBe(REFERRAL[language]);
      expect(card.text.length).toBeGreaterThan(0);
      expect(card.resources).toBe(REFERRAL_RESOURCES);
    }
    expect(crisisReferral().text).toBe(REFERRAL.yue);
  });

  it("lists the Hong Kong, mainland and emergency numbers", () => {
    const numbers = REFERRAL_RESOURCES.map((r) => r.number);
    expect(numbers).toContain("2389 2222");
    expect(numbers).toContain("2896 0000");
    expect(numbers).toContain("12356");
    expect(numbers).toContain("999");
    expect(numbers).toContain("120");
  });

  /**
   * The organisers publish their own referral resources at the kickoff briefing, and until one is
   * added the submission checklist has to know. What it must NOT do is reach the screen: the slot
   * used to be a row whose name was the literal string "TODO: replace with organiser list" and
   * whose number was "TODO", and the referral card renders every row — so a person in crisis was
   * one match away from being handed the word TODO instead of a number.
   *
   * The flag now means "no organiser row yet" rather than "a broken row is present", so the list
   * can only ever contain lines somebody answers.
   */
  it("flags the missing organiser list without ever rendering a placeholder", () => {
    expect(REFERRAL_RESOURCES.filter((r) => r.region === "organiser")).toHaveLength(0);
    expect(REFERRAL_LIST_IS_PLACEHOLDER).toBe(true);

    for (const resource of REFERRAL_RESOURCES) {
      expect(resource.number).not.toMatch(/TODO/i);
      expect(resource.name).not.toMatch(/TODO/i);
      // Every row is a dialable number: digits and spaces only.
      expect(resource.number).toMatch(/^[0-9][0-9 ]*[0-9]$/);
    }
  });

  /**
   * Verified against the Centre for Health Protection's own "Seek help" page, not from memory.
   * A search summary consulted while writing this list gave the Hospital Authority's line as
   * 2382 0000, which is Suicide Prevention Services — a plausible wrong number is exactly what
   * survives review, and on this list it sends someone in trouble to the wrong place.
   */
  it("carries the Hospital Authority's own mental health line, correctly", () => {
    const ha = REFERRAL_RESOURCES.find((r) => r.name.includes("Mental Health Direct"));
    expect(ha?.number).toBe("2466 7350");
    expect(REFERRAL_RESOURCES.map((r) => r.number)).toContain("2382 0000");
  });

  it("carries no banned term and no diagnosis language (constitution VI)", () => {
    for (const language of ["yue", "cmn", "en"] as const) {
      const result = checkText(REFERRAL[language]);
      expect(result.ok, `${language}: ${result.matches.join(", ")}`).toBe(true);
    }
    for (const resource of REFERRAL_RESOURCES) {
      expect(checkText(resource.name).ok).toBe(true);
    }
  });
});
