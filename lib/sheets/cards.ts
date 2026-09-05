/**
 * The card set belonging to one stored reading.
 *
 * Cards returned by the read pipeline are the authoritative copy for a sheet: rebuilding them
 * from `StoredReading` loses repaired wording and the `unverified` marker. This module validates
 * that copy before it is persisted, and supplies a conservative, client-safe fallback for sheets
 * written before `validatedCards` existed (or for malformed local data).
 */
import { CardSchema, type Card, type StoredReading } from "@/lib/domain/schemas";
import { checkCard, checkSpeakableAgainstQuotes } from "@/lib/rules/banned-terms";
import { buildCards } from "@/lib/rules/card-order";
import { templateFor, type TemplateFacts } from "@/lib/rules/template-fallback";

/** A fixed last resort when even a checked template cannot be spoken safely. */
const SEE_THE_SHEET = {
  yue: "呢一行請直接睇返張紙，或者打張紙上面嘅電話問。",
  cmn: "这一行请直接看纸，或者打纸上面的电话问。",
  en: "Have a look at this line on the sheet itself, or ring the number printed on it and ask.",
} as const;

/** Thrown when a caller tries to attach cards that do not belong to the supplied reading. */
export class InvalidReadingCardsError extends Error {
  constructor() {
    super("Refusing to persist cards that do not match the current sheet reading.");
    this.name = "InvalidReadingCardsError";
  }
}

function sameSource(left: Card["source"], right: Card["source"]): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.section === right.section &&
    left.lineIndex === right.lineIndex &&
    left.quote === right.quote
  );
}

function sameFacts(left: Card["facts"], right: Card["facts"]): boolean {
  const leftKeys = left === undefined ? [] : Object.keys(left).sort();
  const rightKeys = right === undefined ? [] : Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, i) => key !== rightKeys[i])) {
    return false;
  }
  return leftKeys.every((key) => left?.[key] === right?.[key]);
}

/** Internal card identity: an id alone is not enough to prevent a cross-reading substitution. */
function sameReadingAssociation(card: Card, expected: Card): boolean {
  return (
    card.id === expected.id &&
    card.type === expected.type &&
    sameSource(card.source, expected.source) &&
    sameFacts(card.facts, expected.facts) &&
    Boolean(card.stopped) === Boolean(expected.stopped)
  );
}

/**
 * Folded only for the medicine source check. This does not rewrite a quote or a displayed value.
 */
function fold(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * Checks the part of a card's traceability that can be proven without seeing the photograph.
 * Medicine names and strengths must occur in their own source quote; other card kinds have no
 * typed fields whose association can be checked here.
 */
export function verifiedCardAgainstQuote(card: Card): boolean {
  if (card.type !== "medicine") return true;
  const quote = fold(card.source?.quote ?? "");
  if (quote.length === 0) return false;
  return (["name", "strength"] as const).every((key) => {
    const value = card.facts?.[key];
    return typeof value !== "string" || value.trim().length === 0 || quote.includes(fold(value));
  });
}

function copyCard(card: Card): Card {
  return {
    ...card,
    body: { ...card.body },
    source: card.source === null ? null : { ...card.source },
    ...(card.facts === undefined ? {} : { facts: { ...card.facts } }),
  };
}

/**
 * Validates a candidate card array against the current reading. `null` means it must not be
 * treated as authoritative. The check requires the schema, exact full card set, deterministic
 * id/type order, source and typed facts association, and a filtered body.
 */
export function validateReadingCards(reading: StoredReading, cards: Card[]): Card[] | null {
  if (!Array.isArray(cards)) return null;

  const parsed: Card[] = [];
  const ids = new Set<string>();
  for (const candidate of cards) {
    const result = CardSchema.safeParse(candidate);
    if (!result.success || ids.has(result.data.id) || !checkCard(result.data).ok) return null;
    ids.add(result.data.id);
    parsed.push(result.data);
  }

  const expected = buildCards(reading);
  if (
    parsed.length !== expected.length ||
    parsed.some(
      (card, index) =>
        card.id !== expected[index]?.id ||
        card.type !== expected[index]?.type ||
        !sameReadingAssociation(card, expected[index] as Card),
    )
  ) {
    return null;
  }

  // The reading itself may contain an internally inconsistent medicine (the extractor can return
  // it, but the pipeline marks it). Never let a caller omit that marker and thereby promote the
  // card to verified evidence while preserving the rest of the canonical card untouched.
  return parsed.map((card) =>
    copyCard(verifiedCardAgainstQuote(card) ? card : { ...card, unverified: true }),
  );
}

function checkedTemplate(card: Card): Card {
  const template = templateFor(card.type, (card.facts ?? {}) as TemplateFacts);
  const body = checkSpeakableAgainstQuotes(template, [card.source?.quote]).ok
    ? template
    : SEE_THE_SHEET;
  return { ...card, body, aiGenerated: false };
}

/** Preserve an explicit warning marker when malformed legacy card data still identifies this card. */
function hadUnverifiedMarker(legacy: unknown, expected: Card): boolean {
  if (!Array.isArray(legacy)) return false;
  return legacy.some((candidate) => {
    const parsed = CardSchema.safeParse(candidate);
    return parsed.success && parsed.data.unverified === true && sameReadingAssociation(parsed.data, expected);
  });
}

/**
 * Rebuilds cards for legacy sheets. Every medicine gets the internal source check, and every body
 * that fails the banned-term gate is replaced with a checked fixed template. A malformed stored
 * card can carry `unverified` forward only when its source/facts still match this reading.
 */
export function legacySheetCards(reading: StoredReading, legacyCards?: unknown): Card[] {
  return buildCards(reading).map((built) => {
    let card: Card = verifiedCardAgainstQuote(built) ? built : { ...built, unverified: true };
    if (!checkCard(card).ok) card = checkedTemplate(card);
    if (hadUnverifiedMarker(legacyCards, built)) card = { ...card, unverified: true };
    return copyCard(card);
  });
}

/**
 * Returns canonical cards when they validate, otherwise a safe legacy reconstruction. This is the
 * selector used by client consumers after reload; it never promotes malformed local data to
 * verified evidence.
 */
export function getValidatedOrLegacyCards(sheet: {
  reading: StoredReading;
  validatedCards?: Card[];
}): Card[] {
  const validated =
    sheet.validatedCards === undefined
      ? null
      : validateReadingCards(sheet.reading, sheet.validatedCards);
  return validated ?? legacySheetCards(sheet.reading, sheet.validatedCards);
}
