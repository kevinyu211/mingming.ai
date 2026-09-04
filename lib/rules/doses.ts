/**
 * How many times a day the page says to take a medicine, and how many of those are left today
 * (v2 build brief §5, §7; constitution I, III and VII).
 *
 * Pure and deterministic: no I/O, no model, **no clock**. `today` is always passed in, so a test
 * can roll the calendar forward without touching the system time and the daily reset is a
 * comparison rather than a timer.
 *
 * Two rules govern everything in this file.
 *
 * **A counter never shows a clock time.** A discharge sheet prints a *frequency* — 「每日兩次，
 * 隨餐」 — not an hour. Turning that into "8am / 8pm" would be prescribing, so nothing here ever
 * derives a time of day: `printed` is the clause verbatim for the UI to quote behind 「張紙寫：」,
 * and `total` is a count of times remaining today. Nothing else is inferred from the clause.
 *
 * **It never guesses.** `timesPerDay` recognises the handful of forms a discharge sheet actually
 * prints and returns `{ total: 0, asNeeded: false }` for everything else, which the UI renders as
 * the printed clause with no counter at all. A clause we cannot parse is a clause the family
 * reads off the paper — not a number we invented for them.
 */
import type { Medicine, SheetReading, StoredReading } from "@/lib/domain/schemas";
import type { DoseState } from "@/lib/sheets/types";

/** One medicine, as the 跟進 tab and the check-in need it. */
export interface DoseTarget {
  /** `m${index}` — the medicine's index in `reading.medicines`. Stable for one reading. */
  key: string;
  /** Verbatim name plus strength, exactly as printed: "Metoprolol 25mg". */
  name: string;
  /**
   * The second line under the name: the printed amount per dose ("1 粒", "2 tabs"), verbatim, or
   * "" when the page printed none. The strength already rides on `name` per the §5 contract, so
   * it is not repeated here — printing one fact on two lines only makes a card longer to read.
   */
  generic: string;
  /** The frequency clause, VERBATIM, rendered behind 「張紙寫：」. "" when nothing was printed. */
  printed: string;
  /** Times per day the clause states. 0 when it is as-needed, unstated, or unparseable. */
  total: number;
  /** 痛先食 / PRN — shown as 唔痛就唔使食 and never counted down. */
  asNeeded: boolean;
  /** `status !== "current"`: the page has withdrawn it. Never scheduled, never counted, never taken. */
  stopped: boolean;
}

/** What `timesPerDay` answers. `total: 0` with `asNeeded: false` means "could not tell". */
export interface TimesPerDay {
  total: number;
  asNeeded: boolean;
}

const UNKNOWN: TimesPerDay = { total: 0, asNeeded: false };
const AS_NEEDED: TimesPerDay = { total: 0, asNeeded: true };

/**
 * The most times a day a discharge sheet plausibly prints. Six is already generous (QID is four).
 * A larger number is far likelier to be a misread digit than an instruction, so it is refused
 * rather than counted — refusing shows the printed clause, counting would show a wrong number.
 */
const MAX_PER_DAY = 6;

/**
 * As-needed markers. When any of these is present the clause is not a schedule at all, whatever
 * else it says: 「痛嘅時候食，一日最多四次」 prints a ceiling, not four doses to tick off. So this
 * check runs first and wins outright.
 */
const AS_NEEDED_MARKERS: readonly RegExp[] = [
  /痛先食/,
  /痛(?:嘅)?時候?\s*[食服]/,
  /需要時|需要时/,
  /必要時|必要时/,
  /有需要/,
  /按需/,
  /\bPRN\b/i,
  /\bp\.\s*r\.\s*n\.?/i,
  /\bas\s+(?:required|needed|necessary)\b/i,
  /\bwhen\s+(?:required|needed|necessary)\b/i,
  /\bif\s+(?:required|needed|necessary)\b/i,
];

/** Chinese numerals a frequency clause can use. Anything above ten is out of range anyway. */
const CN_NUMERALS: Record<string, number> = {
  一: 1,
  壹: 1,
  二: 2,
  貳: 2,
  贰: 2,
  兩: 2,
  两: 2,
  三: 3,
  叁: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** English count words that a frequency clause spells out. */
const EN_NUMERALS: Record<string, number> = {
  once: 1,
  twice: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/** BD and TDS are the Hong Kong spellings, BID and TID the American ones; sheets print both. */
const LATIN_ABBREVIATIONS: Record<string, number> = {
  od: 1,
  bd: 2,
  bid: 2,
  tds: 3,
  tid: 3,
  qid: 4,
  qds: 4,
};

/**
 * 每日 N 次 / 每天 N 次 / 一日 N 次, in digits or Chinese numerals.
 *
 * The count has to sit directly between the day marker and 次. That adjacency is the whole guard:
 * 「一日最多四次」 is a maximum rather than a schedule and 「每日一至兩次」 is a range, and neither
 * matches, so both fall through to "could not tell" and the card shows the clause instead.
 */
const ZH_PER_DAY = /(?:每[日天]|一[日天])\s*([0-9]{1,2}|[一壹二貳贰兩两三叁四五六七八九十])\s*次/g;

/** "3 times a day", "2 times daily", "1 x daily". A duration ("for 7 days") has no 次 to match. */
const EN_DIGIT_PER_DAY = /\b([0-9]{1,2})\s*(?:x|times?)\s*(?:\/|a|per|each|every)?\s*(?:day|daily)\b/gi;

/** "once daily", "twice a day". "twice weekly" is not a day and does not match. */
const EN_ONCE_TWICE = /\b(once|twice)\s*(?:a|per|each|every)?\s*(?:day|daily)\b/gi;

/** "three times daily", "four times a day". */
const EN_WORD_TIMES = /\b(three|four|five|six)\s+times?\s*(?:a|per|each|every)?\s*(?:day|daily)\b/gi;

/** OD / BD / TDS / QID and their twins, whole words only so "food" and "Cardio" cannot match. */
const LATIN_ABBREVIATION = /\b(od|bd|bid|tds|tid|qid|qds)\b/gi;

/**
 * Once a day, stated without printing a numeral.
 *
 * These are only consulted when no numbered pattern above matched, which is what makes them safe:
 * "twice daily" is already 2 before this list is reached, and "1 tab daily" is one dose a day, not
 * one dose an hour. The count is a count — nothing here says WHEN. 「每朝一次」 and `nocte` both
 * resolve to 1, and neither puts a morning or a night on the screen, because `remaining()` returns
 * an integer and the card prints the clause verbatim beside it.
 *
 * This list exists because refusing them was quietly killing the feature. Every medicine on
 * `fixtures/sheets/hk_en.expected.json` prints one of these — "daily", "BD with meals", "nocte" —
 * so two of the three cards showed no counter at all, and the check-in had nothing to count.
 */
const ONCE_A_DAY = [
  /\bdaily\b/i,
  /\b(?:a|per|each|every)\s*day\b/i,
  /\b(?:nocte|mane|omni\s+(?:nocte|mane))\b/i,
  /\bevery\s+(?:morning|evening|night)\b/i,
  /\b(?:at\s+night|at\s+bedtime|before\s+bed|in\s+the\s+morning)\b/i,
  /每[日天]/,
  /每[朝晚早]/,
];

/**
 * Clauses that carry a number, or a day, but do NOT state a daily schedule. Any of these vetoes
 * the whole function: it returns "could not tell" and the card shows the printed clause with no
 * number beside it.
 *
 * The veto is global, not just a guard on the fallback below, because of the asymmetry it fixes.
 * 「一日最多四次」 already fell through (the count is not adjacent to 次, so `ZH_PER_DAY` misses it),
 * but "up to 4 times a day" matched `EN_DIGIT_PER_DAY` and came back as a confident **4** — the
 * same sheet, the same meaning, counted in English and refused in Chinese. A stated maximum is a
 * ceiling the patient stays under, not a schedule to count down, and turning it into "今日仲有 4 次"
 * would be the app telling someone to take three more doses than the page asked for.
 *
 * Ranges, alternate days, weekly schedules and hourly intervals are here for the same reason: all
 * are perfectly legible to a person, and none is a number this app is allowed to put on screen.
 */
const NOT_A_DAILY_COUNT = [
  /最多|至多|不超過|不超过|以內|以内/,
  /\b(?:up\s+to|max(?:imum)?|no\s+more\s+than)\b/i,
  /[0-9一二兩两三四五六七八九十]\s*(?:至|到|~|-|–)\s*[0-9一二兩两三四五六七八九十]\s*次/,
  /\bevery\s+other\s+day\b/i,
  /\balternate\s+days?\b/i,
  /隔[日天]/,
  /\bweekly\b/i,
  /每\s*[0-9一二三四五六八十]*\s*(?:星期|禮拜|礼拜|週|周)/,
  /\bhourly\b/i,
  /\bq\s*[0-9]{1,2}\s*h\b/i,
  /每\s*[0-9一二三四五六八十]+\s*(?:小時|小时|hours?)/i,
];

/**
 * NFKC folds full-width digits and Latin letters to half-width (「每日２次」 → "每日2次"), and
 * whitespace collapses so a line break inside a clause cannot hide the count from the pattern.
 */
function normalise(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** A recognised count, or null when it is out of the range a sheet plausibly prints. */
function inRange(value: number): number | null {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PER_DAY ? value : null;
}

/**
 * Collects every count one pattern finds, translated through `lookup`.
 *
 * Returns whether the pattern matched at all — which is NOT the same as whether it contributed a
 * count. 「每日十次」 matches, yields 10, and `inRange` throws it away as more than a sheet
 * plausibly prints; the set stays empty. The caller needs to know a numbered clause was
 * nonetheless present, because the once-a-day fallback must not then look at the same string,
 * see 每日, and call ten times a day "once".
 */
function collect(
  text: string,
  pattern: RegExp,
  lookup: (token: string) => number | undefined,
  into: Set<number>,
): boolean {
  let matched = false;
  // Every pattern carries `g`, so `matchAll` is safe and `lastIndex` never leaks between calls.
  for (const match of text.matchAll(pattern)) {
    matched = true;
    const token = (match[1] ?? "").toLowerCase();
    const value = lookup(token);
    if (value === undefined) continue;
    const bounded = inRange(value);
    if (bounded !== null) into.add(bounded);
  }
  return matched;
}

/**
 * Reads a printed frequency clause.
 *
 * Recognised, and nothing else: 每日/每天/一日 N 次 in digits or Chinese numerals; "N times a
 * day" / "N times daily" / "N x daily"; "once/twice/three times daily"; OD, BD, TDS, QID (and the
 * BID/TID/QDS spellings of the same three). As-needed: 痛先食, 需要時, 必要時, PRN, "as required",
 * "when necessary", "as needed".
 *
 * Everything else — 每朝一次, 每四小時一次, 每星期兩次, 隔日一次, "1 tablet daily", a date, a
 * duration, a bare strength — returns `{ total: 0, asNeeded: false }`. Some of those are perfectly
 * readable to a human, and that is the point: this function decides whether the app is allowed to
 * put a *number* on the screen, and it only ever does that for the forms it recognises exactly.
 *
 * Two recognised forms that disagree ("每日一次 BD") also return "could not tell". A clause that
 * contradicts itself is one to read off the paper, not one to average.
 */
export function timesPerDay(frequency: string | null | undefined): TimesPerDay {
  if (typeof frequency !== "string") return UNKNOWN;
  const text = normalise(frequency);
  if (text.length === 0) return UNKNOWN;

  for (const marker of AS_NEEDED_MARKERS) {
    if (marker.test(text)) return AS_NEEDED;
  }

  // A ceiling, a range or a different cadence entirely. Checked before anything is counted, so a
  // number sitting inside one of them can never be mistaken for a schedule.
  if (NOT_A_DAILY_COUNT.some((veto) => veto.test(text))) return UNKNOWN;

  const totals = new Set<number>();
  // `||` deliberately not short-circuiting: every pattern must run so that two disagreeing forms
  // ("每日一次 TDS") both land in `totals` and cancel each other out below.
  let numbered = false;
  numbered =
    collect(text, ZH_PER_DAY, (t) => CN_NUMERALS[t] ?? (/^[0-9]+$/.test(t) ? Number(t) : undefined), totals) ||
    numbered;
  numbered =
    collect(text, EN_DIGIT_PER_DAY, (t) => (/^[0-9]+$/.test(t) ? Number(t) : undefined), totals) || numbered;
  numbered = collect(text, EN_ONCE_TWICE, (t) => EN_NUMERALS[t], totals) || numbered;
  numbered = collect(text, EN_WORD_TIMES, (t) => EN_NUMERALS[t], totals) || numbered;
  // Dots are dropped only for the abbreviation pass, so "b.d." reads as BD. The word boundaries
  // still apply afterwards, so nothing new can be manufactured out of an ordinary word.
  numbered =
    collect(text.replace(/\./g, ""), LATIN_ABBREVIATION, (t) => LATIN_ABBREVIATIONS[t], totals) || numbered;

  // Only when no numbered clause was PRESENT — not merely when none produced a usable count.
  // "twice daily" would otherwise collect both 2 and 1 and cancel itself into "could not tell",
  // and 「每日十次」, whose 10 is discarded as out of range, would come back as once a day.
  if (!numbered && ONCE_A_DAY.some((pattern) => pattern.test(text))) totals.add(1);

  if (totals.size !== 1) return UNKNOWN;
  const [total] = [...totals];
  return { total, asNeeded: false };
}

/** True for a string that actually carries printed content. Blank is treated as "not printed". */
function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Joins the printed parts that exist with a single space, verbatim, in the order given. */
function joinPrinted(parts: (string | null | undefined)[]): string {
  return parts
    .filter(present)
    .map((part) => part.trim())
    .join(" ");
}

/** One target per medicine on the sheet, in the order the page lists them. */
function targetOf(medicine: Medicine, index: number): DoseTarget {
  // A medicine the page has withdrawn is never counted and never scheduled, whatever its line
  // printed (tests/eval/stress.md, "The worst single miss"). It keeps its verbatim clause so the
  // card can still show what the page said about it — it just has no number and no button.
  const stopped = medicine.status !== "current";
  const parsed = stopped ? UNKNOWN : timesPerDay(medicine.frequency);
  return {
    key: `m${index}`,
    name: joinPrinted([medicine.name, medicine.strength]),
    generic: present(medicine.amount) ? medicine.amount.trim() : "",
    printed: present(medicine.frequency) ? medicine.frequency.trim() : "",
    total: parsed.total,
    asNeeded: parsed.asNeeded,
    stopped,
  };
}

/**
 * Every medicine on the sheet as a dose target, stopped ones included.
 *
 * Stopped medicines are kept in the list on purpose: the family needs to see that the page names
 * the drug and says it is finished. They carry `stopped: true`, `total: 0` and `asNeeded: false`,
 * so no counter and no 食咗 button can be built from one.
 */
export function doseTargets(reading: SheetReading | StoredReading): DoseTarget[] {
  return (reading.medicines ?? []).map(targetOf);
}

/**
 * The device's own calendar date, "YYYY-MM-DD". Local, never UTC: "today" for a family in Hong
 * Kong is the day their phone shows, and a UTC date would roll over at eight in the morning.
 *
 * An invalid Date yields "", which matches no stored day, so a broken clock reads as a fresh day
 * and shows the full count rather than silently hiding a dose.
 */
export function localDay(d: Date): string {
  const time = d.getTime();
  if (Number.isNaN(time)) return "";
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * How many times are left today for one target.
 *
 * A stopped or as-needed target is always 0 — there is no countdown to be had — and so is a
 * clause we could not read. A count recorded on another local day is ignored rather than carried
 * over: a new calendar day starts at nothing taken, which is why `DoseState` stores the day it
 * belongs to.
 */
export function remaining(
  target: DoseTarget,
  state: DoseState | undefined,
  today: Date,
): number {
  if (target.stopped || target.asNeeded || target.total <= 0) return 0;
  if (state === undefined || state.day !== localDay(today)) return target.total;
  const taken = Number.isFinite(state.taken) ? Math.max(0, Math.trunc(state.taken)) : 0;
  return Math.max(0, target.total - taken);
}
