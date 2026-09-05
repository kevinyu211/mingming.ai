/**
 * The discharge card a reader sends to their family (Companion D, the artboard's 出院卡), as data.
 *
 * Pure: a reading in, lines out. Every sentence on the card is one of three things — a card body
 * that has already been through the banned-term filter (the caller hands in the filtered cards),
 * a verbatim line off the page (medicine names and their printed frequency), or a fixed string
 * from `lib/i18n/ui.ts`. No name, no relationship label, no age, no diagnosis: the card says what
 * the page says and who read it out (constitution I, IV, V).
 *
 * `lib/share/png.ts` draws this; `components/share/ShareCard.tsx` shows and shares it.
 */
import type { Card, Dialect, StoredReading } from "@/lib/domain/schemas";
import { doseTargets } from "@/lib/rules/doses";
import type { DraftPlan } from "@/lib/rules/plan-from-reading";

/** The most lines a phone-sized card carries per section before it says 「仲有 N 樣，睇返張紙」. */
export const MAX_WARNINGS = 4;
export const MAX_MEDICINES = 5;

export interface ShareCardStrings {
  eyebrow: string;
  summaryTitle: string;
  /** 「呢張紙有{parts}。」 */
  summary: string;
  /** 「下次覆診 {date}。」 */
  summaryVisit: string;
  /** 「{n}樣要留意嘅情況」 / 「{n}隻藥」 / 「{n}次覆診」 and the joiner between them. */
  countWarnings: string;
  countMedicines: string;
  countFollowUp: string;
  countJoin: string;
  warnings: string;
  medicines: string;
  visit: string;
  /** 「張紙寫：{text}」 */
  printed: string;
  missingFrequency: string;
  /** 「仲有 {n} 樣，睇返張紙」 */
  more: string;
  notes: string;
  /** 「張紙寫唔使再食：{name}」 */
  stoppedLine: string;
  /** 「醫院電話：{text}」 */
  contactLine: string;
  aiLine: string;
  footer: string;
  disclaimer: string;
}

export interface ShareCardMedicine {
  /** Verbatim name plus strength, exactly as printed. */
  name: string;
  /** 「張紙寫：<clause>」 or the fixed "no frequency printed" line. Never a clock time. */
  printed: string;
}

export interface ShareCardData {
  eyebrow: string;
  /** The sheet's filed title (`lib/sheets/title.ts`): a clinic the page printed, or 出院紙. */
  title: string;
  /** 「9月5日」, the day the sheet was read. */
  meta: string;
  summaryTitle: string;
  /**
   * What is on the page, in numbers, and the one date the rules could read. Built from counts
   * and fixed templates only — the artboard's 「treated for a chest infection」 is a diagnosis and
   * never appears (constitution I). Null when there is nothing to count.
   */
  summary: string | null;
  warningsTitle: string;
  warnings: string[];
  /** 「仲有 N 樣，睇返張紙」 when the page had more warning signs than the card shows. */
  warningsMore: string | null;
  medicinesTitle: string;
  medicines: ShareCardMedicine[];
  medicinesMore: string | null;
  visitTitle: string;
  /** The parsed date in words, else the printed follow-up line, else null (section omitted). */
  visit: string | null;
  notesTitle: string;
  /**
   * The specific things the page says beyond the lists: the diet line, the activity line, medicines
   * the page has stopped, parts that could not be read, the hospital's own contact line. Each is a
   * filtered card body or a verbatim line; the section is omitted when there are none.
   */
  notes: string[];
  aiLine: string;
  footer: string;
  disclaimer: string;
}

export interface ShareCardInput {
  reading: StoredReading;
  plan: DraftPlan;
  /** Already filtered: `filterCards(buildCards(reading))`. */
  cards: readonly Card[];
  dialect: Dialect;
  title: string;
  /** The formatted read date, "" when unknown. */
  dateLabel: string;
  /** The parsed follow-up date in words, "" when the rules could not read one. */
  visitDate: string;
  strings: ShareCardStrings;
  /** Script conversion for app copy and card bodies. Never applied to a verbatim quote. */
  display?: (text: string) => string;
}

function fill(template: string, values: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.split(`{${key}}`).join(String(value));
  return out;
}

export function buildShareCard(input: ShareCardInput): ShareCardData {
  const display = input.display ?? ((text: string) => text);
  const { strings } = input;

  const warningBodies = input.cards
    .filter((card) => card.type === "warning")
    .map((card) => display(card.body[input.dialect].trim()))
    .filter((line) => line.length > 0);
  const warnings = warningBodies.slice(0, MAX_WARNINGS);
  const warningsOver = warningBodies.length - warnings.length;

  const allTargets = doseTargets(input.reading);
  const targets = allTargets.filter((target) => !target.stopped);
  const medicines: ShareCardMedicine[] = targets.slice(0, MAX_MEDICINES).map((target) => {
    // The printed duration rides on the printed clause, verbatim: 「BD with meals · 7 days」.
    const source = input.reading.medicines.find((m, index) => `m${index}` === target.key);
    const duration = source?.duration?.trim() ?? "";
    const clause = [target.printed, duration].filter((part) => part.length > 0).join(" · ");
    return {
      name: target.name,
      printed: clause ? fill(strings.printed, { text: clause }) : strings.missingFrequency,
    };
  });
  const medicinesOver = targets.length - medicines.length;

  // The summary: counts and the one date, nothing the page did not print.
  const parts: string[] = [];
  if (warningBodies.length > 0) parts.push(fill(strings.countWarnings, { n: warningBodies.length }));
  if (targets.length > 0) parts.push(fill(strings.countMedicines, { n: targets.length }));
  const visits = input.plan.items.filter((item) => item.kind === "appointment").length;
  if (visits > 0) parts.push(fill(strings.countFollowUp, { n: visits }));
  let summary: string | null = parts.length > 0 ? fill(strings.summary, { parts: parts.join(strings.countJoin) }) : null;
  if (summary && input.visitDate) summary = `${summary} ${fill(strings.summaryVisit, { date: input.visitDate })}`;

  // The things to note, in the order the sheet is read: diet, activity, stopped medicines,
  // unreadable parts, then the hospital's own line.
  const notes: string[] = [];
  for (const type of ["diet", "activity"] as const) {
    for (const card of input.cards.filter((c) => c.type === type)) {
      const body = display(card.body[input.dialect].trim());
      if (body.length > 0) notes.push(body);
    }
  }
  for (const target of allTargets.filter((t) => t.stopped)) {
    notes.push(fill(strings.stoppedLine, { name: target.name }));
  }
  for (const card of input.cards.filter((c) => c.type === "unreadable")) {
    const body = display(card.body[input.dialect].trim());
    if (body.length > 0) notes.push(body);
  }
  const contact = input.reading.hospitalContact?.text?.trim() ?? "";
  if (contact.length > 0) notes.push(fill(strings.contactLine, { text: contact }));

  const appointment = input.plan.items.find((item) => item.kind === "appointment") ?? null;
  let visit: string | null = null;
  if (appointment) {
    const label = appointment.label.trim();
    const when = input.visitDate || (appointment.when.trim().length > 0 ? fill(strings.printed, { text: appointment.when.trim() }) : "");
    visit = [label, when].filter((part) => part.length > 0).join(" · ") || null;
  }

  return {
    eyebrow: strings.eyebrow,
    title: input.title,
    meta: input.dateLabel,
    summaryTitle: strings.summaryTitle,
    summary,
    warningsTitle: strings.warnings,
    warnings,
    warningsMore: warningsOver > 0 ? fill(strings.more, { n: warningsOver }) : null,
    medicinesTitle: strings.medicines,
    medicines,
    medicinesMore: medicinesOver > 0 ? fill(strings.more, { n: medicinesOver }) : null,
    visitTitle: strings.visit,
    visit,
    notesTitle: strings.notes,
    notes,
    aiLine: strings.aiLine,
    footer: strings.footer,
    disclaimer: strings.disclaimer,
  };
}

/**
 * Whether a typed or spoken line is asking for the card rather than asking about the page.
 *
 * A rule, not a model turn: 「發畀我個女」 never needs a network round trip to be understood, and
 * answering it with 「張紙冇講呢樣」 is the failure this exists to prevent. Deliberately narrow —
 * a verb of sending or sharing, in any of the three languages — so an ordinary question that
 * happens to mention family still goes to the model.
 */
const SHARE_MARKERS: readonly RegExp[] = [
  /分享/,
  /[發发傳传][畀俾給给]/,
  /出院卡/,
  /\bshare\b/i,
  /\bsend\b[^.?!]*\bto\b/i,
  /\bforward\b/i,
];

export function detectShareIntent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  return SHARE_MARKERS.some((marker) => marker.test(trimmed));
}
