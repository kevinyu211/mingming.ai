/**
 * The memory brief: what the model is told about earlier sessions, and nothing more.
 *
 * This is the one place memory touches the network, so it is written as a filter rather than a
 * formatter. It reads only from `Memory` — a shape that has no relationship label, no name and no
 * identifier in it (see lib/memory/types.ts) — and it emits plain text, capped at
 * `MAX_BRIEF_CHARS`, oldest entries dropped first.
 *
 * Three properties the tests hold it to:
 *
 * 1. **Nothing about the person.** No label, no name, no age, no location, no plan, no confirmed
 *    follow-up date. The only dates are the days sheets were read, which the reading itself
 *    already carries in `readAt` and which `/api/ask` already receives today.
 * 2. **Nothing invented.** Every line is a verbatim field off a sheet or a sentence the model
 *    itself wrote during that read. The brief never characterises the person, never names a
 *    condition, and never turns "asked twice about the white tablet" into a conclusion.
 * 3. **Bounded.** 1200 characters, whatever the store holds. A brief that could grow with use
 *    would quietly turn every question into a bigger request.
 *
 * A crisis question is never in here, because it is never recorded (lib/memory/types.ts), and a
 * refused medicine-change question keeps its outcome but loses its text: that question was
 * deliberately answered without a model call, and a later brief must not be the back door that
 * finally sends it.
 *
 * The two generated fields — the recap and the warning signs, which are the model's own wording
 * from an earlier read — are put through the banned-term filter again on the way out, and a line
 * that fails is dropped rather than repaired. They passed the filter when they were written, so
 * this normally changes nothing; it earns its keep for an entry stored by an older build whose
 * filter did not yet cover all three spoken forms. The verbatim fields (medicines, follow-up, the
 * diet line) are NOT filtered: they are page text, and a sheet that prints a word on the list must
 * still reach the model intact (principle IV, and `checkCard`'s own note about `source.quote`).
 */
import { checkText } from "@/lib/rules/banned-terms";
import type { Memory, RememberedExchange, RememberedReading } from "@/lib/memory/types";

/** The ceiling. Roughly one screen of text; small next to the cards the same request carries. */
export const MAX_BRIEF_CHARS = 1200;

const HEADER =
  "BACKGROUND — earlier use of this app on this phone. Context only, never a source of facts.";

const SHEETS_HEADING = "SHEETS ALREADY READ";
const QUESTIONS_HEADING = "QUESTIONS ALREADY ASKED";

const SHEET_NAMES: Record<string, string> = {
  hk_en: "Hong Kong English sheet",
  cn_zh: "Chinese discharge sheet",
  unknown: "unrecognised sheet",
};

const OUTCOME_NAMES: Record<RememberedExchange["outcome"], string> = {
  answered: "answered from the sheet",
  not_on_sheet: "the sheet did not say",
  refused_medicine_change: "declined, pointed to the pharmacist",
};

/** Date only: the day is the continuity cue, the clock time is not. */
function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "date unknown" : date.toISOString().slice(0, 10);
}

/**
 * True when a generated line still passes the banned-term filter. Applied only to the model's own
 * wording; verbatim page text goes through untouched.
 */
function clean(text: string): boolean {
  return checkText(text).ok;
}

function readingLines(entry: RememberedReading): string[] {
  const lines = [`- ${day(entry.readAt)} · ${SHEET_NAMES[entry.sheetType] ?? "sheet"}`];
  if (entry.medicines.length > 0) lines.push(`  medicines: ${entry.medicines.join("; ")}`);
  if (entry.followUp.length > 0) lines.push(`  follow-up: ${entry.followUp.join("; ")}`);
  if (entry.dietLine) lines.push(`  diet: ${entry.dietLine}`);
  const warningSigns = entry.warningSigns.filter(clean);
  if (warningSigns.length > 0) lines.push(`  warning signs: ${warningSigns.join("; ")}`);
  if (entry.recap && clean(entry.recap)) lines.push(`  recap: ${entry.recap}`);
  return lines;
}

/**
 * One line per question. A declined medicine-change question is named but not quoted — see the
 * module note; its text stayed on the phone and stays there.
 */
function exchangeLine(entry: RememberedExchange): string {
  const outcome = OUTCOME_NAMES[entry.outcome];
  const cited = entry.outcome === "answered" && entry.citedCardId ? ` (${entry.citedCardId})` : "";
  if (entry.outcome === "refused_medicine_change") {
    return `- ${day(entry.askedAt)} · asked about changing a medicine · ${outcome}`;
  }
  return `- ${day(entry.askedAt)} · ${entry.question} · ${outcome}${cited}`;
}

function render(readings: RememberedReading[], exchanges: RememberedExchange[]): string {
  const lines: string[] = [HEADER];
  if (readings.length > 0) {
    lines.push(SHEETS_HEADING);
    for (const entry of readings) lines.push(...readingLines(entry));
  }
  if (exchanges.length > 0) {
    lines.push(QUESTIONS_HEADING);
    for (const entry of exchanges) lines.push(exchangeLine(entry));
  }
  return lines.join("\n");
}

/**
 * The compact brief for one request, or "" when there is nothing to say — an empty string is the
 * signal to the caller to send no `memory` field at all, so a first-ever question is byte-for-byte
 * the request it was before memory existed.
 *
 * Over the cap, entries are dropped oldest first across both lists, except that the most recent
 * sheet is never dropped: it is the one piece of continuity worth the characters. If a single
 * sheet still overruns on its own, the text is cut at the cap.
 */
export function buildMemoryBrief(memory: Memory | null | undefined): string {
  if (!memory) return "";
  const readings = [...memory.readings];
  const exchanges = [...memory.exchanges];
  if (readings.length === 0 && exchanges.length === 0) return "";

  let text = render(readings, exchanges);
  while (text.length > MAX_BRIEF_CHARS) {
    const dropExchange =
      exchanges.length > 0 && (readings.length <= 1 || exchanges[0].askedAt <= readings[0].readAt);
    if (dropExchange) exchanges.shift();
    else if (readings.length > 1) readings.shift();
    else break;
    text = render(readings, exchanges);
  }

  // A plain cut, not `clamp`: the brief's newlines are what keeps it readable to the model.
  return text.length > MAX_BRIEF_CHARS
    ? `${text.slice(0, MAX_BRIEF_CHARS - 1).trimEnd()}…`
    : text;
}
