import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CARD_ORDER, buildCards, cardTitle } from "@/lib/rules/card-order";
import type {
  CardType,
  FollowUpItem,
  Medicine,
  SheetReading,
  SourceReference,
  Speakable,
  TextLine,
  UnreadableRegion,
  WarningSign,
} from "@/lib/domain/schemas";

const sp = (yue: string, cmn: string, en = `[en] ${yue}`): Speakable => ({ yue, cmn, en });
const src = (section: string, lineIndex: number | null, quote: string): SourceReference => ({
  section,
  lineIndex,
  quote,
});

const warning = (n: number): WarningSign => ({
  symptom: sp(`發燒${n}`, `发烧${n}`),
  action: sp("即刻返急症室", "马上回急诊"),
  source: src("Warning Signs", n, `fever ${n}`),
});

const medicine = (n: number, over: Partial<Medicine> = {}): Medicine => ({
  name: `Amoxicillin ${n}`,
  strength: "500 mg",
  amount: "1 cap",
  frequency: n === 0 ? null : "TDS",
  duration: "5 days",
  status: "current",
  spoken: sp(`食Amoxicillin ${n}`, `吃Amoxicillin ${n}`),
  source: src("Discharge Medication(s)", n, `Amoxicillin ${n} 500mg`),
  ...over,
});

const followUp = (n: number): FollowUpItem => ({
  clinic: `SOPD ${n}`,
  when: "2/52",
  tests: null,
  spoken: sp(`兩個星期後覆診${n}`, `两周后复诊${n}`),
  source: src("Follow-up Plan", n, `SOPD 2/52`),
});

const textLine = (text: string): TextLine => ({
  text,
  spoken: sp(text, text),
  source: src("Advice", 0, text),
});

const unreadable = (
  n: number,
  description: string,
  field: string | null = null,
): UnreadableRegion => ({
  section: `Section ${n}`,
  field,
  description,
  source: src(`Section ${n}`, null, ""),
});

function reading(over: Partial<SheetReading> = {}): SheetReading {
  return {
    sheetType: "hk_en",
    warningSigns: [],
    medicines: [],
    followUp: [],
    dietLine: null,
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
    ...over,
  };
}

const full = (): SheetReading =>
  // Fields deliberately written out of order: the output order must not depend on this.
  ({
    unreadable: [unreadable(0, "個角影唔到"), unreadable(1, "")],
    activityLine: textLine("休息一星期"),
    dietLine: {
      raw: "低盐饮食",
      spoken: sp("張紙寫住低鹽飲食", "这张纸写着低盐饮食"),
      source: src("出院医嘱", 3, "低盐饮食"),
    },
    followUp: [followUp(0), followUp(1)],
    medicines: [medicine(0), medicine(1), medicine(2)],
    warningSigns: [warning(0), warning(1)],
    hospitalContact: textLine("查詢電話 2255 3838"),
    sheetType: "hk_en",
  });

describe("CARD_ORDER", () => {
  it("is red flags first and fixed", () => {
    expect(CARD_ORDER).toEqual(["warning", "medicine", "followUp", "diet", "activity", "unreadable"]);
  });
});

describe("buildCards ordering", () => {
  it("emits cards strictly in CARD_ORDER whatever order the reading was written in", () => {
    const cards = buildCards(full());
    expect(cards.map((c) => c.type)).toEqual([
      "warning",
      "warning",
      "medicine",
      "medicine",
      "medicine",
      "followUp",
      "followUp",
      "diet",
      "activity",
      "unreadable",
      "unreadable",
    ]);
  });

  it("never lets a later type outrank an earlier one", () => {
    const cards = buildCards(full());
    const ranks = cards.map((c) => CARD_ORDER.indexOf(c.type === "noWarnings" ? "warning" : c.type));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("keeps ids stable across builds of the same reading", () => {
    const r = full();
    expect(buildCards(r).map((c) => c.id)).toEqual(buildCards(r).map((c) => c.id));
    expect(buildCards(r).map((c) => c.id)).toEqual([
      "warning-0",
      "warning-1",
      "medicine-0",
      "medicine-1",
      "medicine-2",
      "followup-0",
      "followup-1",
      "diet",
      "activity",
      "unreadable-0",
      "unreadable-1",
    ]);
  });

  it("produces no cards for a sheet it does not recognise (FR-006)", () => {
    expect(buildCards({ ...full(), sheetType: "unknown" })).toEqual([]);
  });

  it("skips the cards whose lines are not printed", () => {
    const cards = buildCards(reading({ warningSigns: [warning(0)], medicines: [medicine(0)] }));
    expect(cards.map((c) => c.type)).toEqual(["warning", "medicine"]);
  });
});

describe("the noWarnings card", () => {
  it("is absent whenever warning signs are printed", () => {
    const cards = buildCards(full());
    expect(cards.some((c) => c.type === "noWarnings")).toBe(false);
  });

  it("is exactly one card, first, when no warning signs are printed", () => {
    const cards = buildCards(reading({ medicines: [medicine(0)], unreadable: [unreadable(0, "blur")] }));
    const noWarnings = cards.filter((c) => c.type === "noWarnings");
    expect(noWarnings).toHaveLength(1);
    expect(cards[0].id).toBe("no-warnings");
    expect(cards[0].aiGenerated).toBe(false);
    expect(cards[0].source).toBeNull();
    expect(cards[0].body.yue).toBe("張紙冇印警號。如果覺得唔妥，打返醫院或者去急症室。");
    expect(cards[0].body.cmn).toBe("这张纸没有印警示症状。如果觉得不舒服，打回医院或者去急诊。");
  });

  it("appends the hospital contact line and takes its source when one is printed", () => {
    const contact = textLine("查詢電話 2255 3838");
    const cards = buildCards(reading({ hospitalContact: contact }));
    expect(cards[0].body.yue).toContain("查詢電話 2255 3838");
    expect(cards[0].body.cmn).toContain("查詢電話 2255 3838");
    expect(cards[0].source).toEqual(contact.source);
  });
});

describe("card bodies and provenance", () => {
  it("gives every card a source except noWarnings", () => {
    for (const r of [full(), reading({ medicines: [medicine(0)] })]) {
      for (const card of buildCards(r)) {
        if (card.type === "noWarnings" || card.type === "referral") continue;
        expect(card.source, `${card.id} has no source`).not.toBeNull();
        expect(card.source?.section.length).toBeGreaterThan(0);
      }
    }
  });

  it("joins a warning symptom and its action", () => {
    const [card] = buildCards(reading({ warningSigns: [warning(0)] }));
    expect(card.body.yue).toBe("發燒0，即刻返急症室");
    expect(card.body.cmn).toBe("发烧0，马上回急诊");
    // English joins with an ASCII comma, not a full-width one.
    expect(card.body.en).toBe("[en] 發燒0, [en] 即刻返急症室");
    expect(card.aiGenerated).toBe(true);
    expect(card.facts).toEqual({
      symptom: "發燒0",
      action: "即刻返急症室",
      symptomEn: "[en] 發燒0",
      actionEn: "[en] 即刻返急症室",
    });
  });

  it("keeps the action as is when it already contains the symptom", () => {
    const sign: WarningSign = {
      symptom: sp("發燒", "发烧"),
      action: sp("發燒就即刻返急症室", "发烧就马上回急诊"),
      source: src("Warning Signs", 0, "fever"),
    };
    const [card] = buildCards(reading({ warningSigns: [sign] }));
    expect(card.body.yue).toBe("發燒就即刻返急症室");
    expect(card.body.cmn).toBe("发烧就马上回急诊");
  });

  it("carries the medicine fields verbatim as facts", () => {
    const cards = buildCards(reading({ warningSigns: [warning(0)], medicines: [medicine(0)] }));
    const card = cards.find((c) => c.id === "medicine-0");
    expect(card?.body).toEqual(medicine(0).spoken);
    expect(card?.facts).toEqual({
      name: "Amoxicillin 0",
      strength: "500 mg",
      amount: "1 cap",
      frequency: null,
      duration: "5 days",
      status: "current",
    });
    // Nothing marks an ordinary medicine, so an existing card is byte-identical to before.
    expect(card?.stopped).toBeUndefined();
  });

  /**
   * The sheet in tests/eval/stress.md prints 「停用药物（出院后不再服用）」 above two real dose
   * lines. Dropping them would hide from the family that the page names those drugs at all; the
   * card is what tells them, and the flag is what stops it being rendered as a dose that is due.
   */
  it("still shows a medicine the page has stopped, flagged and never as a dose to take", () => {
    const digoxin = medicine(0, {
      name: "Digoxin",
      strength: "0.25mg",
      frequency: "每日一次",
      status: "stopped",
      source: src("停用药物（出院后不再服用）", 0, "Digoxin 0.25mg，每日一次，已于住院第2天停用。"),
    });
    const cards = buildCards(reading({ medicines: [medicine(1), digoxin] }));
    const stopped = cards.find((c) => c.id === "medicine-1");

    expect(stopped?.type).toBe("medicine");
    expect(stopped?.stopped).toBe(true);
    expect(stopped?.facts?.status).toBe("stopped");
    // The printed fields are still verbatim — the card reports the page, it does not censor it.
    expect(stopped?.facts?.frequency).toBe("每日一次");
    expect(stopped?.source?.section).toBe("停用药物（出院后不再服用）");
    // and the ordinary one beside it is untouched.
    expect(cards.find((c) => c.id === "medicine-0")?.stopped).toBeUndefined();
  });

  it("flags a changed dose the same way", () => {
    const cards = buildCards(reading({ medicines: [medicine(1, { status: "changed" })] }));
    const card = cards.find((c) => c.type === "medicine");
    expect(card?.stopped).toBe(true);
    expect(card?.facts?.status).toBe("changed");
  });

  it("puts the unreadable field path in facts and never in the spoken body", () => {
    const cards = buildCards(
      reading({ unreadable: [unreadable(0, "拇指遮住咗", "followUp[0].when")] }),
    );
    const card = cards.find((c) => c.type === "unreadable");
    expect(card?.facts?.field).toBe("followUp[0].when");
    for (const text of [card?.body.yue, card?.body.cmn, card?.body.en]) {
      expect(text).not.toContain("followUp[0].when");
    }
  });

  it("wraps an unreadable region in rule wording and flags the model's description", () => {
    const cards = buildCards(
      reading({ warningSigns: [warning(0)], unreadable: [unreadable(0, "個角影唔到"), unreadable(1, "")] }),
    );
    const [first, second] = cards.filter((c) => c.type === "unreadable");
    expect(first.body.yue).toBe("呢部分讀唔到：Section 0。個角影唔到");
    expect(first.body.cmn).toBe("这部分读不到：Section 0。個角影唔到");
    expect(first.aiGenerated).toBe(true);
    expect(second.body.yue).toBe("呢部分讀唔到：Section 1。");
    expect(second.aiGenerated).toBe(false);
  });
});

/** Every card type, so the checks below cover all of them. */
const ALL_CARD_TYPES: CardType[] = [
  "warning",
  "noWarnings",
  "medicine",
  "followUp",
  "diet",
  "activity",
  "unreadable",
  "referral",
];

describe("rule-generated wording", () => {
  it("never uses a banned term and never states a number about the person", () => {
    const banned = [
      "診斷", "诊断", "治療", "治疗", "處方", "处方", "治癒", "治愈",
      "能吃", "不能吃", "唔食得", "建議你", "建议你", "diagnos", "treat", "cure", "prescri",
    ];
    const digitFreeRegion: UnreadableRegion = {
      section: "出院醫囑",
      // A field path such as "medicines[5].duration" has digits in it, which is exactly why
      // buildCards keeps `field` out of the rule-written body and puts it in `facts` instead.
      field: null,
      description: "",
      source: src("出院醫囑", null, ""),
    };
    const ruleWritten = [
      ...buildCards(reading({ unreadable: [digitFreeRegion] }))
        .filter((c) => !c.aiGenerated)
        .flatMap((c) => [c.body.yue, c.body.cmn]),
      ...(["hant", "hans"] as const).flatMap((script) => ALL_CARD_TYPES.map((t) => cardTitle(t, script))),
    ];
    expect(ruleWritten.length).toBeGreaterThan(4);
    for (const text of ruleWritten) {
      expect(text, `"${text}" states a number`).not.toMatch(/\d/);
      for (const term of banned) {
        expect(text.toLowerCase(), `"${text}" contains "${term}"`).not.toContain(term.toLowerCase());
      }
    }
  });
});

describe("cardTitle", () => {
  const expected: [CardType, string, string][] = [
    ["warning", "警號", "警示"],
    ["noWarnings", "警號", "警示"],
    ["medicine", "藥", "药"],
    ["followUp", "覆診", "复诊"],
    ["diet", "飲食", "饮食"],
    ["activity", "活動", "活动"],
    ["unreadable", "讀唔到", "读不到"],
    ["referral", "資源", "资源"],
  ];

  for (const [type, hant, hans] of expected) {
    it(`${type} → ${hant} / ${hans}`, () => {
      expect(cardTitle(type, "hant")).toBe(hant);
      expect(cardTitle(type, "hans")).toBe(hans);
    });
  }
});

const fixtureDir = path.resolve(__dirname, "../../fixtures/sheets");

describe("fixtures", () => {
  // Fixtures land with task T006; until then there is nothing to check here.
  for (const name of ["hk_en", "cn_zh"] as const) {
    const file = path.join(fixtureDir, `${name}.expected.json`);
    it.skipIf(!existsSync(file))(`${name}: three warning cards, then three medicine cards`, () => {
      const cards = buildCards(JSON.parse(readFileSync(file, "utf8")) as SheetReading);
      expect(cards.slice(0, 3).map((c) => c.type)).toEqual(["warning", "warning", "warning"]);
      expect(cards.slice(3, 6).map((c) => c.type)).toEqual(["medicine", "medicine", "medicine"]);
      expect(cards.slice(0, 6).map((c) => c.id)).toEqual([
        "warning-0",
        "warning-1",
        "warning-2",
        "medicine-0",
        "medicine-1",
        "medicine-2",
      ]);
    });
  }

  const photo = path.join(fixtureDir, "cn_zh_photo.expected.json");
  it.skipIf(!existsSync(photo))("cn_zh_photo: the unreadable regions become cards", () => {
    const r = JSON.parse(readFileSync(photo, "utf8")) as SheetReading;
    expect(r.unreadable.length).toBeGreaterThan(0);
    const cards = buildCards(r);
    if (r.sheetType === "unknown") {
      // FR-006: an unrecognised sheet produces nothing at all.
      expect(cards).toEqual([]);
      return;
    }
    expect(cards.filter((c) => c.type === "unreadable")).toHaveLength(r.unreadable.length);
    expect(cards.at(-1)?.type).toBe("unreadable");
  });
});
