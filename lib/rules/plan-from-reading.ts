/**
 * T036 — the follow-up plan rules (US2 scenarios 2 and 3, FR-020, FR-021).
 *
 * Constitution III (the model reads and phrases; rules decide) and IV (everything traces to a
 * line), plus the hackathon agent-limits constraint: **every date and time on the plan comes from
 * a source line on the sheet, and nothing is invented.** So:
 *
 * - `draftPlan` copies, it never composes. Each item's `when` is the verbatim string the model
 *   read off the page ("2/52", "每日两次 随餐", "BD with meals") and each item carries the source
 *   reference of the entity it came from, so the UI can always show the line it stands on.
 * - `parseFollowUpDate` is the ONLY place a calendar date appears, and it produces one only for
 *   forms that can mean exactly one thing. Everything else — "about 2 weeks", "2周左右",
 *   "01/02/2026" (day-first or month-first?), two dates in one string — returns `null`, and the
 *   plan then simply has no date (spec: "the follow-up date is missing or ambiguous: the plan
 *   omits it and says so; nothing is inferred").
 * - `isExpired` / `expiryNotice` implement FR-021: once the visit is past, say the sheet's
 *   instructions were written up to that visit and prompt the user to ask at follow-up. The app
 *   changes nothing on its own — this module has no side effects at all.
 *
 * Pure and deterministic: no I/O, no model, no clock (`today` is always passed in). The result is
 * structurally assignable to `FollowUpPlan`/`PlanItem` in `lib/storage/local.ts`.
 */
import type { SheetReading, SourceReference, StoredReading } from "@/lib/domain/schemas";

/** One line of the plan. `when` is verbatim page text; never computed, never reformatted. */
export interface PlanItem {
  kind: "appointment" | "medicineTime";
  label: string;
  /** Verbatim from the sheet: "2/52", "每日一次", a printed date. "" when nothing was printed. */
  when: string;
  source: SourceReference;
}

/** The unsaved plan. `confirmedAt` is added by the storage layer when the user taps 確認. */
export interface DraftPlan {
  items: PlanItem[];
  /** ISO calendar date "YYYY-MM-DD", or null when no unambiguous date could be parsed. */
  followUpDate: string | null;
}

/** Separator between the clinic and the tests on an appointment label. */
const LABEL_JOIN = " · ";

/** True for a string that actually carries printed content. Blank is treated as "not printed". */
function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Builds the draft plan from a reading. Appointments first (that is the date the rest hangs off),
 * then medicine times, each group in the order the model read them off the page.
 *
 * - One `appointment` per follow-up entry that has a `when` or a `clinic`. The label is the clinic
 *   and the tests joined verbatim ("SOPD · fasting bloods"); an entry that printed neither gets an
 *   empty label rather than an invented one. `when` is "" when no time was printed, and a plan
 *   with no printed time can have no `followUpDate`.
 * - One `medicineTime` per medicine that printed a frequency. The label is the name plus the
 *   strength, verbatim, and `when` is the frequency, verbatim. A medicine with no printed
 *   frequency is skipped: its card already says the usage is not printed and points at the
 *   pharmacist, and a reminder with no time would be an invention.
 */
export function draftPlan(reading: StoredReading | SheetReading): DraftPlan {
  const items: PlanItem[] = [];

  for (const followUp of reading.followUp ?? []) {
    if (!present(followUp.when) && !present(followUp.clinic)) continue;
    items.push({
      kind: "appointment",
      label: [followUp.clinic, followUp.tests].filter(present).join(LABEL_JOIN),
      when: followUp.when ?? "",
      source: { ...followUp.source },
    });
  }

  for (const medicine of reading.medicines ?? []) {
    if (!present(medicine.frequency)) continue;
    items.push({
      kind: "medicineTime",
      label: present(medicine.strength) ? `${medicine.name} ${medicine.strength}` : medicine.name,
      when: medicine.frequency,
      source: { ...medicine.source },
    });
  }

  // A raw SheetReading has no readAt; without a read date there is no anchor for a relative form
  // such as "2/52", so the plan carries no date at all.
  const readAt = "readAt" in reading && typeof reading.readAt === "string" ? reading.readAt : "";
  const firstAppointment = items.find((item) => item.kind === "appointment");

  return {
    items,
    followUpDate: firstAppointment ? parseFollowUpDate(firstAppointment.when, readAt) : null,
  };
}

/* ------------------------------------------------------------------ date parsing */

type Ymd = { y: number; m: number; d: number };
type Unit = "day" | "week" | "month";

/**
 * Anything on this list makes the whole string ambiguous, whatever else it contains. `約`/`约` is
 * on it because the spec names it: the cost is that a line printing 預約 ("booking") is treated as
 * ambiguous and yields no date, which is the safe direction.
 */
const AMBIGUOUS_MARKERS: readonly RegExp[] = [
  /左右/,
  /大約|大约/,
  /大概/,
  /[約约]/,
  /前後|前后/,
  /待定/,
  /另[約约]/,
  /\babout\b/,
  /\bapprox/,
  /\baround\b/,
  /\broughly\b/,
  /\bor\b/,
  /\btbc\b/,
  /\bto be (?:confirmed|advised|arranged)\b/,
  /[?？]/,
];

/** Chinese numerals up to twelve, plus a plain digit run. */
const CN_NUMBER = "(?:\\d{1,3}|十[一二]?|[一二兩两三四五六七八九])";

const CN_NUMERALS: Readonly<Record<string, number>> = {
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
};

/** Explicit printed dates. Applied in this order; every match is masked out of the string. */
const EXPLICIT_RULES: ReadonlyArray<{
  readonly id: string;
  readonly pattern: RegExp;
  /** Returns a date, `null` for "not a real date", or "ambiguous" to kill the whole parse. */
  readonly build: (m: RegExpMatchArray, base: Ymd) => Ymd | null | "ambiguous";
}> = [
  {
    // 2026年9月15日 — the year is printed, so nothing is inferred.
    id: "zh.ymd",
    pattern: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]?/g,
    build: (m) => validYmd({ y: +m[1], m: +m[2], d: +m[3] }),
  },
  {
    // 9月15日 — no year printed, so the year comes from readAt and rolls forward when the day
    // would otherwise already be past. The day marker (日/号/號) is required so that "3个月后"
    // and "2周后" can never be mistaken for a date.
    id: "zh.md",
    pattern: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]/g,
    build: (m, base) => {
      const thisYear = validYmd({ y: base.y, m: +m[1], d: +m[2] });
      if (!thisYear) return null;
      return compare(thisYear, base) < 0 ? validYmd({ ...thisYear, y: base.y + 1 }) : thisYear;
    },
  },
  {
    // 2026-09-15 / 2026/09/15 — year first, so the order is never in doubt.
    id: "iso",
    pattern: /(\d{4})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})/g,
    build: (m) => validYmd({ y: +m[1], m: +m[2], d: +m[3] }),
  },
  {
    // 15/09/2026 — day first, as printed in Hong Kong. When both parts are ≤ 12 the string is
    // exactly as consistent with the American MM/DD/YYYY, so it is ambiguous and yields nothing
    // ("01/02/2026" could be 1 February or 2 January). A first part ≤ 12 with a second part > 12
    // can only be MM/DD/YYYY, which is not the printed convention here, so it is ambiguous too.
    id: "dayFirst",
    pattern: /(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{4})/g,
    build: (m) => {
      const first = +m[1];
      const second = +m[2];
      if (first <= 12) return "ambiguous";
      return validYmd({ y: +m[3], m: second, d: first });
    },
  },
];

/** Relative shorthand. Every one of these is anchored on the date part of `readAt`. */
const RELATIVE_RULES: ReadonlyArray<{
  readonly id: string;
  readonly pattern: RegExp;
  readonly unit: Unit;
  readonly min: number;
  readonly max: number;
  /** Fixed offset for forms that carry no number of their own (半個月). */
  readonly fixed?: number;
}> = [
  // Hong Kong clinical shorthand: weeks over 52, days over 7, months over 12.
  { id: "en.n52", pattern: /(\d{1,2})\s*\/\s*52(?![\d/])/g, unit: "week", min: 1, max: 52 },
  { id: "en.n7", pattern: /(\d{1,3})\s*\/\s*7(?![\d/])/g, unit: "day", min: 1, max: 365 },
  { id: "en.n12", pattern: /(\d{1,2})\s*\/\s*12(?![\d/])/g, unit: "month", min: 1, max: 24 },
  { id: "en.weeks", pattern: /\b(\d{1,2})\s*(?:wks?|weeks?)\b/g, unit: "week", min: 1, max: 52 },
  { id: "en.days", pattern: /\b(\d{1,3})\s*days?\b/g, unit: "day", min: 1, max: 365 },
  { id: "en.months", pattern: /\b(\d{1,2})\s*months?\b/g, unit: "month", min: 1, max: 24 },
  {
    id: "zh.weeks",
    pattern: new RegExp(`(${CN_NUMBER})\\s*[个個]?\\s*(?:周|週|星期|禮拜|礼拜)\\s*之?[後后]`, "g"),
    unit: "week",
    min: 1,
    max: 52,
  },
  {
    id: "zh.days",
    pattern: new RegExp(`(${CN_NUMBER})\\s*[天日]\\s*之?[後后]`, "g"),
    unit: "day",
    min: 1,
    max: 365,
  },
  {
    id: "zh.months",
    pattern: new RegExp(`(${CN_NUMBER})\\s*[个個]?\\s*月\\s*之?[後后]`, "g"),
    unit: "month",
    min: 1,
    max: 24,
  },
  // 半個月 is the one fixed idiom: half a month is fifteen days on every sheet that prints it.
  { id: "zh.halfMonth", pattern: /半\s*[个個]?\s*月\s*(?:之?[後后])?/g, unit: "day", min: 15, max: 15, fixed: 15 },
];

/**
 * Turns a printed follow-up time into a calendar date, or `null` when it could mean more than one
 * thing. `readAt` is the client's ISO timestamp for the read; only its date part is used, and an
 * absent or unparseable one yields `null` (there is nothing to count from).
 *
 * Recognised (case-insensitive, full-width forms folded):
 * - relative English: `N/52` weeks (1–52), `N/7` days (1–365), `N/12` months (1–24),
 *   `N wk(s)` / `N week(s)`, `N day(s)`, `N month(s)`;
 * - relative Chinese: `N周后` / `N週後` / `N星期後` / `N个星期后` (Chinese numerals up to 十二),
 *   `N天后` / `N日後`, `N个月后` / `N個月後`, and `半个月` = 15 days;
 * - explicit: `YYYY-MM-DD`, `YYYY/MM/DD`, `DD/MM/YYYY`, `DD-MM-YYYY` (day-first), `YYYY年M月D日`,
 *   and `M月D日` (year from `readAt`, rolled to the next year when it would already be past).
 *
 * Returns `null` for: anything hedged (左右, 大约, 約, 大概, "about", "approx", "around", "tbc",
 * a question mark), anything with no recognised form at all ("soon"), an impossible date
 * ("2026-02-30"), a `DD/MM/YYYY` whose two leading parts are both ≤ 12 ("01/02/2026" — day-first
 * and month-first are indistinguishable), and anything that yields two different dates
 * ("2/52 or 4/52").
 */
export function parseFollowUpDate(when: string | null | undefined, readAt: string): string | null {
  if (when == null) return null;
  const text = normalise(when);
  if (text.length === 0) return null;

  const base = readAtDate(readAt);
  if (!base) return null;

  if (AMBIGUOUS_MARKERS.some((marker) => marker.test(text))) return null;

  const candidates = new Set<string>();
  let ambiguous = false;
  let rest = text;

  for (const rule of EXPLICIT_RULES) {
    rest = maskMatches(rest, rule.pattern, (m) => {
      const built = rule.build(m, base);
      if (built === "ambiguous") ambiguous = true;
      else if (built) candidates.add(format(built));
      return true;
    });
  }

  for (const rule of RELATIVE_RULES) {
    for (const m of rest.matchAll(rule.pattern)) {
      if (precededByNumeric(rest, m.index ?? 0)) continue;
      const n = rule.fixed ?? toNumber(m[1]);
      if (n === null || n < rule.min || n > rule.max) continue;
      candidates.add(format(addOffset(base, rule.unit, n)));
    }
  }

  if (ambiguous) return null;
  // Nothing recognised, or two readings of the same string: either way there is no date to show.
  if (candidates.size !== 1) return null;
  return [...candidates][0];
}

/**
 * True when the confirmed follow-up visit is in the past — strictly before today's calendar date,
 * so the day of the visit itself is not expired. `today` is formatted in local time, because the
 * user's "today" is the one on their phone. A missing or malformed date is never expired.
 */
export function isExpired(followUpDate: string | null | undefined, today: Date): boolean {
  if (!followUpDate || !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) return false;
  if (Number.isNaN(today.getTime())) return false;
  const local = `${pad(today.getFullYear(), 4)}-${pad(today.getMonth() + 1, 2)}-${pad(today.getDate(), 2)}`;
  return followUpDate < local;
}

/**
 * The one fixed sentence shown when the follow-up date has passed (FR-021), in all three spoken
 * forms. It states what the sheet covered and sends the question to the follow-up visit; it does
 * not extend, change or decide anything, and every form passes the banned-term filter.
 */
export function expiryNotice(): { yue: string; cmn: string; en: string } {
  return {
    yue: "張紙嘅指示係寫到覆診嗰日為止，覆診時問吓仲使唔使。",
    cmn: "这张纸上的指示是写到复诊那天为止的，复诊时问一下还要不要继续。",
    en: "The instructions on this sheet were written for the period up to that visit — ask at the follow-up whether they still apply.",
  };
}

/* ------------------------------------------------------------------ helpers */

/** Zero-width characters, slash and dash look-alikes, folded so a full-width sheet parses too. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2044\u2215\u29F8]/g, "/")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The calendar date the sheet was read on, from the client's `readAt`.
 *
 * A full ISO timestamp ("2026-09-02T17:30:00.000Z") is resolved to the LOCAL calendar date of the
 * runtime — the phone's zone, Hong Kong for this product — because "two weeks from now" counts
 * from the day the family is living in, not the UTC day. 17:30Z on 2 Sep is 01:30 on 3 Sep in
 * Hong Kong, so a read then anchors on 3 Sep. A bare "YYYY-MM-DD" is taken as-is. Tests run with
 * TZ=Asia/Hong_Kong (vitest.config.mts) so this is asserted deterministically.
 */
function readAtDate(readAt: string): Ymd | null {
  if (typeof readAt !== "string") return null;
  const trimmed = readAt.trim();
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (bare) return validYmd({ y: +bare[1], m: +bare[2], d: +bare[3] });
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;
  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime())) return null;
  return validYmd({ y: instant.getFullYear(), m: instant.getMonth() + 1, d: instant.getDate() });
}

/** A digit or a date separator immediately before a match means we are inside a longer run. */
function precededByNumeric(text: string, at: number): boolean {
  return at > 0 && /[\d./-]/.test(text[at - 1]);
}

/**
 * Runs `pattern` over `text`, calls `onMatch` for every hit, and blanks out the hits it accepted
 * (same length, so later patterns still see the original offsets). Masking is what stops
 * "15/12/2026" from also reading as "15 months" via the `N/12` shorthand.
 */
function maskMatches(
  text: string,
  pattern: RegExp,
  onMatch: (m: RegExpMatchArray) => boolean,
): string {
  let masked = "";
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (precededByNumeric(text, at) || !onMatch(m)) continue;
    masked += text.slice(last, at) + " ".repeat(m[0].length);
    last = at + m[0].length;
  }
  return masked + text.slice(last);
}

/** A digit run or a Chinese numeral up to twelve. */
function toNumber(token: string | undefined): number | null {
  if (!token) return null;
  if (/^\d+$/.test(token)) return Number(token);
  return CN_NUMERALS[token] ?? null;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** `null` for anything that is not a real calendar date. */
function validYmd(ymd: Ymd): Ymd | null {
  const { y, m, d } = ymd;
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1) return null;
  return d <= daysInMonth(y, m) ? ymd : null;
}

function compare(a: Ymd, b: Ymd): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

/**
 * Calendar arithmetic on Y-M-D only: `Date.UTC` is used purely as a day counter, so the result
 * never depends on the machine's timezone. Adding months clamps to the end of the month
 * (31 January + 1 month = 28 or 29 February), which is the only reading that stays in the month
 * the sheet asked for.
 */
function addOffset(base: Ymd, unit: Unit, n: number): Ymd {
  if (unit === "month") {
    const months = base.m - 1 + n;
    const y = base.y + Math.floor(months / 12);
    const m = (months % 12) + 1;
    return { y, m, d: Math.min(base.d, daysInMonth(y, m)) };
  }
  const days = unit === "week" ? n * 7 : n;
  const shifted = new Date(Date.UTC(base.y, base.m - 1, base.d + days));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function format(ymd: Ymd): string {
  return `${pad(ymd.y, 4)}-${pad(ymd.m, 2)}-${pad(ymd.d, 2)}`;
}
