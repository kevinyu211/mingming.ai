/**
 * The three things the shell has to put on screen that are neither a fixed string nor a verbatim
 * quote: a sheet's date, a message's time, and how many days until a visit.
 *
 * Pure, and no clock inside: `today` is always passed in, exactly as `lib/rules/doses.ts` does it,
 * so the countdown is testable without touching the system time.
 *
 * **These are not counters.** A counter counts remaining doses and may never show a clock time
 * (brief §2 rule 7). `formatTime` is here for one thing only — the timestamp on 明仔's in-app
 * message, the way any chat app stamps a message — and it must never be attached to a medicine.
 */
import type { UiLocale } from "@/lib/i18n/ui";

/**
 * The BCP-47 tag each interface locale formats dates in. `en-GB` rather than `en-US` because Hong
 * Kong writes "24 September", not "September 24".
 */
const TAG: Record<UiLocale, string> = {
  hant: "zh-HK",
  hans: "zh-CN",
  en: "en-GB",
};

const DAY_MS = 86_400_000;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A real Date from an ISO timestamp, or null. Never throws on a half-written stored value. */
function parse(iso: string | null | undefined): Date | null {
  if (typeof iso !== "string" || iso.trim().length === 0) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** 「9月1日」 / "1 September". "" when there is no usable timestamp — the caller omits the line. */
export function formatMonthDay(iso: string | null | undefined, locale: UiLocale): string {
  const at = parse(iso);
  if (!at) return "";
  return new Intl.DateTimeFormat(TAG[locale], { month: "long", day: "numeric" }).format(at);
}

/** 「9月24日」 from a plain "YYYY-MM-DD", read as a LOCAL calendar date rather than as UTC. */
export function formatYmd(ymd: string | null | undefined, locale: UiLocale): string {
  if (typeof ymd !== "string" || !YMD.test(ymd)) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(TAG[locale], { month: "long", day: "numeric" }).format(
    new Date(y, m - 1, d),
  );
}

/**
 * 「上午 9:00」 / "09:00" — the timestamp on one in-app message, and nothing else.
 *
 * There are no push notifications in this product, so this is never "when the phone will go off".
 * It is when 明仔 last said something, which is a fact about the thread.
 */
export function formatTime(iso: string | null | undefined, locale: UiLocale): string {
  const at = parse(iso);
  if (!at) return "";
  return new Intl.DateTimeFormat(TAG[locale], { hour: "numeric", minute: "2-digit" }).format(at);
}

/**
 * Whole days from `today` to a "YYYY-MM-DD" date, both read as local calendar days. Negative once
 * the day is past, 0 on the day itself, null when the string is not a date.
 *
 * `Date.UTC` is a day counter here, not a timezone: both ends are built from local Y-M-D parts, so
 * the difference is a count of calendar days and never shifts by one across a DST boundary.
 */
export function daysUntil(ymd: string | null | undefined, today: Date): number | null {
  if (typeof ymd !== "string" || !YMD.test(ymd)) return null;
  if (Number.isNaN(today.getTime())) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / DAY_MS);
}

/** Fills the `{n}`, `{name}`, `{printed}`, `{text}` and `{date}` slots in a fixed UI string. */
export function fill(template: string, values: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}
