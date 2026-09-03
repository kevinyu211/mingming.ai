/**
 * Shared, pure helpers for the two eval runners (T031, T032).
 *
 * Nothing here does I/O, opens a socket or reads a clock: `reading.ts` and `questions.ts` collect
 * the data, these functions decide what it means. That split is what makes the pass conditions of
 * SC-002 and SC-003 unit-testable without a model key (`tests/unit/eval-diff.test.ts`).
 *
 * The comparison rules come from `provider_shortlist.md` section 5 ("diff against expected.json
 * per field; count invented items, missed items, unreadable flags") and from constitution
 * principle I: a medicine line is verbatim or it is wrong. There is no partial credit on a dose.
 */
import type {
  Card,
  DietType,
  SheetReading,
  Speakable,
  StoredReading,
} from "../../lib/domain/schemas";
import { checkSpeakable } from "../../lib/rules/banned-terms";
import { recogniseDiet } from "../../lib/rules/diet-line";

/* -------------------------------------------------------------------------- */
/* The shared results file                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Both runners insert their run block directly below this line, newest first — the convention
 * `tests/eval/voices.ts` established. Kept here so the two runners cannot drift apart.
 */
export const RESULTS_MARKER = "<!-- tests/eval runners append run blocks below this line. -->";

/** Written only when `tests/eval/results.md` does not exist yet. */
export const RESULTS_HEADER = [
  "# Eval results",
  "",
  "Machine-written. `tests/eval/reading.ts` (T031) and `tests/eval/questions.ts` (T032) insert one",
  "block per run below the marker, newest first. The human decisions live in `tests/eval/reading.md`,",
  "`tests/eval/phrasing.md`, `tests/eval/voices.md` and `tests/eval/stt.md`.",
  "",
  "Pass lines, from `spec.md`:",
  "",
  "- **SC-002** — zero invented medicines, zero missing medicines, medicine fields verbatim on every sheet.",
  "- **SC-003** — zero banned terms after filtering, across every generated string of every run.",
  "- **SC-006** — every question's outcome matches, answerable ones cite the right card, p95 time to answer under 10 s.",
  "",
  "## How to run",
  "",
  "Both runners need a server on `--base` (default `http://localhost:3000`) and, for a live run, an",
  "`ANTHROPIC_API_KEY` in `.env.local`. Neither runner chooses a model: restart the server with",
  "`MODEL_READ=<id>` and pass the same id to `--model` so the block below records which one ran.",
  "",
  "```bash",
  "npm run dev                                                     # in another terminal",
  "npm run eval -- --sheets all --runs 34 --model claude-opus-5     # SC-002, SC-003 (quickstart V6)",
  "NODE_OPTIONS=--use-openssl-ca tsx tests/eval/questions.ts        # SC-006 (quickstart V5)",
  "```",
  "",
  "**No live run has happened yet.**",
  "",
  RESULTS_MARKER,
  "",
].join("\n");

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** The five verbatim medicine fields. Order is the order they are reported in. */
export const MEDICINE_FIELDS = ["name", "strength", "amount", "frequency", "duration"] as const;
export type MedicineField = (typeof MEDICINE_FIELDS)[number];

/** One field of one item that came back different from the fixture. */
export interface FieldMismatch {
  /** Index into the expected array; the same index in the returned array was compared. */
  index: number;
  field: string;
  expected: string;
  actual: string;
}

export interface MedicineDiff {
  expectedCount: number;
  returnedCount: number;
  /** Medicines returned beyond what the sheet prints — SC-002's "zero items are invented". */
  invented: number;
  /** Printed medicines that did not come back — SC-002's "zero are silently omitted". */
  missing: number;
  mismatches: FieldMismatch[];
  /** True only when every printed medicine came back with all five fields verbatim. */
  exact: boolean;
}

export interface WarningDiff {
  expectedCount: number;
  returnedCount: number;
  countOk: boolean;
  /** Expected `source.quote` values that appear among the returned quotes. */
  matchedQuotes: number;
  missingQuotes: string[];
  /** matchedQuotes / expectedCount; 1 when the fixture prints no warning signs. */
  coverage: number;
}

export interface FollowUpDiff {
  expectedCount: number;
  returnedCount: number;
  mismatches: FieldMismatch[];
  ok: boolean;
}

export interface DietDiff {
  present: boolean;
  rawOk: boolean;
  typeOk: boolean;
  expectedType: DietType | null;
  actualType: DietType | null;
  ok: boolean;
}

export interface UnreadableDiff {
  expectedCount: number;
  returnedCount: number;
  /** The bad-photo fixture only asks for "at least as many", never for an exact match. */
  ok: boolean;
}

export interface ReadingDiff {
  sheetTypeOk: boolean;
  medicines: MedicineDiff;
  warningSigns: WarningDiff;
  followUp: FollowUpDiff;
  dietLine: DietDiff;
  unreadable: UnreadableDiff;
  /** True when every check above passed. */
  ok: boolean;
}

/** Where a banned term was found, and which terms. `hits` is the count SC-003 must see as 0. */
export interface BannedScan {
  hits: number;
  terms: string[];
  where: string[];
}

/** One completed (or failed) POST to `/api/read`. Built by `reading.ts`, summarised here. */
export interface RunRecord {
  sheet: string;
  run: number;
  /** True when the stream reached a `done` event carrying a reading. */
  ok: boolean;
  error: string | null;
  diff: ReadingDiff | null;
  banned: BannedScan | null;
  msToFirstCard: number | null;
  msToDone: number | null;
  regenerated: number;
  templated: number;
}

/** One row of the per-sheet table both the console and `results.md` print. */
export interface SummaryRow {
  sheet: string;
  runs: number;
  ok: number;
  failed: number;
  /** Share of completed runs whose medicines were all verbatim, 0 to 1. */
  exactMedicineRate: number;
  invented: number;
  missing: number;
  /** Mean warning-sign quote coverage across completed runs, 0 to 1. */
  warningCoverage: number;
  dietOk: number;
  unreadableOk: number;
  bannedHits: number;
  bannedTerms: string[];
  regenerated: number;
  templated: number;
  p50FirstCard: number | null;
  p95FirstCard: number | null;
  p50Done: number | null;
  p95Done: number | null;
}

/* -------------------------------------------------------------------------- */
/* Field comparison                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Verbatim comparison. A missing field and an empty field are the same absence, so both normalise
 * to `""`; everything else is compared character for character after trimming the ends. No case
 * folding, no width folding, no punctuation folding: "5mg" and "5 mg" are different doses as far
 * as this file is concerned, which is the point.
 */
function verbatim(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function same(expected: string | null | undefined, actual: string | null | undefined): boolean {
  return verbatim(expected) === verbatim(actual);
}

/* -------------------------------------------------------------------------- */
/* diffReading                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Field-by-field diff of one returned reading against its `fixtures/sheets/<id>.expected.json`.
 *
 * Medicines and follow-up items are compared **by index**: the fixtures print them in the order
 * the sheet does, and a reordered list is a reading error, not a formatting choice. Warning signs
 * are compared by quote and are order-insensitive, because the three lines on a sheet often share
 * one printed sentence and the model may split it either way.
 *
 * `dietLine.recognisedType` is recomputed from the printed `raw` line with the rules module rather
 * than trusted from either side — that field belongs to `lib/rules/diet-line.ts` (FR-025).
 */
export function diffReading(
  expected: SheetReading,
  actual: SheetReading | StoredReading,
): ReadingDiff {
  const sheetTypeOk = expected.sheetType === actual.sheetType;
  const medicines = diffMedicines(expected, actual);
  const warningSigns = diffWarnings(expected, actual);
  const followUp = diffFollowUp(expected, actual);
  const dietLine = diffDiet(expected, actual);
  const unreadable = diffUnreadable(expected, actual);
  return {
    sheetTypeOk,
    medicines,
    warningSigns,
    followUp,
    dietLine,
    unreadable,
    ok:
      sheetTypeOk &&
      medicines.exact &&
      warningSigns.countOk &&
      warningSigns.coverage === 1 &&
      followUp.ok &&
      dietLine.ok &&
      unreadable.ok,
  };
}

function diffMedicines(expected: SheetReading, actual: SheetReading): MedicineDiff {
  const mismatches: FieldMismatch[] = [];
  const shared = Math.min(expected.medicines.length, actual.medicines.length);
  for (let i = 0; i < shared; i += 1) {
    const e = expected.medicines[i];
    const a = actual.medicines[i];
    for (const field of MEDICINE_FIELDS) {
      if (!same(e[field], a[field])) {
        mismatches.push({
          index: i,
          field,
          expected: verbatim(e[field]),
          actual: verbatim(a[field]),
        });
      }
    }
  }
  const invented = Math.max(0, actual.medicines.length - expected.medicines.length);
  const missing = Math.max(0, expected.medicines.length - actual.medicines.length);
  return {
    expectedCount: expected.medicines.length,
    returnedCount: actual.medicines.length,
    invented,
    missing,
    mismatches,
    exact: invented === 0 && missing === 0 && mismatches.length === 0,
  };
}

function diffWarnings(expected: SheetReading, actual: SheetReading): WarningDiff {
  const returned = new Set(actual.warningSigns.map((w) => verbatim(w.source.quote)));
  const missingQuotes: string[] = [];
  let matchedQuotes = 0;
  for (const sign of expected.warningSigns) {
    if (returned.has(verbatim(sign.source.quote))) matchedQuotes += 1;
    else missingQuotes.push(verbatim(sign.source.quote));
  }
  const expectedCount = expected.warningSigns.length;
  return {
    expectedCount,
    returnedCount: actual.warningSigns.length,
    countOk: expectedCount === actual.warningSigns.length,
    matchedQuotes,
    missingQuotes,
    coverage: expectedCount === 0 ? 1 : matchedQuotes / expectedCount,
  };
}

function diffFollowUp(expected: SheetReading, actual: SheetReading): FollowUpDiff {
  const mismatches: FieldMismatch[] = [];
  const shared = Math.min(expected.followUp.length, actual.followUp.length);
  for (let i = 0; i < shared; i += 1) {
    for (const field of ["when", "clinic"] as const) {
      const e = expected.followUp[i][field];
      const a = actual.followUp[i][field];
      if (!same(e, a)) {
        mismatches.push({ index: i, field, expected: verbatim(e), actual: verbatim(a) });
      }
    }
  }
  return {
    expectedCount: expected.followUp.length,
    returnedCount: actual.followUp.length,
    mismatches,
    ok: expected.followUp.length === actual.followUp.length && mismatches.length === 0,
  };
}

function diffDiet(expected: SheetReading, actual: SheetReading | StoredReading): DietDiff {
  const e = expected.dietLine;
  const a = actual.dietLine;
  if (!e && !a) {
    return {
      present: false,
      rawOk: true,
      typeOk: true,
      expectedType: null,
      actualType: null,
      ok: true,
    };
  }
  if (!e || !a) {
    return {
      present: true,
      rawOk: false,
      typeOk: false,
      expectedType: e ? recogniseDiet(e.raw) : null,
      actualType: a ? dietTypeOf(a) : null,
      ok: false,
    };
  }
  const rawOk = same(e.raw, a.raw);
  const expectedType = recogniseDiet(e.raw);
  const actualType = dietTypeOf(a);
  const typeOk = expectedType === actualType;
  return { present: true, rawOk, typeOk, expectedType, actualType, ok: rawOk && typeOk };
}

/** The stored shape carries `recognisedType`; the raw model shape does not, so derive it. */
function dietTypeOf(line: NonNullable<SheetReading["dietLine"] | StoredReading["dietLine"]>): DietType {
  if ("recognisedType" in line && line.recognisedType) return line.recognisedType;
  return recogniseDiet(line.raw);
}

function diffUnreadable(expected: SheetReading, actual: SheetReading): UnreadableDiff {
  return {
    expectedCount: expected.unreadable.length,
    returnedCount: actual.unreadable.length,
    ok: actual.unreadable.length >= expected.unreadable.length,
  };
}

/* -------------------------------------------------------------------------- */
/* scanBanned                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Runs `checkSpeakable` over every generated string in a reading and in the cards built from it.
 * `SourceReference.quote` is verbatim page text and is never scanned (research.md R14).
 *
 * `hits` counts one per (location, term) pair, so one card carrying two banned terms is two hits.
 * SC-003 passes only when it is 0 across every run.
 */
export function scanBanned(
  reading: SheetReading | StoredReading | null,
  cards: readonly Card[] = [],
): BannedScan {
  const terms = new Set<string>();
  const where: string[] = [];
  let hits = 0;

  const scan = (label: string, speakable: Speakable | null | undefined): void => {
    if (!speakable) return;
    const result = checkSpeakable(speakable);
    if (result.ok) return;
    for (const term of result.matches) {
      terms.add(term);
      hits += 1;
    }
    where.push(`${label}: ${result.matches.join(", ")}`);
  };

  for (const card of cards) scan(`card ${card.id}`, card.body);

  if (reading) {
    reading.warningSigns.forEach((w, i) => {
      scan(`reading.warningSigns[${i}].symptom`, w.symptom);
      scan(`reading.warningSigns[${i}].action`, w.action);
    });
    reading.medicines.forEach((m, i) => scan(`reading.medicines[${i}].spoken`, m.spoken));
    reading.followUp.forEach((f, i) => scan(`reading.followUp[${i}].spoken`, f.spoken));
    scan("reading.dietLine.spoken", reading.dietLine?.spoken);
    scan("reading.activityLine.spoken", reading.activityLine?.spoken);
    scan("reading.hospitalContact.spoken", reading.hospitalContact?.spoken);
  }

  return { hits, terms: [...terms], where };
}

/* -------------------------------------------------------------------------- */
/* summarise                                                                  */
/* -------------------------------------------------------------------------- */

/** Nearest-rank percentile over a small sample. `null` when there is nothing to rank. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * One row per sheet, in first-seen order, aggregated across that sheet's runs.
 *
 * Failed runs (no `done` event) count in `runs` and `failed` but contribute nothing to the rates:
 * a timeout is not a wrong dose, and averaging it in would hide both.
 */
export function summarise(records: readonly RunRecord[]): SummaryRow[] {
  const order: string[] = [];
  const bySheet = new Map<string, RunRecord[]>();
  for (const record of records) {
    if (!bySheet.has(record.sheet)) {
      bySheet.set(record.sheet, []);
      order.push(record.sheet);
    }
    bySheet.get(record.sheet)?.push(record);
  }

  return order.map((sheet) => {
    const own = bySheet.get(sheet) ?? [];
    const done = own.filter((r) => r.ok && r.diff);
    const diffs = done.map((r) => r.diff as ReadingDiff);
    const terms = new Set<string>();
    for (const record of own) for (const term of record.banned?.terms ?? []) terms.add(term);

    const firstCard = own.map((r) => r.msToFirstCard).filter((v): v is number => v !== null);
    const toDone = own.map((r) => r.msToDone).filter((v): v is number => v !== null);

    return {
      sheet,
      runs: own.length,
      ok: done.length,
      failed: own.length - done.length,
      exactMedicineRate:
        diffs.length === 0 ? 0 : diffs.filter((d) => d.medicines.exact).length / diffs.length,
      invented: diffs.reduce((sum, d) => sum + d.medicines.invented, 0),
      missing: diffs.reduce((sum, d) => sum + d.medicines.missing, 0),
      warningCoverage:
        diffs.length === 0
          ? 0
          : diffs.reduce((sum, d) => sum + d.warningSigns.coverage, 0) / diffs.length,
      dietOk: diffs.filter((d) => d.dietLine.ok).length,
      unreadableOk: diffs.filter((d) => d.unreadable.ok).length,
      bannedHits: own.reduce((sum, r) => sum + (r.banned?.hits ?? 0), 0),
      bannedTerms: [...terms],
      regenerated: own.reduce((sum, r) => sum + r.regenerated, 0),
      templated: own.reduce((sum, r) => sum + r.templated, 0),
      p50FirstCard: percentile(firstCard, 50),
      p95FirstCard: percentile(firstCard, 95),
      p50Done: percentile(toDone, 50),
      p95Done: percentile(toDone, 95),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Pass conditions                                                            */
/* -------------------------------------------------------------------------- */

/** SC-002: zero invented, zero missing, and every medicine field verbatim on every sheet. */
export function sc002(rows: readonly SummaryRow[]): boolean {
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.ok > 0 && row.failed === 0 && row.invented === 0 && row.missing === 0 && row.exactMedicineRate === 1,
    )
  );
}

/** SC-003: no banned term survives filtering, anywhere, in any run. */
export function sc003(rows: readonly SummaryRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.bannedHits === 0);
}
