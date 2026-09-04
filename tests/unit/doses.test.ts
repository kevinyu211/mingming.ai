/**
 * The dose rules (v2 build brief §5). Pure functions, so these tests need no shims and no clock:
 * `today` is a parameter everywhere, and the suite runs under TZ=Asia/Hong_Kong (vitest.config.mts)
 * because "today" for this family is the day their phone shows, not the day UTC shows.
 *
 * The point of most of what follows is what `timesPerDay` REFUSES to read. Putting a number on
 * the screen is the one thing in this file that can hurt someone, so a clause it does not
 * recognise exactly has to come back as "could not tell" and be shown verbatim instead.
 */
import { describe, expect, it } from "vitest";
import type { Medicine, StoredReading } from "@/lib/domain/schemas";
import { doseTargets, localDay, remaining, timesPerDay } from "@/lib/rules/doses";
import type { DoseState } from "@/lib/sheets/types";

const SOURCE = { section: "Medications", lineIndex: 0, quote: "" };
const SPOKEN = { yue: "", cmn: "", en: "" };

function medicine(overrides: Partial<Medicine> = {}): Medicine {
  return {
    name: "Metoprolol",
    strength: "25mg",
    amount: "1 粒",
    frequency: "每日兩次，隨餐",
    duration: null,
    status: "current",
    spoken: SPOKEN,
    source: SOURCE,
    ...overrides,
  };
}

function reading(medicines: Medicine[]): StoredReading {
  return {
    sheetType: "hk_en",
    warningSigns: [],
    medicines,
    followUp: [],
    dietLine: null,
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
    readAt: "2026-09-01T02:00:00.000Z",
  };
}

// --- timesPerDay: what it reads ------------------------------------------------------

describe("timesPerDay reads the forms a discharge sheet actually prints", () => {
  const counted: [string, number][] = [
    // 每日 / 每天 / 一日 + N 次, in Chinese numerals and in digits.
    ["每日一次", 1],
    ["每日兩次，隨餐", 2],
    ["每日两次", 2],
    ["每日三次", 3],
    ["每天四次", 4],
    ["每天 2 次", 2],
    ["每日2次", 2],
    ["一日三次，飯後服", 3],
    ["一日 4 次", 4],
    // Full-width digits fold through NFKC, because a sheet typeset in Chinese prints them.
    ["每日２次", 2],
    // The clause carries on after the count; only the count is read out of it.
    ["每日一次，早餐后服", 1],
    ["每日三次，每次一粒，飯後服用", 3],
    // English.
    ["3 times a day", 3],
    ["2 times daily", 2],
    ["1 x daily", 1],
    ["Take 1 tablet 2 times per day", 2],
    ["once daily", 1],
    ["twice daily", 2],
    ["twice a day", 2],
    ["three times daily", 3],
    ["four times a day", 4],
    // Latin abbreviations, in both the Hong Kong and the American spelling.
    ["OD", 1],
    ["BD", 2],
    ["TDS", 3],
    ["QID", 4],
    ["Take 1 tab bd with food", 2],
    ["b.d.", 2],
    ["1 tab TID", 3],
    ["QDS", 4],
    // A clause that says the same thing twice still says one thing.
    ["每日兩次 BD", 2],
  ];

  for (const [clause, total] of counted) {
    it(`reads ${JSON.stringify(clause)} as ${total} times a day`, () => {
      expect(timesPerDay(clause)).toEqual({ total, asNeeded: false });
    });
  }
});

describe("timesPerDay marks an as-needed clause rather than counting it", () => {
  const asNeeded = [
    "痛先食",
    "痛嘅時候食，一日最多四次",
    "痛時服",
    "需要時服一粒",
    "需要时服",
    "必要時食",
    "有需要先食",
    "PRN",
    "1 tab prn",
    "p.r.n.",
    "Take one tablet as required",
    "as needed for pain",
    "when necessary",
    "if needed",
  ];

  for (const clause of asNeeded) {
    it(`marks ${JSON.stringify(clause)} as-needed and counts nothing`, () => {
      expect(timesPerDay(clause)).toEqual({ total: 0, asNeeded: true });
    });
  }

  /**
   * 「痛嘅時候食，一日最多四次」 prints a ceiling, not four doses to tick off. If the count won
   * over the marker, the card would offer a 食咗 button on a medicine the page says to take only
   * when it hurts.
   */
  it("lets the as-needed marker win over a ceiling in the same clause", () => {
    expect(timesPerDay("痛嘅時候食，一日最多四次")).toEqual({ total: 0, asNeeded: true });
    expect(timesPerDay("1 tab up to 4 times a day PRN")).toEqual({ total: 0, asNeeded: true });
  });

  /**
   * Once a day, stated without printing a numeral.
   *
   * These were refused at first, on the reasoning that a clause naming a part of the day must not
   * become a counter. But the counter is a COUNT, and 「每朝一次」 states one dose a day as plainly
   * as 「每日一次」 does — what the app must never do is put a morning on the screen, and nothing
   * here can: `remaining()` returns an integer and the card prints the clause verbatim beside it.
   *
   * Refusing them was not caution, it was a hole. Every medicine on the English fixture prints one
   * of these forms — "daily", "BD with meals", "nocte" — so two of its three cards had no counter,
   * and the check-in that is meant to ask 「今日食咗藥未？」 had nothing to ask about.
   */
  const onceADay: [string, string][] = [
    ["daily", "the commonest English frequency there is"],
    ["1 tablet daily", "one tablet, once a day — the tablet count is not the dose count"],
    ["2 tabs daily", "two tablets in ONE daily dose, so the counter still says once"],
    ["每日，飯後服", "a bare 每日 with meal timing and no numeral"],
    ["每朝一次", "once every morning is once a day; the morning never reaches the screen"],
    ["每晚服一粒", "and so is once every night"],
    ["nocte", "the Latin the ward actually prints"],
    ["mane", "and its morning twin"],
    ["at night", "written out"],
    ["every morning", "written out the other way"],
  ];

  for (const [clause, why] of onceADay) {
    it(`reads ${JSON.stringify(clause)} as once a day — ${why}`, () => {
      expect(timesPerDay(clause)).toEqual({ total: 1, asNeeded: false });
    });
  }

  /**
   * The veto that makes the above safe, and the asymmetry it fixes.
   *
   * 「一日最多四次」 was already refused because its count is not adjacent to 次. "up to 4 times a
   * day" was NOT: it matched the English pattern and came back as a confident four. Same sheet,
   * same meaning, counted in one language and refused in the other — and counting it would have
   * told someone to take three more doses than the page asked for.
   */
  it("refuses a stated ceiling in either language, not just in Chinese", () => {
    expect(timesPerDay("一日最多四次")).toEqual({ total: 0, asNeeded: false });
    expect(timesPerDay("up to 4 times a day")).toEqual({ total: 0, asNeeded: false });
    expect(timesPerDay("max 4 times a day")).toEqual({ total: 0, asNeeded: false });
    expect(timesPerDay("no more than 3 times a day")).toEqual({ total: 0, asNeeded: false });
  });

  /** A duration alongside a frequency is still that frequency. */
  it("keeps the count when the clause also prints how long to take it", () => {
    expect(timesPerDay("每日兩次，共兩星期")).toEqual({ total: 2, asNeeded: false });
    expect(timesPerDay("twice daily for 7 days")).toEqual({ total: 2, asNeeded: false });
  });
});

// --- timesPerDay: what it refuses to read --------------------------------------------

describe("timesPerDay refuses everything it does not recognise exactly", () => {
  const refused: [string, string][] = [
    ["2026-09-15", "a date is not a frequency"],
    ["9/15", "neither is a printed day and month"],
    ["7 days", "a duration says how long, not how often"],
    ["食七日", "the Chinese duration is no different"],
    ["for 14 days", "and neither is this one"],
    ["5mg", "a bare strength says nothing about frequency"],
    ["0.25mg", "including one with a decimal point"],
    ["每星期一次", "once a WEEK is not once a day"],
    ["twice weekly", "and neither is twice a week"],
    ["每四小時一次", "every four hours is a clock, and a counter never shows one"],
    ["隔日一次", "every other day does not fit a per-day counter"],
    ["每日一至兩次", "a range is ambiguous, so nothing is counted"],
    ["一日最多四次", "a maximum is a ceiling, not a schedule"],
    ["隨餐服用", "meal timing with no frequency at all"],
    ["每日十次", "the count is outside anything a sheet plausibly prints, and a clause that\n      carried a number must never fall through to the once-a-day reading"],
    ["每日一次 TDS", "two recognised forms that contradict each other"],
    ["", "nothing printed"],
    ["   ", "whitespace only"],
  ];

  for (const [clause, why] of refused) {
    it(`refuses ${JSON.stringify(clause)} — ${why}`, () => {
      expect(timesPerDay(clause)).toEqual({ total: 0, asNeeded: false });
    });
  }

  it("refuses null and undefined the same way", () => {
    expect(timesPerDay(null)).toEqual({ total: 0, asNeeded: false });
    expect(timesPerDay(undefined)).toEqual({ total: 0, asNeeded: false });
  });
});

// --- doseTargets ---------------------------------------------------------------------

describe("doseTargets", () => {
  it("keeps the name, the strength, the amount and the clause verbatim", () => {
    const [target] = doseTargets(reading([medicine()]));
    expect(target.key).toBe("m0");
    expect(target.name).toBe("Metoprolol 25mg");
    expect(target.generic).toBe("1 粒");
    expect(target.printed).toBe("每日兩次，隨餐");
    expect(target.total).toBe(2);
    expect(target.asNeeded).toBe(false);
    expect(target.stopped).toBe(false);
  });

  it("invents nothing when the page printed only a name", () => {
    const [target] = doseTargets(
      reading([medicine({ strength: null, amount: null, frequency: null })]),
    );
    expect(target.name).toBe("Metoprolol");
    expect(target.generic).toBe("");
    expect(target.printed).toBe("");
    expect(target.total).toBe(0);
    expect(target.asNeeded).toBe(false);
  });

  it("keys targets by their index in the reading, in the order the page lists them", () => {
    const targets = doseTargets(
      reading([medicine({ name: "A" }), medicine({ name: "B" }), medicine({ name: "C" })]),
    );
    expect(targets.map((t) => t.key)).toEqual(["m0", "m1", "m2"]);
    expect(targets.map((t) => t.name)).toEqual(["A 25mg", "B 25mg", "C 25mg"]);
  });

  /**
   * The worst single miss in tests/eval/stress.md: a drug under 「停用药物（出院后不再服用）」 that
   * still got scheduled. It stays in the list — the family needs to see the page names it — with
   * nothing about it that could become a counter or a 食咗 button.
   */
  it("never counts, schedules or marks as-needed a medicine the page has stopped", () => {
    const targets = doseTargets(
      reading([
        medicine({ name: "Digoxin", strength: "0.25mg", frequency: "每日一次", status: "stopped" }),
        medicine({ name: "Panadol", frequency: "痛先食", status: "stopped" }),
        medicine({ name: "Lisinopril", frequency: "每日一次", status: "changed" }),
      ]),
    );
    for (const target of targets) {
      expect(target.stopped, `${target.name} should be marked stopped`).toBe(true);
      expect(target.total, `${target.name} must not be counted`).toBe(0);
      expect(target.asNeeded, `${target.name} must not be offered as as-needed`).toBe(false);
    }
    // The clause is still carried, so the card can show what the page said about it.
    expect(targets[0].printed).toBe("每日一次");
    expect(targets[0].name).toBe("Digoxin 0.25mg");
  });

  it("returns an empty list for a reading with no medicines", () => {
    expect(doseTargets(reading([]))).toEqual([]);
  });
});

// --- localDay ------------------------------------------------------------------------

describe("localDay uses the device's own calendar, not UTC", () => {
  it("reads the date the phone shows in Hong Kong", () => {
    // 23:59 on the 3rd in Hong Kong, which is still the 3rd — UTC has already rolled to the 3rd
    // at 16:00, and a UTC date would have flipped the counter mid-evening.
    expect(localDay(new Date("2026-09-03T15:59:00.000Z"))).toBe("2026-09-03");
    // 00:00 on the 4th in Hong Kong.
    expect(localDay(new Date("2026-09-03T16:00:00.000Z"))).toBe("2026-09-04");
  });

  it("pads the month and the day", () => {
    expect(localDay(new Date("2026-01-05T04:00:00.000Z"))).toBe("2026-01-05");
  });

  it("returns an empty day for an invalid date, so nothing matches and the full count shows", () => {
    expect(localDay(new Date("nonsense"))).toBe("");
  });
});

// --- remaining -----------------------------------------------------------------------

describe("remaining", () => {
  const today = new Date("2026-09-03T04:00:00.000Z"); // midday in Hong Kong
  const [twiceDaily] = doseTargets(reading([medicine()]));

  function state(taken: number, day: string): DoseState {
    return { key: "m0", taken, day };
  }

  it("is the full count when nothing has been taken", () => {
    expect(remaining(twiceDaily, undefined, today)).toBe(2);
  });

  it("counts down and stops at zero", () => {
    expect(remaining(twiceDaily, state(1, "2026-09-03"), today)).toBe(1);
    expect(remaining(twiceDaily, state(2, "2026-09-03"), today)).toBe(0);
    expect(remaining(twiceDaily, state(9, "2026-09-03"), today)).toBe(0);
  });

  /**
   * The daily reset, read side. A count belonging to another calendar day is ignored rather than
   * carried over, which is why `DoseState` stores the day it belongs to — no overnight timer has
   * to fire for the counter to be right in the morning.
   */
  it("ignores a count recorded on another local day", () => {
    const yesterday = state(2, "2026-09-02");
    expect(remaining(twiceDaily, yesterday, today)).toBe(2);
  });

  it("is zero for a stopped, an as-needed and an unreadable target", () => {
    const [stopped] = doseTargets(reading([medicine({ status: "stopped" })]));
    const [asNeeded] = doseTargets(reading([medicine({ frequency: "痛先食" })]));
    const [unreadable] = doseTargets(reading([medicine({ frequency: "每四小時一次" })]));
    for (const target of [stopped, asNeeded, unreadable]) {
      expect(remaining(target, undefined, today)).toBe(0);
      expect(remaining(target, state(0, "2026-09-03"), today)).toBe(0);
    }
  });
});
