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
  warnings: string;
  medicines: string;
  visit: string;
  /** 「張紙寫：{text}」 */
  printed: string;
  missingFrequency: string;
  /** 「仲有 {n} 樣，睇返張紙」 */
  more: string;
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

  const targets = doseTargets(input.reading).filter((target) => !target.stopped);
  const medicines: ShareCardMedicine[] = targets.slice(0, MAX_MEDICINES).map((target) => ({
    name: target.name,
    printed: target.printed
      ? fill(strings.printed, { text: target.printed })
      : strings.missingFrequency,
  }));
  const medicinesOver = targets.length - medicines.length;

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
    warningsTitle: strings.warnings,
    warnings,
    warningsMore: warningsOver > 0 ? fill(strings.more, { n: warningsOver }) : null,
    medicinesTitle: strings.medicines,
    medicines,
    medicinesMore: medicinesOver > 0 ? fill(strings.more, { n: medicinesOver }) : null,
    visitTitle: strings.visit,
    visit,
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
