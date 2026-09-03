/**
 * The shape of on-device memory (constitution principle V).
 *
 * Memory is what makes the agent continuous: reopen the app tomorrow and it still knows which
 * sheets have been read, what is printed on them, and what has already been asked. It buys that
 * with storage, not with a server — every field below lives inside the single `fitornot.v1`
 * localStorage key, so `deleteEverything()` is still one `removeItem` and still provably complete.
 *
 * What is deliberately NOT in this file is as important as what is:
 *
 * - No relationship label, no name, no age, no location, no identifier of any kind. The brief
 *   built from this memory is sent to the model, so a field that does not exist here cannot leak
 *   there. That is the guarantee — structural, not a promise to be careful.
 * - No image, ever (FR-018). `assertNoImageData` in lib/storage/local.ts guards every write, and
 *   nothing here has a key it would catch.
 * - No plan, no confirmed follow-up date, no consent timestamp. Those stay where they are.
 * - No verdict, no diagnosis, no interpretation (principle I). Every remembered field is either
 *   copied verbatim off the page or is a sentence the model already wrote during the read and
 *   which already passed the banned-term filter.
 *
 * Both lists are capped and drop oldest first, so a phone that reads a sheet every week never
 * grows a store it cannot bound.
 */
import type { SheetType } from "@/lib/domain/schemas";

/** Most recent sheets kept. A sixth read evicts the first. */
export const MAX_READINGS = 5;

/** Most recent exchanges kept. A fifty-first question evicts the first. */
export const MAX_EXCHANGES = 50;

/** Per-reading list caps, so one sheet with forty medicine lines cannot dominate the store. */
export const MAX_FIELD_ITEMS = 6;
export const MAX_FIELD_CHARS = 80;

/** The recap is one or two sentences, not a summary of the sheet. */
export const MAX_RECAP_CHARS = 140;

/** A question is kept for continuity, not transcription; long ones are clipped. */
export const MAX_STORED_QUESTION_CHARS = 200;

/**
 * Outcomes worth remembering. `crisis_referral` is absent on purpose: a crisis question never
 * leaves the phone (FR-014), and storing it would put it back on the wire inside a later brief.
 * The two failure outcomes (`bad_request`, `model_unavailable`) are absent because nothing
 * happened — there is no exchange to be continuous about.
 */
export const REMEMBERED_OUTCOMES = ["answered", "refused_medicine_change", "not_on_sheet"] as const;

export type ExchangeOutcome = (typeof REMEMBERED_OUTCOMES)[number];

export function isRememberedOutcome(value: string): value is ExchangeOutcome {
  return (REMEMBERED_OUTCOMES as readonly string[]).includes(value);
}

/**
 * One sheet this phone has read. The four field lists are the same diagnoses-free fields the
 * cards already show, reduced to plain strings; `recap` is model-written text lifted out of the
 * reading itself, so remembering costs no extra model call and invents no new clinical language.
 */
export interface RememberedReading {
  /** Stable within this store. Derived from `readAt`, never from anything about the person. */
  id: string;
  /** ISO timestamp the client set when the reading was stored. */
  readAt: string;
  sheetType: SheetType;
  /** Verbatim medicine lines: name, strength, amount, frequency, duration as printed. */
  medicines: string[];
  /** Verbatim follow-up lines: clinic, when, tests as printed. */
  followUp: string[];
  /** The diet line exactly as printed, or null when the sheet printed none. */
  dietLine: string | null;
  /** The symptoms the sheet says mean "go back now", as the model phrased them. */
  warningSigns: string[];
  /** One or two sentences the model already wrote for this reading. */
  recap: string;
}

/** One question already asked on this phone, and what came of it. */
export interface RememberedExchange {
  /** ISO timestamp. */
  askedAt: string;
  /** As typed or transcribed, clipped. Never logged, never sent except inside the brief. */
  question: string;
  outcome: ExchangeOutcome;
  /** The card the answer was grounded in, or null. */
  citedCardId: string | null;
}

/** Both lists are oldest-first, so eviction is a shift and the brief reads in order. */
export interface Memory {
  readings: RememberedReading[];
  exchanges: RememberedExchange[];
}

export function emptyMemory(): Memory {
  return { readings: [], exchanges: [] };
}
