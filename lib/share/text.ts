/**
 * The text a reader sends to their family: the cards of the current reading, in the reader's own
 * language, as plain lines a messaging app can carry.
 *
 * Pure. Every sentence in it is a card body that has already passed the banned-term filter (the
 * caller hands in `filterCards(buildCards(reading))`), plus fixed strings from `lib/i18n/ui.ts`
 * that the same filter checks in its own test. No name, no label, no date about the person: the
 * text says what the page says, and who read it out (constitution IV, V).
 */
import type { Card, CardType, Dialect } from "@/lib/domain/schemas";

export interface ShareStrings {
  title: string;
  warnings: string;
  medicines: string;
  followUp: string;
  other: string;
  footer: string;
  disclaimer: string;
}

const GROUPS: { label: keyof ShareStrings; types: readonly CardType[] }[] = [
  // Red flags first, always — the share text keeps the order the sheet is read in.
  { label: "warnings", types: ["warning", "noWarnings"] },
  { label: "medicines", types: ["medicine"] },
  { label: "followUp", types: ["followUp"] },
  { label: "other", types: ["diet", "activity", "unreadable"] },
];

export function buildShareText(
  cards: readonly Card[],
  dialect: Dialect,
  strings: ShareStrings,
  display: (text: string) => string = (text) => text,
): string {
  const sections = GROUPS.map((group) => {
    const lines = cards
      .filter((card) => group.types.includes(card.type))
      .map((card) => `• ${display(card.body[dialect])}`);
    return lines.length > 0 ? [strings[group.label], ...lines].join("\n") : null;
  }).filter((section): section is string => section !== null);

  return [strings.title, ...sections, strings.footer, strings.disclaimer].join("\n\n");
}
