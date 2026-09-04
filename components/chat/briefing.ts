/**
 * The rules behind the conversation on `/chat` — everything that can be decided without React,
 * a clock or a network (v2 build brief §6, constitution II and III).
 *
 * The briefing is a **sequence, not a conversation**. Its order comes from `buildCards`, which
 * puts the red flags first by construction, and nothing here can reorder it: a model turn cannot
 * reach this file, and the phase machine below only ever moves forward through the array it is
 * handed. That is principle II implemented as a data structure rather than as a prompt.
 *
 * Pure: no imports from React, no `Date.now()`, no storage. `app/chat/page.tsx` is the only
 * caller, and `tests/unit/chat-briefing.test.ts` covers every function here.
 */
import type { Card, Dialect, StoredReading } from "@/lib/domain/schemas";
import { doseTargets, type DoseTarget } from "@/lib/rules/doses";
import { CAUTION_SUFFIX } from "@/lib/rules/template-fallback";
import type { BriefPhase } from "@/lib/sheets/types";

/**
 * Where one clause ends. Taken from the design canvas's own `chunks()`: these are the marks a
 * Cantonese sentence actually breathes at, so revealing one group per beat lands the pauses where
 * a person would put them rather than at an arbitrary character count.
 */
export const CLAUSE_MARKS = "，。、？！：";

/**
 * A clause shorter than this is glued to the next one. Without it 「好，我幫你記低咗。」 flashes a
 * two-character bubble first, which reads as a glitch rather than as speech.
 */
export const MIN_CLAUSE = 3;

/** One clause per beat, from the canvas. Slow enough to read at seventy, fast enough to not stall. */
export const CLAUSE_MS = 360;

/** The pause after the last clause, before the message commits and the next step begins. */
export const COMMIT_MS = 700;

/**
 * Splits spoken text into the clauses it is revealed in.
 *
 * Never drops or reorders a character: `chunks(t).join("") === t` for every input, which is what
 * makes this safe to run over a sentence that has already passed the banned-term filter — the
 * text on screen is the text that was checked.
 */
export function chunks(text: string): string[] {
  const out: string[] = [];
  let buffer = "";
  for (const character of text) {
    buffer += character;
    if (CLAUSE_MARKS.includes(character) && buffer.length >= MIN_CLAUSE) {
      out.push(buffer);
      buffer = "";
    }
  }
  if (buffer.length > 0) out.push(buffer);
  return out;
}

/**
 * Fills `{name}`-style slots in a fixed template from `lib/i18n/ui.ts`.
 *
 * A plain string replace, deliberately: every value that lands in a slot is either a count this
 * app derived by rule or a clause quoted verbatim off the page. No model turn assembles one of
 * these sentences (brief §6, the check-in).
 */
export function fill(template: string, values: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

/**
 * The briefing, split into the amber block and the pieces that follow it.
 *
 * `warnings` is the `warning` cards, or the single `noWarnings` card that takes the same slot when
 * the page printed none — that slot is never empty (constitution II). `pieces` is everything else
 * in `CARD_ORDER` sequence, one card per 明白 press.
 */
export interface BriefingCards {
  warnings: Card[];
  pieces: Card[];
  /** True when the warning slot is the "this page printed none" card rather than red flags. */
  empty: boolean;
}

export function splitCards(cards: Card[]): BriefingCards {
  const warnings = cards.filter((c) => c.type === "warning" || c.type === "noWarnings");
  const pieces = cards.filter((c) => c.type !== "warning" && c.type !== "noWarnings");
  return { warnings, pieces, empty: warnings.every((c) => c.type === "noWarnings") };
}

/**
 * The one line the amber block reads aloud: every warning on the page, in order, joined.
 *
 * Joined rather than spoken card by card because the block is one visual unit and four separate
 * utterances would put four "AI wrote this" pauses inside a single red-flag list. The card bodies
 * are already filtered and already carry their own end punctuation.
 */
export function warningSpeech(warnings: Card[], dialect: Dialect): string {
  return warnings
    .map((card) => card.body[dialect].trim())
    .filter((line) => line.length > 0)
    .join(dialect === "en" ? " " : "");
}

/**
 * What one piece says out loud.
 *
 * A card whose typed fields disagree with its own quoted line (`unverified`) is spoken with the
 * caution sentence attached, because that card is the one to check against the paper — the UI
 * emphasises its source link at the same time (brief §6).
 */
export function pieceSpeech(card: Card, dialect: Dialect): string {
  const body = card.body[dialect].trim();
  return card.unverified === true ? `${body} ${CAUTION_SUFFIX[dialect]}` : body;
}

/**
 * Where the 睇「跟進」 button goes: under the LAST medicine piece, or nowhere.
 *
 * The brief hangs the link off "medicines", and a sheet routinely lists three. One button after
 * the last of them is one offer to go and look; one button under each is the same offer repeated
 * three times in a thread that is already long.
 */
export function trackLinkIndex(pieces: Card[]): number {
  let index = -1;
  pieces.forEach((card, i) => {
    if (card.type === "medicine") index = i;
  });
  return index;
}

/**
 * What happens after one piece has been spoken: another 明唔明？, or the end of the briefing.
 *
 * `step` counts pieces already spoken, so it is also the index of the next one. It is stored on
 * the sheet, which is what lets a briefing abandoned halfway resume at the same place.
 */
export function phaseAfterPiece(step: number, total: number): BriefPhase {
  return step >= total ? "end" : "ask";
}

/**
 * Every dose the app is allowed to put a number on: the page printed a frequency it recognises,
 * and the page has not withdrawn the drug.
 *
 * 每朝一次 is deliberately NOT countable — `timesPerDay` does not recognise it — so a sheet can
 * carry three medicines and offer only one counter. That is the correct, quieter behaviour: a
 * counter the app cannot justify from the printed clause is a number it invented.
 */
export function countableTargets(reading: StoredReading): DoseTarget[] {
  return doseTargets(reading).filter((t) => !t.stopped && !t.asNeeded && t.total > 0);
}

/** The medicine the daily check-in asks about: the first one the page gave a countable clause. */
export function checkinTarget(reading: StoredReading): DoseTarget | null {
  return countableTargets(reading)[0] ?? null;
}

/** Whether this sheet has anything to check in about at all (brief §6, the check-in). */
export function hasCountableDose(reading: StoredReading): boolean {
  return countableTargets(reading).length > 0;
}
