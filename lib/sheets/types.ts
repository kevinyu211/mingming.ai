/**
 * The shape of one sheet and everything the app remembers about it (v2 build brief §5).
 *
 * The load-bearing rule this file encodes is **one active sheet at a time**. Every counter, every
 * thread message and every follow-up line belongs to exactly one piece of paper, so a sentence
 * like 「張紙寫：每日兩次」 can only ever be quoting the sheet the reader is looking at. A global
 * list of medicines across sheets would make that sentence a lie the moment a second sheet was
 * photographed, which is why `doses` hangs off the `Sheet` and not off the store.
 *
 * Types only — no values, no clock, no storage. `lib/sheets/store.ts` is the only writer.
 */
import type { AnswerOutcome } from "@/lib/client/ask-stream";
import type { SourceReference, StoredReading } from "@/lib/domain/schemas";
import type { DraftPlan } from "@/lib/rules/plan-from-reading";

/**
 * Where the opening briefing has got to.
 *
 * It is a rule-driven sequence, not a conversation. `briefing.step` counts the beats already
 * committed to the thread, so it is also the index of the next one; the phase says what is
 * happening at that index: `idle` before anything, `speaking` while a beat is typing itself out,
 * `ask` in the pause between beats, `end` once the last one has been said.
 *
 * `intro` and `warn` are kept only so a sheet stored by an earlier build still parses. Nothing
 * writes them any more — the greeting and the warning signs are ordinary beats now, and the
 * warning beats come first by construction (constitution II).
 */
/**
 * Where the briefing is.
 *
 * `waiting` is the one that makes it a conversation: the script has said a section, asked, and
 * handed the floor over. It does not take the floor back on a timer — only a reply moves it on.
 * The stored `step` alongside it is the beat to resume FROM, so closing the app mid-conversation
 * and coming back lands on the same question rather than replaying the section.
 */
export type BriefPhase =
  | "idle"
  | "intro"
  | "warn"
  | "ask"
  | "speaking"
  | "waiting"
  | "end";

/**
 * The daily medicine check-in. `none` until the briefing has finished and the sheet actually has
 * something countable; `pending` while the in-app message sits unread on 記錄; `open` once the
 * reader has tapped into it; `done` once they have answered either way.
 *
 * There are no push notifications. `pending` is a block on a screen, and nothing in the product
 * may imply the phone will go off by itself.
 */
export type CheckinState = "none" | "pending" | "open" | "done";

/** One line in the 傾偈 thread. The briefing and the answers share one conversation. */
export interface ThreadMessage {
  id: string;
  role: "agent" | "user";
  /** Already in the sheet's dialect and script; already through the banned-term filter. */
  text: string;
  /** ISO timestamp, set by the store when the message is appended. */
  at: string;
  /**
   * Who wrote it. `rule` is a fixed template (the intro, the check-in question, a refusal),
   * `model` is phrased text that must carry the AI label, `user` is what the reader said or typed.
   * The UI decides whether to show the caution suffix from this field, so a rule line is never
   * labelled as AI and a model line is never shown without it.
   */
  origin: "rule" | "model" | "user";
  /** Opens the source sheet, so every spoken fact traces to a line (constitution IV). */
  /**
   * Every printed line this message was built from. Plural because a bubble is a SECTION now.
   */
  sources?: SourceReference[];
  /** Renders the 睇「跟進」 button under the message. */
  link?: "track" | null;
  /** Styles a refusal, a not-on-sheet answer or a crisis referral as itself, not as an answer. */
  outcome?: AnswerOutcome | null;
  /**
   * A short connective the app wrote — 「跟住講藥。」 — shown as a quiet line above the body inside
   * the same bubble, and spoken in front of it.
   *
   * It is always app copy from `lib/i18n/ui.ts`, never a model turn, which is why it can share a
   * bubble with a model-written body without muddling the AI label: the label sits under the body
   * it describes, and the lead is visibly chrome (13 px, muted) rather than part of the sentence.
   */
  lead?: string | null;
  /**
   * `warn` paints the bubble amber. It is set only for the warning-sign beats, which the briefing
   * puts first by construction — the tone follows the position, it does not create it.
   */
  tone?: "warn" | null;
  /** The page says this medicine has been stopped: spoken as ended, never as a dose that is due. */
  stopped?: boolean;
  /** The card and its own quote disagree — the reader is told to check this line on the paper. */
  unverified?: boolean;
}

/**
 * How many times one medicine has been taken today, and which local day "today" was when the
 * count was last touched. The day is stored rather than inferred so that a phone left overnight
 * shows a fresh counter the next morning without the store having to run a timer: the reset is a
 * comparison at read time, not an event.
 */
export interface DoseState {
  /** `m${index}` — the medicine's index in `reading.medicines`. */
  key: string;
  taken: number;
  /** Local calendar date "YYYY-MM-DD" this count belongs to. */
  day: string;
}

/**
 * One photographed sheet and the whole of the conversation about it.
 *
 * `archivedAt` is what makes a sheet read-only (只可以睇). The previous sheet is not deleted when
 * a new one is photographed — the family may still want to see what the last one said — but its
 * counters are frozen at the moment it was archived, because a counter that kept moving would be
 * counting against a page nobody is holding any more.
 */
export interface Sheet {
  id: string;
  capturedAt: string;
  /** How many pages this sheet was photographed from. 0 when it is not known (see the migration). */
  pageCount: number;
  /** Derived by rule from the reading, never by a model turn — see `lib/sheets/title.ts`. */
  title: string;
  reading: StoredReading;
  plan: DraftPlan;
  thread: ThreadMessage[];
  /** Keyed by `DoseTarget.key`. A medicine with no entry has been taken zero times today. */
  doses: Record<string, DoseState>;
  briefing: { phase: BriefPhase; step: number };
  checkin: CheckinState;
  /** ISO timestamp once this sheet stopped being the active one; null while it is active. */
  archivedAt: string | null;
}

/** What the store hands out: the one active sheet, and the read-only history behind it. */
export interface SheetsState {
  active: Sheet | null;
  archive: Sheet[];
}
