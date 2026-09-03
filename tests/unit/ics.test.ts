/**
 * T037 — the confirmed plan as a calendar file (`lib/plan/ics.ts`).
 *
 * The assertions that matter most are the negative ones: no VALARM, no invented clock time, no
 * event on a date the sheet did not print, and no relationship label anywhere. Everything else
 * is RFC 5545 hygiene — CRLF, 75-octet folding, TEXT escaping — which matters because a file
 * that a phone's calendar silently refuses is the same as no plan at all.
 */
import { describe, expect, it } from "vitest";
import { buildIcs, compactDate, escapeText, foldLine, hasCalendarEvents } from "@/lib/plan/ics";
import type { FollowUpPlan, PlanItem } from "@/lib/storage/local";

const NOW = new Date("2026-09-02T09:30:00.000Z");
const READ_DATE = "2026-09-02";

function source(quote: string, lineIndex: number | null = 0) {
  return { section: "Discharge Medication(s) & Follow-up Plan", lineIndex, quote };
}

const APPOINTMENT: PlanItem = {
  kind: "appointment",
  label: "SOPD · fasting bloods",
  when: "2/52",
  source: source("FU SOPD 2/52 with fasting bloods", 3),
};

const MEDICINES: PlanItem[] = [
  {
    kind: "medicineTime",
    label: "Amlodipine 5mg",
    when: "daily",
    source: source("1. Amlodipine 5mg 1 tab daily", 0),
  },
  {
    kind: "medicineTime",
    label: "Metformin 500mg",
    when: "BD with meals",
    source: source("2. Metformin 500mg 1 tab BD with meals", 1),
  },
  {
    kind: "medicineTime",
    label: "Atorvastatin 20mg",
    when: "nocte",
    source: source("3. Atorvastatin 20mg 1 tab nocte", 2),
  },
];

function plan(overrides: Partial<FollowUpPlan> = {}): FollowUpPlan {
  return {
    items: [APPOINTMENT, ...MEDICINES],
    confirmedAt: "2026-09-02T09:20:00.000Z",
    followUpDate: "2026-09-16",
    ...overrides,
  };
}

/** Reverses RFC 5545 folding so a property can be asserted as one string. */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

function lines(ics: string): string[] {
  return unfold(ics).split("\r\n");
}

function property(ics: string, name: string, occurrence = 0): string {
  const matches = lines(ics).filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
  return matches[occurrence] ?? "";
}

const OPTIONS = {
  titlePrefix: "出院紙",
  startDate: READ_DATE,
  appointmentTitle: "覆診",
  medicineTitle: "藥",
  now: NOW,
};

describe("buildIcs — the shape a calendar will accept", () => {
  it("wraps the events in one VCALENDAR with the required properties", () => {
    const ics = buildIcs(plan(), OPTIONS);
    const all = lines(ics);

    expect(all[0]).toBe("BEGIN:VCALENDAR");
    expect(all).toContain("VERSION:2.0");
    expect(all).toContain("CALSCALE:GREGORIAN");
    expect(all.at(-2)).toBe("END:VCALENDAR");
    expect(all.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);
    expect(all.filter((line) => line === "END:VEVENT")).toHaveLength(2);
  });

  it("ends every content line with CRLF, including the last", () => {
    const ics = buildIcs(plan(), OPTIONS);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // A bare LF anywhere would break strict parsers.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("gives both events a UID and a DTSTAMP", () => {
    const ics = buildIcs(plan(), OPTIONS);
    const uids = lines(ics).filter((line) => line.startsWith("UID:"));
    expect(uids).toHaveLength(2);
    expect(new Set(uids).size).toBe(2);
    expect(lines(ics).filter((line) => line.startsWith("DTSTAMP:"))).toEqual([
      "DTSTAMP:20260902T093000Z",
      "DTSTAMP:20260902T093000Z",
    ]);
  });

  it("is byte-identical for the same plan and the same clock", () => {
    expect(buildIcs(plan(), OPTIONS)).toBe(buildIcs(plan(), OPTIONS));
  });
});

describe("buildIcs — the follow-up entry", () => {
  it("is an all-day event on the parsed follow-up date, ending the next morning", () => {
    const ics = buildIcs(plan(), OPTIONS);
    expect(property(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20260916");
    expect(property(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20260917");
  });

  it("rolls over month and year ends", () => {
    const endOfMonth = buildIcs(plan({ followUpDate: "2026-09-30" }), OPTIONS);
    expect(property(endOfMonth, "DTEND")).toBe("DTEND;VALUE=DATE:20261001");

    const endOfYear = buildIcs(plan({ followUpDate: "2026-12-31" }), OPTIONS);
    expect(property(endOfYear, "DTEND")).toBe("DTEND;VALUE=DATE:20270101");
  });

  it("titles the entry from the interface, and carries the printed words and the quote", () => {
    const ics = buildIcs(plan(), OPTIONS);
    expect(property(ics, "SUMMARY")).toBe("SUMMARY:出院紙：覆診");
    const description = property(ics, "DESCRIPTION");
    expect(description).toContain("SOPD · fasting bloods — 2/52");
    expect(description).toContain("FU SOPD 2/52 with fasting bloods");
  });

  it("is omitted entirely when the sheet printed no unambiguous date", () => {
    const ics = buildIcs(plan({ followUpDate: null }), OPTIONS);
    expect(lines(ics).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(property(ics, "SUMMARY")).toBe("SUMMARY:出院紙：藥");
  });

  it("is omitted when the stored date is not a real calendar date", () => {
    for (const bad of ["2026-02-31", "2026-13-01", "16/09/2026", "soon", ""]) {
      const ics = buildIcs(plan({ followUpDate: bad }), { ...OPTIONS, startDate: undefined });
      expect(lines(ics).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(0);
    }
  });
});

describe("buildIcs — the medicine entry", () => {
  it("is one all-day note on the day the sheet was read, listing every frequency verbatim", () => {
    const ics = buildIcs(plan(), OPTIONS);
    expect(property(ics, "DTSTART", 1)).toBe("DTSTART;VALUE=DATE:20260902");
    expect(property(ics, "DTEND", 1)).toBe("DTEND;VALUE=DATE:20260903");
    expect(property(ics, "SUMMARY", 1)).toBe("SUMMARY:出院紙：藥");

    const description = property(ics, "DESCRIPTION", 1);
    expect(description).toContain("Amlodipine 5mg — daily");
    expect(description).toContain("Metformin 500mg — BD with meals");
    expect(description).toContain("Atorvastatin 20mg — nocte");
  });

  /**
   * The design decision this file exists to protect: a frequency is not a time. FR-020 forbids
   * altering doses, and inventing 08:00 for "daily" would be exactly that.
   */
  it("never invents a clock time and never sets an alarm", () => {
    const ics = buildIcs(plan(), OPTIONS);
    expect(ics).not.toContain("VALARM");
    expect(ics).not.toContain("TRIGGER");
    expect(ics).not.toContain("RRULE");
    // Every DTSTART/DTEND is a DATE, never a DATE-TIME.
    for (const line of lines(ics)) {
      if (line.startsWith("DTSTART") || line.startsWith("DTEND")) {
        expect(line).toContain(";VALUE=DATE:");
        expect(line).not.toMatch(/T\d{6}/);
      }
    }
  });

  it("is omitted when no read date is known, rather than guessing one", () => {
    const ics = buildIcs(plan(), { ...OPTIONS, startDate: undefined });
    expect(lines(ics).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(property(ics, "SUMMARY")).toBe("SUMMARY:出院紙：覆診");
  });

  it("is omitted when no medicine printed a frequency", () => {
    const ics = buildIcs(plan({ items: [APPOINTMENT] }), OPTIONS);
    expect(lines(ics).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });
});

describe("buildIcs — what it refuses to carry", () => {
  it("has no field for the relationship label, so no label can reach the file", () => {
    const ics = buildIcs(plan(), { ...OPTIONS, titlePrefix: "出院紙" });
    for (const label of ["阿媽", "阿爸", "老豆", "家婆"]) {
      expect(ics).not.toContain(label);
    }
  });

  it("produces a valid, empty calendar when the sheet gave it nothing", () => {
    const empty = buildIcs({ items: [], confirmedAt: null, followUpDate: null }, OPTIONS);
    expect(lines(empty)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//tengdakming//discharge-sheet-agent//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "END:VCALENDAR",
      "",
    ]);
  });
});

describe("hasCalendarEvents", () => {
  it("is true when there is a date, or a frequency and a read date", () => {
    expect(hasCalendarEvents(plan(), { startDate: READ_DATE })).toBe(true);
    expect(hasCalendarEvents(plan({ followUpDate: null }), { startDate: READ_DATE })).toBe(true);
    expect(hasCalendarEvents(plan({ followUpDate: null }), {})).toBe(false);
    expect(hasCalendarEvents({ items: [], confirmedAt: null, followUpDate: null }, {})).toBe(false);
  });
});

describe("RFC 5545 text handling", () => {
  it("escapes backslash, semicolon, comma and newline", () => {
    expect(escapeText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(escapeText("one\ntwo")).toBe("one\\ntwo");
    expect(escapeText("one\r\ntwo")).toBe("one\\ntwo");
  });

  it("escapes a comma printed on the sheet rather than splitting the value", () => {
    const withComma: PlanItem = {
      ...MEDICINES[0],
      when: "daily, with food",
      source: source("1. Amlodipine 5mg 1 tab daily, with food"),
    };
    const ics = buildIcs(plan({ items: [withComma], followUpDate: null }), OPTIONS);
    expect(property(ics, "DESCRIPTION")).toContain("daily\\, with food");
  });

  it("folds at 75 octets, counting bytes and never splitting a character", () => {
    const long = `SUMMARY:${"出院紙覆診提示".repeat(12)}`;
    const folded = foldLine(long);
    const encoder = new TextEncoder();

    expect(folded).toContain("\r\n ");
    for (const line of folded.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    // A split multi-byte character would have produced a replacement character.
    expect(folded).not.toContain("�");
  });

  it("folds the long CJK description a real plan produces, reversibly", () => {
    const note = "日曆入面淨係抄返張紙點寫，冇時間表，冇鬧鐘。AI 寫嘅，可能有錯。";
    const ics = buildIcs(plan(), { ...OPTIONS, note });
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(property(ics, "DESCRIPTION")).toContain(note);
  });

  it("leaves a short line alone", () => {
    expect(foldLine("VERSION:2.0")).toBe("VERSION:2.0");
  });
});

describe("compactDate", () => {
  it("accepts an ISO calendar date and rejects everything else", () => {
    expect(compactDate("2026-09-16")).toBe("20260916");
    expect(compactDate("2024-02-29")).toBe("20240229"); // a real leap day
    expect(compactDate("2026-02-29")).toBeNull(); // 2026 is not a leap year
    expect(compactDate("2026-02-30")).toBeNull();
    expect(compactDate("2026-13-01")).toBeNull();
    expect(compactDate("2026-9-16")).toBeNull();
    expect(compactDate("")).toBeNull();
    expect(compactDate(null)).toBeNull();
    expect(compactDate(undefined)).toBeNull();
  });
});
