/**
 * The three things 記錄 and 跟進 put on screen that are neither a fixed string nor a verbatim
 * quote — a sheet's date, a message's time, and how many days until a visit — plus the two dose
 * questions 記錄 has to answer before it can draw the check-in block.
 *
 * Pure and clock-free: `today` is passed in everywhere, exactly as `lib/rules/doses.ts` does it, so
 * the calendar can be rolled forward without touching the system time. TZ is pinned to
 * Asia/Hong_Kong in vitest.config.mts, which is what makes the local-day assertions mean anything.
 */
import { describe, expect, it } from "vitest";
import {
  daysUntil,
  fill,
  formatMonthDay,
  formatTime,
  formatYmd,
} from "@/components/home/format";
import { countableTargets, remainingToday } from "@/components/home/CheckinNotice";
import {
  HOME_PREVIEW_GLYPHS,
  homePreview,
  homeUnread,
} from "@/components/home/conversation";
import type { Medicine, Speakable, StoredReading } from "@/lib/domain/schemas";
import type { Sheet, ThreadMessage } from "@/lib/sheets";

const SPOKEN: Speakable = { yue: "yue", cmn: "cmn", en: "en" };
const SOURCE = { section: "Medications", lineIndex: 0, quote: "quoted line" };

/** 10am in Hong Kong on 1 September 2026. */
const CAPTURED = "2026-09-01T02:00:00.000Z";
/** Midday in Hong Kong on the 3rd and on the 4th. */
const DAY_3 = new Date("2026-09-03T04:00:00.000Z");
const DAY_4 = new Date("2026-09-04T04:00:00.000Z");

describe("dates on screen", () => {
  it("writes the day the way each interface writes it", () => {
    expect(formatMonthDay(CAPTURED, "hant")).toBe("9月1日");
    expect(formatMonthDay(CAPTURED, "hans")).toBe("9月1日");
    // en-GB rather than en-US: Hong Kong writes "1 September", not "September 1".
    expect(formatMonthDay(CAPTURED, "en")).toBe("1 September");
  });

  it("reads a parsed follow-up date as a LOCAL calendar day, not as UTC midnight", () => {
    // "2026-09-24" parsed as UTC would render as the 24th in Hong Kong but the 23rd west of
    // Greenwich. It is a calendar date the page printed, so it is built from local parts.
    expect(formatYmd("2026-09-24", "hant")).toBe("9月24日");
    expect(formatYmd("2026-09-24", "en")).toBe("24 September");
  });

  it("returns nothing at all rather than a fake date, so the caller omits the line", () => {
    for (const bad of [null, undefined, "", "   ", "not a date"]) {
      expect(formatMonthDay(bad, "hant")).toBe("");
      expect(formatTime(bad, "hant")).toBe("");
    }
    for (const bad of [null, undefined, "", "2026-9-4", "2026-09-24T00:00:00Z"]) {
      expect(formatYmd(bad, "hant")).toBe("");
    }
  });

  it("stamps a message with the time it was said", () => {
    // This is a chat timestamp and nothing else. It is never attached to a medicine, where a clock
    // time would be the app writing a schedule the page did not print (brief §2 rule 7).
    expect(formatTime(CAPTURED, "hans")).toBe("10:00");
    expect(formatTime(CAPTURED, "en")).toBe("10:00");
    expect(formatTime(CAPTURED, "hant")).toContain("10:00");
  });
});

describe("how many days until the visit", () => {
  it("counts whole calendar days forward", () => {
    expect(daysUntil("2026-09-24", DAY_3)).toBe(21);
    expect(daysUntil("2026-09-24", DAY_4)).toBe(20);
  });

  it("is zero on the day itself and negative once it is past", () => {
    expect(daysUntil("2026-09-03", DAY_3)).toBe(0);
    expect(daysUntil("2026-09-01", DAY_3)).toBe(-2);
  });

  it("counts nothing when there is no parsed date", () => {
    // `plan.followUpDate` is null for everything hedged or ambiguous, and a countdown built on one
    // of those would be the app deciding a medical date on the family's behalf.
    for (const bad of [null, undefined, "", "2/52", "about 2 weeks"]) {
      expect(daysUntil(bad, DAY_3)).toBeNull();
    }
    expect(daysUntil("2026-09-24", new Date("nonsense"))).toBeNull();
  });
});

describe("filling a fixed template", () => {
  it("replaces every occurrence of a slot", () => {
    expect(fill("今日仲有 {n} 次", { n: 2 })).toBe("今日仲有 2 次");
    expect(fill("{a}-{a}", { a: "x" })).toBe("x-x");
  });

  it("leaves a template alone when it has no slot to fill", () => {
    expect(fill("今日食晒", { n: 3 })).toBe("今日食晒");
  });
});

/* ------------------------------------------------------------------ the check-in's arithmetic */

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
    readAt: CAPTURED,
  };
}

function sheet(
  medicines: Medicine[],
  doses: Sheet["doses"] = {},
  extras: Partial<Pick<Sheet, "checkin" | "briefing" | "thread">> = {},
): Sheet {
  return {
    id: "sheet-1",
    capturedAt: CAPTURED,
    pageCount: 2,
    title: "出院紙",
    reading: reading(medicines),
    plan: { items: [], followUpDate: null },
    thread: extras.thread ?? [],
    doses,
    briefing: extras.briefing ?? { phase: "end", step: 3 },
    checkin: extras.checkin ?? "pending",
    archivedAt: null,
  };
}

function message(text: string, role: ThreadMessage["role"] = "agent"): ThreadMessage {
  return {
    id: "m1",
    role,
    text,
    at: CAPTURED,
    origin: role === "user" ? "user" : "rule",
  };
}

describe("which medicines a counter may exist for", () => {
  it("counts only what the page printed as a countable schedule", () => {
    const targets = countableTargets(
      sheet([
        medicine({ frequency: "每日兩次，隨餐" }),
        medicine({ name: "Amlodipine", frequency: "每四小時一次" }), // readable, not countable
        medicine({ name: "Paracetamol", frequency: "痛先食" }), // as-needed
        medicine({ name: "Warfarin", status: "stopped", frequency: "每日一次" }), // withdrawn
      ]),
    );
    expect(targets.map((t) => t.name)).toEqual(["Metoprolol 25mg"]);
  });

  it("finds nothing countable on a sheet that printed no schedule at all", () => {
    // §6 makes the check-in question conditional on there being something countable, so this is
    // the case where 記錄 omits the question rather than quoting a clause the page never printed.
    expect(countableTargets(sheet([medicine({ frequency: "每四小時一次" })]))).toHaveLength(0);
    expect(countableTargets(sheet([]))).toHaveLength(0);
  });
});

describe("今日嘅藥：仲有 N 次", () => {
  it("adds up what is still due across every countable medicine", () => {
    const s = sheet([
      medicine({ frequency: "每日兩次，隨餐" }),
      medicine({ name: "Aspirin", frequency: "每日一次" }),
    ]);
    expect(remainingToday(s, DAY_3)).toBe(3);
  });

  it("drops as one is taken and reaches zero when the day is done", () => {
    const meds = [medicine({ frequency: "每日兩次，隨餐" })];
    expect(remainingToday(sheet(meds, { m0: { key: "m0", taken: 1, day: "2026-09-03" } }), DAY_3)).toBe(1);
    expect(remainingToday(sheet(meds, { m0: { key: "m0", taken: 2, day: "2026-09-03" } }), DAY_3)).toBe(0);
  });

  it("starts again at the full count the next local day", () => {
    const s = sheet([medicine({ frequency: "每日兩次，隨餐" })], {
      m0: { key: "m0", taken: 2, day: "2026-09-03" },
    });
    expect(remainingToday(s, DAY_4)).toBe(2);
  });

  it("counts nothing for a stopped or as-needed medicine, whatever its line printed", () => {
    expect(
      remainingToday(sheet([medicine({ status: "stopped", frequency: "每日兩次" })]), DAY_3),
    ).toBe(0);
    expect(remainingToday(sheet([medicine({ frequency: "需要時食" })]), DAY_3)).toBe(0);
  });
});

const PREVIEW = {
  "checkin.question": "Have you had {name} today? The sheet says {printed}.",
  "home.chatNotStarted": "Not read yet",
} as const;

function previewT(key: keyof typeof PREVIEW): string {
  return PREVIEW[key];
}

describe("whether 明明 is waiting on 記錄", () => {
  it("is unread while a check-in is pending, even after the briefing has ended", () => {
    expect(homeUnread(sheet([medicine({ frequency: "每日兩次" })]))).toBe(true);
  });

  it("is unread while the briefing has not ended, including idle and partway", () => {
    expect(
      homeUnread(
        sheet([], {}, { checkin: "none", briefing: { phase: "idle", step: 0 } }),
      ),
    ).toBe(true);
    expect(
      homeUnread(
        sheet([], {}, { checkin: "none", briefing: { phase: "waiting", step: 1 } }),
      ),
    ).toBe(true);
  });

  it("is quiet once the briefing has ended and the check-in is not pending", () => {
    expect(
      homeUnread(sheet([], {}, { checkin: "done", briefing: { phase: "end", step: 3 } })),
    ).toBe(false);
    expect(
      homeUnread(sheet([], {}, { checkin: "none", briefing: { phase: "end", step: 3 } })),
    ).toBe(false);
    expect(
      homeUnread(sheet([], {}, { checkin: "open", briefing: { phase: "end", step: 3 } })),
    ).toBe(false);
  });
});

describe("the conversation preview on 記錄", () => {
  it("fills the fixed check-in question when a countable medicine is pending", () => {
    expect(homePreview(sheet([medicine({ frequency: "每日兩次，隨餐" })]), previewT)).toBe(
      "Have you had Metoprolol 25mg today? The sheet says 每日兩次，隨餐.",
    );
  });

  it("does not invent a check-in question when nothing is countable", () => {
    expect(
      homePreview(sheet([medicine({ frequency: "每四小時一次" })]), previewT),
    ).toBe("Not read yet");
  });

  it("falls back to the last thread line, sliced to forty glyphs", () => {
    const long = "跟住講藥。".repeat(20);
    expect(
      homePreview(
        sheet([], {}, { checkin: "none", briefing: { phase: "waiting", step: 1 }, thread: [message(long)] }),
        previewT,
      ),
    ).toBe(long.slice(0, HOME_PREVIEW_GLYPHS));
  });

  it("uses the last agent or user line when the check-in is not a countable pending", () => {
    expect(
      homePreview(
        sheet(
          [],
          {},
          {
            checkin: "none",
            briefing: { phase: "end", step: 3 },
            thread: [message("第一句"), message("我食咗", "user")],
          },
        ),
        previewT,
      ),
    ).toBe("我食咗");
  });

  it("says the chat has not started when the thread is empty", () => {
    expect(
      homePreview(sheet([], {}, { checkin: "none", briefing: { phase: "idle", step: 0 } }), previewT),
    ).toBe("Not read yet");
  });
});
