/**
 * The confirmed plan as an iCalendar file (RFC 5545), for design.md S8's 加入日曆.
 *
 * ## Why the medicine rows are one all-day note and not a set of alarms
 *
 * A discharge sheet prints *frequencies* — "daily", "BD with meals", "nocte", 每日一次 — and a
 * frequency is not a time. Turning "nocte" into a 21:00 reminder would be the app deciding when
 * a dose is taken, which FR-020 forbids outright ("MUST NOT alter doses") and which principle I
 * of the constitution rules out on its own: this product states facts about the page, it does
 * not issue instructions about the person. So there is no VALARM anywhere in this file and no
 * clock time is ever invented.
 *
 * What the calendar gets instead is two all-day entries, both of which a person reads and acts
 * on themselves:
 *
 *   1. the follow-up appointment, on `plan.followUpDate` — the one date the rules could parse
 *      from a source line, and nothing when they could not;
 *   2. every medicine-time row as a single "藥" note on the day the sheet was read, with each
 *      medicine's printed frequency listed verbatim in DESCRIPTION.
 *
 * ## Why no relationship label
 *
 * `titlePrefix` is a fixed word from the interface (出院紙), never `Profile.label`. An .ics file
 * gets shared, mailed and synced to accounts the app knows nothing about, so the relationship
 * word stays on the phone where it was promised to stay (constitution principle V).
 *
 * Everything here is a pure string function: no DOM, no `Blob`, no download. The page owns that.
 */
import type { FollowUpPlan, PlanItem } from "@/lib/storage/local";

export interface IcsOptions {
  /** Prefixed to every SUMMARY so a calendar entry says where it came from. Never a profile label. */
  titlePrefix?: string;
  /** "YYYY-MM-DD", the day the sheet was read. The medicine note sits here; without it, no note. */
  startDate?: string;
  /** SUMMARY word for the follow-up entry, from the interface locale. */
  appointmentTitle?: string;
  /** SUMMARY word for the medicine-times entry, from the interface locale. */
  medicineTitle?: string;
  /** One extra line at the end of every DESCRIPTION (the caution sentence, typically). */
  note?: string;
  /** Fixed clock, so the same plan produces byte-identical output. Defaults to now. */
  now?: Date;
}

/** Product identifier. `-//…//NONSGML…//EN` is the RFC 5545 shape for a non-registered product. */
const PRODID = "-//tengdakming//discharge-sheet-agent//EN";

/** UID domain. Deterministic UIDs mean a re-download updates the entry instead of duplicating it. */
const UID_DOMAIN = "tengdakming.local";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "2026-09-16" → "20260916". Returns null for anything that is not an ISO calendar date. */
export function compactDate(date: string | null | undefined): string | null {
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  if (Number.isNaN(stamp)) return null;
  const parsed = new Date(stamp);
  // Rejects 2026-02-31 and friends: the round trip only survives a real calendar date.
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${year}${pad(month)}${pad(day)}`;
}

/** The day after `date`, compact. All-day VEVENTs are half-open, so DTEND is the next morning. */
function nextCompactDate(date: string): string | null {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  if (Number.isNaN(next.getTime())) return null;
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

/** UTC timestamp in the DATE-TIME form DTSTAMP requires. */
function stamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

/** RFC 5545 section 3.3.11: backslash, semicolon and comma are escaped; newlines become \\n. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 section 3.1: content lines are folded at 75 **octets**, continuations begin with one
 * space. Counting octets rather than characters is the whole reason this exists — a line of
 * Chinese is three bytes per character and would otherwise sail past the limit.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;

  for (const character of line) {
    const size = encoder.encode(character).length;
    // A character is never split across a fold; that is what would corrupt the text.
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      // Continuation lines spend one octet on their leading space.
      limit = 74;
    }
    current += character;
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out.join("\r\n ");
}

function property(name: string, value: string): string {
  return foldLine(`${name}:${escapeText(value)}`);
}

/** One row as a DESCRIPTION line: the printed words, then the line they were printed on. */
function describe(item: PlanItem): string[] {
  const head = [item.label, item.when].filter((part) => part.trim().length > 0).join(" — ");
  const quote = item.source.quote.trim();
  return quote.length > 0 ? [head, `「${quote}」`] : [head];
}

interface EventInput {
  uid: string;
  date: string;
  summary: string;
  description: string[];
  now: Date;
}

function event({ uid, date, summary, description, now }: EventInput): string[] {
  const end = nextCompactDate(date);
  const start = compactDate(date);
  if (!start || !end) return [];
  return [
    "BEGIN:VEVENT",
    property("UID", `${uid}@${UID_DOMAIN}`),
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    property("SUMMARY", summary),
    property("DESCRIPTION", description.join("\n")),
    // Informational, not a commitment: it must not make the day look busy.
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

function title(prefix: string | undefined, word: string): string {
  const clean = (prefix ?? "").trim();
  return clean.length > 0 ? `${clean}：${word}` : word;
}

/** True when this plan has anything a calendar could hold, so the button can hide when it does not. */
export function hasCalendarEvents(plan: FollowUpPlan, options: IcsOptions = {}): boolean {
  if (compactDate(plan.followUpDate) !== null) return true;
  return (
    compactDate(options.startDate) !== null &&
    plan.items.some((item) => item.kind === "medicineTime")
  );
}

/**
 * The plan as one VCALENDAR string, CRLF-delimited and ready to be handed to a Blob.
 *
 * Returns a valid, empty calendar when the sheet printed neither a parseable follow-up date nor
 * a medicine frequency — an honest empty file beats an invented one.
 */
export function buildIcs(plan: FollowUpPlan, options: IcsOptions = {}): string {
  const now = options.now ?? new Date();
  const appointmentWord = options.appointmentTitle ?? "覆診";
  const medicineWord = options.medicineTitle ?? "藥";
  const note = options.note?.trim();

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  const followUpDate = compactDate(plan.followUpDate);
  if (followUpDate && plan.followUpDate) {
    const appointments = plan.items.filter((item) => item.kind === "appointment");
    const description = appointments.flatMap(describe);
    if (note) description.push(note);
    lines.push(
      ...event({
        uid: `followup-${followUpDate}`,
        date: plan.followUpDate,
        summary: title(options.titlePrefix, appointmentWord),
        description,
        now,
      }),
    );
  }

  const medicines = plan.items.filter((item) => item.kind === "medicineTime");
  const startDate = compactDate(options.startDate);
  if (medicines.length > 0 && startDate && options.startDate) {
    const description = medicines.flatMap(describe);
    if (note) description.push(note);
    lines.push(
      ...event({
        uid: `medicines-${startDate}`,
        date: options.startDate,
        summary: title(options.titlePrefix, medicineWord),
        description,
        now,
      }),
    );
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 section 3.1: every content line ends CRLF, including the last.
  return `${lines.join("\r\n")}\r\n`;
}
