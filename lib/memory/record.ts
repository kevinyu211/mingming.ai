/**
 * Turning a reading or an answer into something worth remembering (pure; no storage, no I/O).
 *
 * Everything here is a copy or a clip. Nothing is generated: the recap is assembled out of
 * sentences the model already wrote during the read — which have already been through the
 * banned-term filter in `lib/server/reading-pipeline.ts` — so remembering a sheet costs no model
 * call, makes no network request, and cannot introduce a word the filter never saw
 * (constitution principles I, III and VI).
 *
 * `lib/memory/store.ts` wraps these with the localStorage read/write; the functions here take a
 * `Memory` and return a new one, which is what makes the caps testable.
 */
import type { Dialect, StoredReading } from "@/lib/domain/schemas";
import {
  MAX_EXCHANGES,
  MAX_FIELD_CHARS,
  MAX_FIELD_ITEMS,
  MAX_READINGS,
  MAX_RECAP_CHARS,
  MAX_STORED_QUESTION_CHARS,
  emptyMemory,
  isRememberedOutcome,
  type ExchangeOutcome,
  type Memory,
  type RememberedExchange,
  type RememberedReading,
} from "@/lib/memory/types";

/** Collapses whitespace and clips to `max`, marking the clip so nothing reads as complete. */
export function clamp(text: string, max: number): string {
  const tidy = text.replace(/\s+/g, " ").trim();
  return tidy.length <= max ? tidy : `${tidy.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Joins the printed pieces of one line, dropping the fields the sheet did not print. */
function line(parts: (string | null)[]): string {
  return clamp(parts.filter((part): part is string => !!part && part.trim() !== "").join(" "), MAX_FIELD_CHARS);
}

function take(values: string[]): string[] {
  return values.filter((value) => value !== "").slice(0, MAX_FIELD_ITEMS);
}

/**
 * One or two sentences of the model's own wording for this sheet, in the dialect the parent
 * hears. Warning first (principle II), then the first medicine, then the first follow-up; a sheet
 * with none of those falls back to whatever line it does have. Never a summary of the whole page.
 */
export function recapOf(reading: StoredReading, dialect: Dialect): string {
  const parts: string[] = [];
  const warning = reading.warningSigns[0];
  if (warning) parts.push(warning.action[dialect]);
  const medicine = reading.medicines[0];
  if (medicine) parts.push(medicine.spoken[dialect]);
  const followUp = reading.followUp[0];
  if (followUp) parts.push(followUp.spoken[dialect]);
  if (parts.length === 0 && reading.dietLine) parts.push(reading.dietLine.spoken[dialect]);
  if (parts.length === 0 && reading.activityLine) parts.push(reading.activityLine.spoken[dialect]);
  return clamp(parts.join(" "), MAX_RECAP_CHARS);
}

/**
 * Reduces a stored reading to the handful of fields memory keeps. Note what is dropped: the
 * source references, the unreadable regions, the hospital contact, and every `spoken` string
 * except the ones the recap borrows. The current sheet is still on the phone in full — memory is
 * for the sheets that came before.
 */
export function summariseReading(
  reading: StoredReading,
  dialect: Dialect,
  id?: string,
): RememberedReading {
  return {
    id: id ?? `sheet-${reading.readAt}`,
    readAt: reading.readAt,
    sheetType: reading.sheetType,
    medicines: take(
      reading.medicines.map((medicine) =>
        line([medicine.name, medicine.strength, medicine.amount, medicine.frequency, medicine.duration]),
      ),
    ),
    followUp: take(reading.followUp.map((item) => line([item.clinic, item.when, item.tests]))),
    dietLine: reading.dietLine ? clamp(reading.dietLine.raw, MAX_FIELD_CHARS) : null,
    warningSigns: take(
      reading.warningSigns.map((sign) => clamp(sign.symptom[dialect], MAX_FIELD_CHARS)),
    ),
    recap: recapOf(reading, dialect),
  };
}

/** Keeps the ids unique when two sheets are read inside the same millisecond. */
function uniqueId(base: string, taken: readonly RememberedReading[]): string {
  if (!taken.some((entry) => entry.id === base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}#${suffix}`;
    if (!taken.some((entry) => entry.id === candidate)) return candidate;
  }
}

/**
 * Appends a reading and evicts the oldest once the cap is passed. Re-reading the same sheet
 * (same `readAt`) replaces its entry rather than adding a second copy, so returning to `/read`
 * from `/ask` — which re-saves the stored reading — cannot fill the store with duplicates.
 */
export function appendReading(memory: Memory, entry: RememberedReading): Memory {
  const withoutSame = memory.readings.filter((existing) => existing.readAt !== entry.readAt);
  const id = uniqueId(entry.id, withoutSame);
  const readings = [...withoutSame, { ...entry, id }].slice(-MAX_READINGS);
  return { readings, exchanges: memory.exchanges };
}

export interface ExchangeInput {
  question: string;
  outcome: ExchangeOutcome;
  citedCardId?: string | null;
  /** Defaults to now. Injected by the tests. */
  askedAt?: string;
}

export function appendExchange(memory: Memory, input: ExchangeInput): Memory {
  const entry: RememberedExchange = {
    askedAt: input.askedAt ?? new Date().toISOString(),
    question: clamp(input.question, MAX_STORED_QUESTION_CHARS),
    outcome: input.outcome,
    citedCardId: input.citedCardId ?? null,
  };
  return {
    readings: memory.readings,
    exchanges: [...memory.exchanges, entry].slice(-MAX_EXCHANGES),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_FIELD_ITEMS)
    : [];
}

function readingFrom(value: unknown): RememberedReading | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<RememberedReading>;
  if (typeof entry.readAt !== "string") return null;
  return {
    id: typeof entry.id === "string" ? entry.id : `sheet-${entry.readAt}`,
    readAt: entry.readAt,
    sheetType: entry.sheetType ?? "unknown",
    medicines: strings(entry.medicines),
    followUp: strings(entry.followUp),
    dietLine: typeof entry.dietLine === "string" ? entry.dietLine : null,
    warningSigns: strings(entry.warningSigns),
    recap: typeof entry.recap === "string" ? entry.recap : "",
  };
}

function exchangeFrom(value: unknown): RememberedExchange | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<RememberedExchange>;
  if (typeof entry.askedAt !== "string" || typeof entry.question !== "string") return null;
  if (typeof entry.outcome !== "string" || !isRememberedOutcome(entry.outcome)) return null;
  return {
    askedAt: entry.askedAt,
    question: entry.question,
    outcome: entry.outcome,
    citedCardId: typeof entry.citedCardId === "string" ? entry.citedCardId : null,
  };
}

/**
 * Repairs whatever was in storage into a `Memory`. A hand-edited key, a store written by an older
 * build, or a half-written object all resolve to something usable rather than throwing on read —
 * the ask screen must never be the place a corrupt store surfaces. Anything unrecognisable is
 * dropped rather than trusted, including an outcome this build does not remember.
 */
export function normaliseMemory(value: unknown): Memory {
  if (!value || typeof value !== "object") return emptyMemory();
  const { readings, exchanges } = value as Partial<Memory>;
  return {
    readings: (Array.isArray(readings) ? readings : [])
      .map(readingFrom)
      .filter((entry): entry is RememberedReading => entry !== null)
      .slice(-MAX_READINGS),
    exchanges: (Array.isArray(exchanges) ? exchanges : [])
      .map(exchangeFrom)
      .filter((entry): entry is RememberedExchange => entry !== null)
      .slice(-MAX_EXCHANGES),
  };
}
