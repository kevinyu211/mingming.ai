/**
 * Unit tests for the follow-up plan rules (T036, US2 scenarios 2 and 3, FR-020, FR-021).
 *
 * The two real fixtures drive the shape tests, so what is asserted here is exactly what the UI
 * will render for the Hong Kong English and the mainland Chinese sheet. The rest is a table of
 * printed follow-up times: everything unambiguous parses, everything hedged, doubled or
 * order-ambiguous returns null, because the constitution's agent-limits constraint says every
 * date comes from the sheet and nothing is invented.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { SheetReadingSchema } from "@/lib/domain/schemas";
import type {
  FollowUpItem,
  Medicine,
  SheetReading,
  SourceReference,
  Speakable,
  StoredReading,
} from "@/lib/domain/schemas";
import { checkText } from "@/lib/rules/banned-terms";
import { draftPlan, expiryNotice, isExpired, parseFollowUpDate } from "@/lib/rules/plan-from-reading";
import type { FollowUpPlan as StoredFollowUpPlan, PlanItem as StoredPlanItem } from "@/lib/storage/local";

/* ------------------------------------------------------------------ fixtures */

const fixtureDir = path.resolve(__dirname, "../../fixtures/sheets");

function fixture(name: "hk_en" | "cn_zh"): SheetReading {
  return SheetReadingSchema.parse(
    JSON.parse(readFileSync(path.join(fixtureDir, `${name}.expected.json`), "utf8")),
  );
}

/** The client adds `readAt` and the recognised diet type before storing a reading. */
function stored(reading: SheetReading, readAt: string): StoredReading {
  return {
    ...reading,
    dietLine: reading.dietLine ? { ...reading.dietLine, recognisedType: "other" } : null,
    readAt,
  };
}

const READ_AT = "2026-09-02T08:30:00.000Z";

const sp = (text: string): Speakable => ({ yue: text, cmn: text, en: text });
const src = (quote: string): SourceReference => ({ section: "出院医嘱", lineIndex: 0, quote });

function sheet(parts: Partial<SheetReading> = {}): SheetReading {
  return {
    sheetType: "hk_en",
    warningSigns: [],
    medicines: [],
    followUp: [],
    dietLine: null,
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
    ...parts,
  };
}

function followUp(parts: Partial<FollowUpItem> = {}): FollowUpItem {
  return {
    clinic: "SOPD",
    when: "2/52",
    tests: null,
    spoken: sp("覆診"),
    source: src("FU SOPD 2/52"),
    ...parts,
  };
}

function medicine(parts: Partial<Medicine> = {}): Medicine {
  return {
    name: "Amlodipine",
    strength: "5mg",
    amount: "1 tab",
    frequency: "daily",
    duration: null,
    spoken: sp("Amlodipine"),
    source: src("1. Amlodipine 5mg 1 tab daily"),
    ...parts,
  };
}

/* ------------------------------------------------------------------ draftPlan: hk_en */

describe("draftPlan / hk_en fixture", () => {
  const plan = draftPlan(stored(fixture("hk_en"), READ_AT));

  it("emits one appointment then one medicine time per medicine", () => {
    expect(plan.items.map((item) => item.kind)).toEqual([
      "appointment",
      "medicineTime",
      "medicineTime",
      "medicineTime",
    ]);
  });

  it("joins the clinic and the tests verbatim", () => {
    expect(plan.items[0].label).toBe("SOPD · fasting bloods");
  });

  it("keeps the printed follow-up time verbatim", () => {
    expect(plan.items[0].when).toBe("2/52");
  });

  it("parses 2/52 as fourteen days after the read", () => {
    expect(plan.followUpDate).toBe("2026-09-16");
  });

  it("keeps every medicine frequency verbatim", () => {
    expect(plan.items.slice(1).map((item) => [item.label, item.when])).toEqual([
      ["Amlodipine 5mg", "daily"],
      ["Metformin 500mg", "BD with meals"],
      ["Atorvastatin 20mg", "nocte"],
    ]);
  });

  it("carries the appointment's own source line", () => {
    expect(plan.items[0].source.quote).toBe("FU SOPD 2/52 with fasting bloods");
  });

  it("gives every item a source with a non-empty quote (constitution IV)", () => {
    for (const item of plan.items) {
      expect(item.source.quote.length).toBeGreaterThan(0);
      expect(item.source.section.length).toBeGreaterThan(0);
    }
  });

  it("copies the source rather than aliasing the reading's", () => {
    const reading = stored(fixture("hk_en"), READ_AT);
    const items = draftPlan(reading).items;
    expect(items[0].source).toEqual(reading.followUp[0].source);
    expect(items[0].source).not.toBe(reading.followUp[0].source);
  });

  it("is assignable to the stored FollowUpPlan shape", () => {
    const items: StoredPlanItem[] = plan.items;
    const saved: StoredFollowUpPlan = { items, confirmedAt: null, followUpDate: plan.followUpDate };
    expect(saved.items).toHaveLength(4);
    expect(saved.confirmedAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ draftPlan: cn_zh */

describe("draftPlan / cn_zh fixture", () => {
  const plan = draftPlan(stored(fixture("cn_zh"), READ_AT));

  it("joins the mainland clinic and tests verbatim", () => {
    expect(plan.items[0].label).toBe("心内科门诊 · 复查空腹血糖");
    expect(plan.items[0].when).toBe("2周后");
  });

  it("parses 2周后 as fourteen days after the read", () => {
    expect(plan.followUpDate).toBe("2026-09-16");
  });

  it("keeps the Chinese medicine names, strengths and frequencies verbatim", () => {
    expect(plan.items.slice(1).map((item) => [item.label, item.when])).toEqual([
      ["苯磺酸氨氯地平片 5mg", "每日一次"],
      ["盐酸二甲双胍片 0.5g", "每日两次 随餐"],
      ["阿托伐他汀钙片 20mg", "每晚一次"],
    ]);
  });

  it("gives every item a source with a non-empty quote", () => {
    for (const item of plan.items) expect(item.source.quote.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ draftPlan: edges */

describe("draftPlan / what is included", () => {
  it("skips a medicine whose frequency is not printed", () => {
    const plan = draftPlan(
      sheet({ medicines: [medicine(), medicine({ name: "Aspirin", frequency: null })] }),
    );
    expect(plan.items.map((item) => item.label)).toEqual(["Amlodipine 5mg"]);
  });

  it("skips a medicine whose frequency is blank", () => {
    const plan = draftPlan(sheet({ medicines: [medicine({ frequency: "  " })] }));
    expect(plan.items).toEqual([]);
  });

  it("labels a medicine with no printed strength by name alone", () => {
    const plan = draftPlan(sheet({ medicines: [medicine({ name: "Panadol", strength: null })] }));
    expect(plan.items[0].label).toBe("Panadol");
  });

  it("has no appointment and no date when nothing was printed about follow-up", () => {
    const plan = draftPlan(sheet({ medicines: [medicine()] }));
    expect(plan.items.every((item) => item.kind === "medicineTime")).toBe(true);
    expect(plan.followUpDate).toBeNull();
  });

  it("returns an empty plan for a reading with no follow-up and no medicines", () => {
    expect(draftPlan(sheet())).toEqual({ items: [], followUpDate: null });
  });

  it("keeps an appointment that printed a clinic but no time, with an empty when", () => {
    const plan = draftPlan(stored(sheet({ followUp: [followUp({ when: null })] }), READ_AT));
    expect(plan.items[0]).toMatchObject({ kind: "appointment", label: "SOPD", when: "" });
    expect(plan.followUpDate).toBeNull();
  });

  it("keeps an appointment that printed a time but no clinic, with an empty label", () => {
    const plan = draftPlan(
      stored(sheet({ followUp: [followUp({ clinic: null, tests: null })] }), READ_AT),
    );
    expect(plan.items[0]).toMatchObject({ kind: "appointment", label: "", when: "2/52" });
    expect(plan.followUpDate).toBe("2026-09-16");
  });

  it("skips a follow-up entry that printed neither a time nor a clinic", () => {
    const plan = draftPlan(
      sheet({ followUp: [followUp({ clinic: null, when: null, tests: "fasting bloods" })] }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.followUpDate).toBeNull();
  });

  it("puts every appointment before every medicine time", () => {
    const plan = draftPlan(
      stored(
        sheet({
          followUp: [followUp(), followUp({ clinic: "Cardiac clinic", when: "6/52" })],
          medicines: [medicine()],
        }),
        READ_AT,
      ),
    );
    expect(plan.items.map((item) => item.kind)).toEqual([
      "appointment",
      "appointment",
      "medicineTime",
    ]);
  });

  it("takes the date from the first appointment only", () => {
    const plan = draftPlan(
      stored(
        sheet({ followUp: [followUp({ when: "6/52" }), followUp({ when: "2/52" })] }),
        READ_AT,
      ),
    );
    expect(plan.followUpDate).toBe("2026-10-14");
  });

  it("has no date when the first appointment's time is ambiguous", () => {
    const plan = draftPlan(stored(sheet({ followUp: [followUp({ when: "in about 2 weeks" })] }), READ_AT));
    expect(plan.items).toHaveLength(1);
    expect(plan.followUpDate).toBeNull();
  });

  it("has no date for a reading with no readAt (a raw SheetReading)", () => {
    const plan = draftPlan(sheet({ followUp: [followUp()] }));
    expect(plan.items[0].when).toBe("2/52");
    expect(plan.followUpDate).toBeNull();
  });
});

/* ------------------------------------------------------------------ parseFollowUpDate */

describe("parseFollowUpDate / unambiguous forms, read on 2026-09-02", () => {
  const table: ReadonlyArray<readonly [string, string]> = [
    // Hong Kong clinical shorthand.
    ["2/52", "2026-09-16"],
    ["1/52", "2026-09-09"],
    ["6/52", "2026-10-14"],
    ["52/52", "2027-09-01"],
    ["2/7", "2026-09-04"],
    ["14/7", "2026-09-16"],
    ["3/12", "2026-12-02"],
    ["FU SOPD 2/52 with fasting bloods", "2026-09-16"],
    // English words.
    ["2 weeks", "2026-09-16"],
    ["2 wks", "2026-09-16"],
    ["1 week", "2026-09-09"],
    ["IN 2 WEEKS", "2026-09-16"],
    ["10 days", "2026-09-12"],
    ["1 day", "2026-09-03"],
    ["3 months", "2026-12-02"],
    // Chinese relative forms.
    ["2周后", "2026-09-16"],
    ["2週後", "2026-09-16"],
    ["两周后", "2026-09-16"],
    ["兩星期後", "2026-09-16"],
    ["2个星期后", "2026-09-16"],
    ["两周之后", "2026-09-16"],
    ["十二周后", "2026-11-25"],
    ["3天后", "2026-09-05"],
    ["7日後", "2026-09-09"],
    ["3个月后", "2026-12-02"],
    ["3個月後", "2026-12-02"],
    ["一个月后", "2026-10-02"],
    ["半个月", "2026-09-17"],
    ["半個月後", "2026-09-17"],
    ["6. 2周后心内科门诊复诊，复查空腹血糖", "2026-09-16"],
    // Explicit dates.
    ["2026-09-15", "2026-09-15"],
    ["2026/09/15", "2026-09-15"],
    ["15/09/2026", "2026-09-15"],
    ["15-09-2026", "2026-09-15"],
    ["31/12/2026", "2026-12-31"],
    ["2026年9月15日", "2026-09-15"],
    ["覆診日期：2026年9月15日", "2026-09-15"],
    ["9月15日", "2026-09-15"],
    // No year printed: this year when it is still ahead, next year when it has passed.
    ["9月2日", "2026-09-02"],
    ["9月1日", "2027-09-01"],
    ["1月5日", "2027-01-05"],
  ];

  for (const [input, expected] of table) {
    it(`${input} → ${expected}`, () => {
      expect(parseFollowUpDate(input, READ_AT)).toBe(expected);
    });
  }

  it("accepts a date-only readAt", () => {
    expect(parseFollowUpDate("2/52", "2026-09-02")).toBe("2026-09-16");
  });

  it("folds full-width digits and slashes", () => {
    expect(parseFollowUpDate("２／５２", READ_AT)).toBe("2026-09-16");
  });
});

describe("parseFollowUpDate / ambiguous and unrecognised forms return null", () => {
  const table: ReadonlyArray<string | null | undefined> = [
    // Hedged.
    "about 2 weeks",
    "in about 2 weeks",
    "approx 2 weeks",
    "around 2 weeks",
    "2周左右",
    "大约2周后",
    "大概两周後",
    "2/52?",
    // Two readings in one string.
    "2/52 or 4/52",
    "2 weeks or 4 weeks",
    "2/52 4/52",
    "2026-09-15 2026-10-01",
    // Nothing recognised.
    "soon",
    "next visit",
    "as directed",
    "TBC",
    "覆診日期待定",
    "",
    "   ",
    null,
    undefined,
    // Day-first and month-first cannot be told apart when both parts are ≤ 12.
    "01/02/2026",
    "12/12/2026",
    "01/15/2026",
    // Impossible dates.
    "2026-02-30",
    "2026-13-01",
    "31/02/2026",
    "2月29日",
    // Out of the ranges a discharge sheet can mean.
    "0/52",
    "60/52",
    "400/7",
    "36 months",
  ];

  for (const input of table) {
    it(`${JSON.stringify(input)} → null`, () => {
      expect(parseFollowUpDate(input, READ_AT)).toBeNull();
    });
  }

  it("returns null without a readAt to count from", () => {
    expect(parseFollowUpDate("2/52", "")).toBeNull();
  });

  it("returns null for an unparseable readAt", () => {
    expect(parseFollowUpDate("2/52", "not a timestamp")).toBeNull();
  });

  it("treats 約 as hedged even next to a printed date (documented trade-off)", () => {
    expect(parseFollowUpDate("9月15日預約", READ_AT)).toBeNull();
  });
});

describe("parseFollowUpDate / calendar arithmetic", () => {
  it("crosses the year end in weeks", () => {
    expect(parseFollowUpDate("2/52", "2026-12-20T00:00:00.000Z")).toBe("2027-01-03");
  });

  it("crosses the year end in months", () => {
    expect(parseFollowUpDate("3/12", "2026-11-15T00:00:00.000Z")).toBe("2027-02-15");
  });

  it("clamps to the end of a short month", () => {
    expect(parseFollowUpDate("2/12", "2026-12-31T00:00:00.000Z")).toBe("2027-02-28");
  });

  it("clamps to 29 February in a leap year", () => {
    expect(parseFollowUpDate("1/12", "2024-01-31T00:00:00.000Z")).toBe("2024-02-29");
  });

  it("counts days across a leap day", () => {
    expect(parseFollowUpDate("2/52", "2024-02-20T00:00:00.000Z")).toBe("2024-03-05");
  });

  it("does not depend on the time of day in readAt within the same local day", () => {
    // 00:30Z is 08:30 in Hong Kong; 15:59Z is 23:59 the same evening. Both anchor on 2 Sep.
    // (23:59Z would already be 3 Sep in Hong Kong, which is the point of local anchoring.)
    expect(parseFollowUpDate("2/52", "2026-09-02T15:59:59.999Z")).toBe(
      parseFollowUpDate("2/52", "2026-09-02T00:30:00.000Z"),
    );
    expect(parseFollowUpDate("2/52", "2026-09-02T00:30:00.000Z")).toBe("2026-09-16");
  });
});

/* ------------------------------------------------------------------ isExpired */

describe("isExpired", () => {
  const today = new Date(2026, 8, 2); // 2 September 2026, local time

  it("is false on the day of the visit", () => {
    expect(isExpired("2026-09-02", today)).toBe(false);
  });

  it("is true the day after the visit", () => {
    expect(isExpired("2026-09-01", today)).toBe(true);
  });

  it("is false before the visit", () => {
    expect(isExpired("2026-09-03", today)).toBe(false);
  });

  it("is true across a year boundary", () => {
    expect(isExpired("2026-12-31", new Date(2027, 0, 1))).toBe(true);
  });

  it("is false on the year boundary itself", () => {
    expect(isExpired("2027-01-01", new Date(2027, 0, 1))).toBe(false);
  });

  it("is false when there is no date", () => {
    expect(isExpired(null, today)).toBe(false);
    expect(isExpired(undefined, today)).toBe(false);
    expect(isExpired("", today)).toBe(false);
  });

  it("is false for a malformed date", () => {
    expect(isExpired("not-a-date", today)).toBe(false);
  });

  it("is false for an invalid today", () => {
    expect(isExpired("2020-01-01", new Date(Number.NaN))).toBe(false);
  });

  it("uses the local calendar day, not UTC", () => {
    const localMidnight = new Date(2026, 8, 2, 0, 30);
    expect(isExpired("2026-09-02", localMidnight)).toBe(false);
    expect(isExpired("2026-09-01", localMidnight)).toBe(true);
  });
});

/* ------------------------------------------------------------------ expiryNotice */

describe("expiryNotice", () => {
  const notice = expiryNotice();

  it("passes the banned-term filter in Cantonese", () => {
    expect(checkText(notice.yue)).toEqual({ ok: true, matches: [] });
  });

  it("passes the banned-term filter in Mandarin", () => {
    expect(checkText(notice.cmn)).toEqual({ ok: true, matches: [] });
  });

  it("passes the banned-term filter in English", () => {
    expect(checkText(notice.en)).toEqual({ ok: true, matches: [] });
  });

  it("says the instructions run up to the visit and to ask there (FR-021)", () => {
    expect(notice.yue).toContain("覆診");
    expect(notice.cmn).toContain("复诊");
    expect(notice.en).toContain("follow-up");
  });

  it("is fixed, and never a number about the person", () => {
    expect(expiryNotice()).toEqual(notice);
    expect(notice.yue).not.toMatch(/\d/);
    expect(notice.cmn).not.toMatch(/\d/);
    expect(notice.en).not.toMatch(/\d/);
  });

  it("hands back a fresh object each call", () => {
    expect(expiryNotice()).not.toBe(notice);
  });
});

// Reviewer addition: the anchor is the LOCAL calendar date of `readAt` (the phone's zone, Hong Kong
// for the product), not the UTC date. 17:30Z on 2 Sep is already 01:30 on 3 Sep in Hong Kong, so
// "2/52" counts from 3 Sep. vitest runs with TZ=Asia/Hong_Kong (vitest.config.mts).
describe("readAt anchoring uses the local calendar date", () => {
  it("anchors a post-midnight Hong Kong read on the local day, not the UTC day", () => {
    expect(process.env.TZ).toBe("Asia/Hong_Kong");
    expect(parseFollowUpDate("2/52", "2026-09-02T17:30:00.000Z")).toBe("2026-09-17");
  });

  it("still anchors a midday read on the same day in both zones", () => {
    expect(parseFollowUpDate("2/52", "2026-09-02T04:00:00.000Z")).toBe("2026-09-16");
  });

  it("accepts a plain YYYY-MM-DD anchor unchanged", () => {
    expect(parseFollowUpDate("1/52", "2026-09-02")).toBe("2026-09-09");
  });
});
