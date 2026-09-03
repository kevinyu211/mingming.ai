/**
 * Unit tests for the eval diff helper (T031/T032, `tests/eval/diff.ts`).
 *
 * The two eval runners need a live server and a model key, so the thing that must never be wrong —
 * the definition of "the reading matched the sheet" — is tested here against the real
 * `fixtures/sheets/hk_en.expected.json` instead. If this file passes, a green eval run means
 * SC-002 and SC-003 really held.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { SheetReading, StoredReading } from "@/lib/domain/schemas";
import { buildCards } from "@/lib/rules/card-order";
import {
  diffReading,
  percentile,
  sc002,
  sc003,
  scanBanned,
  summarise,
  type RunRecord,
} from "../eval/diff";

const FIXTURE = path.join(process.cwd(), "fixtures", "sheets", "hk_en.expected.json");

function loadExpected(): SheetReading {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as SheetReading;
}

/** A deep copy, so a test that mutates one reading cannot leak into the next. */
function clone(reading: SheetReading): SheetReading {
  return structuredClone(reading);
}

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    sheet: "hk_en",
    run: 1,
    ok: true,
    error: null,
    diff: null,
    banned: null,
    msToFirstCard: 1000,
    msToDone: 2000,
    regenerated: 0,
    templated: 0,
    ...overrides,
  };
}

describe("diffReading", () => {
  it("reports zero diffs when the reading is identical to the fixture", () => {
    const expected = loadExpected();
    const diff = diffReading(expected, clone(expected));

    expect(diff.ok).toBe(true);
    expect(diff.sheetTypeOk).toBe(true);
    expect(diff.medicines.exact).toBe(true);
    expect(diff.medicines.invented).toBe(0);
    expect(diff.medicines.missing).toBe(0);
    expect(diff.medicines.mismatches).toEqual([]);
    expect(diff.warningSigns.coverage).toBe(1);
    expect(diff.warningSigns.missingQuotes).toEqual([]);
    expect(diff.followUp.ok).toBe(true);
    expect(diff.dietLine.ok).toBe(true);
    expect(diff.dietLine.expectedType).toBe("low_salt");
    expect(diff.unreadable.ok).toBe(true);
  });

  it("ignores surrounding whitespace but nothing else", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.medicines[0].strength = "  5mg  ";
    expect(diffReading(expected, actual).medicines.mismatches).toEqual([]);

    const spaced = clone(expected);
    spaced.medicines[0].strength = "5 mg";
    expect(diffReading(expected, spaced).medicines.mismatches).toHaveLength(1);
  });

  it("reports exactly one mismatch when a strength changes", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.medicines[0].strength = "10mg";

    const diff = diffReading(expected, actual);

    expect(diff.medicines.mismatches).toEqual([
      { index: 0, field: "strength", expected: "5mg", actual: "10mg" },
    ]);
    expect(diff.medicines.exact).toBe(false);
    expect(diff.medicines.invented).toBe(0);
    expect(diff.medicines.missing).toBe(0);
    expect(diff.ok).toBe(false);
  });

  it("counts an extra medicine as one invented item", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.medicines.push({
      ...structuredClone(expected.medicines[0]),
      name: "Aspirin",
      strength: "80mg",
    });

    const diff = diffReading(expected, actual);

    expect(diff.medicines.invented).toBe(1);
    expect(diff.medicines.missing).toBe(0);
    // Compared by index, so the three real lines still match field for field.
    expect(diff.medicines.mismatches).toEqual([]);
    expect(diff.medicines.exact).toBe(false);
    expect(diff.ok).toBe(false);
  });

  it("counts a dropped medicine as one missing item", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.medicines.pop();

    const diff = diffReading(expected, actual);

    expect(diff.medicines.missing).toBe(1);
    expect(diff.medicines.invented).toBe(0);
    expect(diff.medicines.exact).toBe(false);
  });

  it("drops warning coverage below 1 when an expected quote is not returned", () => {
    // The hk_en fixture's three signs share one printed line, so distinct quotes are given here
    // to make "one quote went missing" observable at all.
    const expected = loadExpected();
    expected.warningSigns.forEach((sign, i) => {
      sign.source.quote = `Return to A&E immediately if symptom ${i}`;
    });
    const actual = clone(expected);
    actual.warningSigns[0].source.quote = "Return to A&E if you feel unwell";

    const diff = diffReading(expected, actual);

    expect(diff.warningSigns.coverage).toBeCloseTo(2 / 3);
    expect(diff.warningSigns.missingQuotes).toEqual(["Return to A&E immediately if symptom 0"]);
    expect(diff.warningSigns.countOk).toBe(true);
    expect(diff.ok).toBe(false);
  });

  it("reports zero coverage when no warning sign comes back", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.warningSigns = [];

    const diff = diffReading(expected, actual);

    expect(diff.warningSigns.coverage).toBe(0);
    expect(diff.warningSigns.missingQuotes).toHaveLength(3);
    expect(diff.warningSigns.countOk).toBe(false);
  });

  it("matches warning quotes regardless of order", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.warningSigns.reverse();

    expect(diffReading(expected, actual).warningSigns.coverage).toBe(1);
  });

  it("flags a follow-up whose date or clinic changed", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.followUp[0].when = "4/52";

    const diff = diffReading(expected, actual);

    expect(diff.followUp.ok).toBe(false);
    expect(diff.followUp.mismatches).toEqual([
      { index: 0, field: "when", expected: "2/52", actual: "4/52" },
    ]);
  });

  it("checks the diet line's raw text and recomputes its recognised type from the rules", () => {
    const expected = loadExpected();
    const actual = clone(expected) as StoredReading;
    // The server returns a StoredReading, so the diet line already carries recognisedType.
    actual.dietLine = { ...structuredClone(expected.dietLine!), recognisedType: "low_salt" };
    expect(diffReading(expected, actual).dietLine.ok).toBe(true);

    const wrongType = clone(expected) as StoredReading;
    wrongType.dietLine = { ...structuredClone(expected.dietLine!), recognisedType: "other" };
    const diff = diffReading(expected, wrongType);
    expect(diff.dietLine.typeOk).toBe(false);
    expect(diff.dietLine.rawOk).toBe(true);
    expect(diff.dietLine.ok).toBe(false);
  });

  it("accepts more unreadable flags than expected, never fewer", () => {
    const expected = loadExpected();
    expected.unreadable.push({
      section: "出院医嘱",
      description: "thumb over the corner",
      source: { section: "出院医嘱", lineIndex: 7, quote: "" },
    });

    const enough = clone(expected);
    expect(diffReading(expected, enough).unreadable.ok).toBe(true);

    const tooFew = clone(expected);
    tooFew.unreadable = [];
    expect(diffReading(expected, tooFew).unreadable.ok).toBe(false);
  });

  it("fails when the sheet type differs", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.sheetType = "unknown";
    expect(diffReading(expected, actual).sheetTypeOk).toBe(false);
  });
});

describe("scanBanned", () => {
  it("finds nothing in the fixture reading or the cards built from it", () => {
    const expected = loadExpected();
    const scan = scanBanned(expected, buildCards(expected));

    expect(scan.hits).toBe(0);
    expect(scan.terms).toEqual([]);
    expect(scan.where).toEqual([]);
  });

  it("finds a banned term in a card body and in the reading it came from", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    actual.medicines[0].spoken = {
      yue: "醫生診斷咗高血壓。",
      cmn: "医生诊断了高血压。",
      en: "The doctor gave a diagnosis of high blood pressure.",
    };

    const scan = scanBanned(actual, buildCards(actual));

    expect(scan.hits).toBeGreaterThan(0);
    expect(scan.terms).toContain("診斷");
    expect(scan.where.some((w) => w.startsWith("card medicine-0"))).toBe(true);
    expect(scan.where.some((w) => w.startsWith("reading.medicines[0].spoken"))).toBe(true);
  });

  it("never scans a source quote", () => {
    const expected = loadExpected();
    const actual = clone(expected);
    // A real Hong Kong sheet prints this heading; it must not count as a hit.
    actual.medicines[0].source.quote = "Treatment plan: prescribed on discharge";

    expect(scanBanned(actual, buildCards(actual)).hits).toBe(0);
  });
});

describe("summarise", () => {
  it("groups by sheet and averages only the runs that completed", () => {
    const expected = loadExpected();
    const good = diffReading(expected, clone(expected));
    const wrong = clone(expected);
    wrong.medicines[1].frequency = "daily";
    const bad = diffReading(expected, wrong);

    const rows = summarise([
      record({ sheet: "hk_en", run: 1, diff: good, banned: { hits: 0, terms: [], where: [] } }),
      record({
        sheet: "hk_en",
        run: 2,
        diff: bad,
        banned: { hits: 0, terms: [], where: [] },
        msToFirstCard: 3000,
        msToDone: 9000,
      }),
      record({ sheet: "cn_zh", run: 1, ok: false, error: "http 502", msToFirstCard: null, msToDone: null }),
    ]);

    expect(rows.map((r) => r.sheet)).toEqual(["hk_en", "cn_zh"]);
    expect(rows[0].runs).toBe(2);
    expect(rows[0].ok).toBe(2);
    expect(rows[0].exactMedicineRate).toBe(0.5);
    expect(rows[0].warningCoverage).toBe(1);
    expect(rows[0].p50FirstCard).toBe(1000);
    expect(rows[0].p95FirstCard).toBe(3000);
    expect(rows[1].failed).toBe(1);
    expect(rows[1].ok).toBe(0);
    expect(rows[1].p50Done).toBeNull();
  });

  it("adds up banned hits and filter counts across runs", () => {
    const rows = summarise([
      record({ banned: { hits: 1, terms: ["診斷"], where: ["card medicine-0: 診斷"] }, regenerated: 2 }),
      record({ run: 2, banned: { hits: 0, terms: [], where: [] }, templated: 1 }),
    ]);

    expect(rows[0].bannedHits).toBe(1);
    expect(rows[0].bannedTerms).toEqual(["診斷"]);
    expect(rows[0].regenerated).toBe(2);
    expect(rows[0].templated).toBe(1);
  });
});

describe("pass conditions", () => {
  it("SC-002 needs every sheet exact, with nothing invented, missing or failed", () => {
    const expected = loadExpected();
    const good = diffReading(expected, clone(expected));
    const invented = clone(expected);
    invented.medicines.push(structuredClone(expected.medicines[0]));

    const clean = summarise([record({ diff: good, banned: { hits: 0, terms: [], where: [] } })]);
    expect(sc002(clean)).toBe(true);
    expect(sc003(clean)).toBe(true);

    const dirty = summarise([
      record({ diff: diffReading(expected, invented), banned: { hits: 0, terms: [], where: [] } }),
    ]);
    expect(sc002(dirty)).toBe(false);

    const failed = summarise([record({ ok: false, error: "http 502" })]);
    expect(sc002(failed)).toBe(false);

    expect(sc002([])).toBe(false);
  });

  it("SC-003 fails on a single banned hit anywhere", () => {
    const expected = loadExpected();
    const rows = summarise([
      record({
        diff: diffReading(expected, clone(expected)),
        banned: { hits: 1, terms: ["治療"], where: ["card warning-0: 治療"] },
      }),
    ]);
    expect(sc003(rows)).toBe(false);
  });
});

describe("percentile", () => {
  it("uses nearest rank and returns null for an empty sample", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });
});
