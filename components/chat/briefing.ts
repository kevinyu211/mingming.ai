/**
 * The rules behind the conversation on `/chat` — everything that can be decided without React,
 * a clock or a network (v2 build brief §6, constitution II and III).
 *
 * The briefing is a **script, not a negotiation**. Its order comes from `buildCards`, which puts
 * the red flags first by construction, and `buildBeats` below walks that order and nothing else:
 * a model turn cannot reach this file, and the driver in `app/chat/page.tsx` only ever moves
 * forward through the array it is handed. That is principle II implemented as a data structure
 * rather than as a prompt.
 *
 * Pure: no imports from React, no `Date.now()`, no storage. `app/chat/page.tsx` is the only
 * caller, and `tests/unit/chat-briefing.test.ts` covers every function here.
 */
import type { Card, CardType, Dialect, SourceReference, StoredReading } from "@/lib/domain/schemas";
import type { UiKey } from "@/lib/i18n/ui";
import { doseTargets, type DoseTarget } from "@/lib/rules/doses";
import { CAUTION_SUFFIX } from "@/lib/rules/template-fallback";

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
 * The beat between one committed message and 明仔 starting the next one, spent showing the three
 * dots. It is what makes the briefing read as somebody talking rather than as a list unrolling —
 * and it is the window in which the reader can cut in, because a hold on the bar during this pause
 * takes the floor before anything else has been said.
 */
export const BETWEEN_MS = 950;

/** The longer pause after a warning-sign bubble. A red flag is given a moment to land. */
export const AFTER_WARN_MS = 1500;

/** The wait between the thread painting and the first dots. About two seconds, as asked. */
export const OPENING_MS = 900;

/** Between the lines inside one bubble. A newline, so a bubble reads as a short list. */
const JOIN = "\n";

/**
 * Between what a bubble says and the question it ends with.
 *
 * A blank line, because the question is a different act from the content: it is where 明仔 hands
 * the floor over, and running it on from the last medicine makes it look like part of the dose.
 */
const ASK_GAP = "\n\n";

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
 * in `CARD_ORDER` sequence, one card per beat.
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

/* -------------------------------------------------------------------------- */
/*  The script                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One thing 明仔 says, in the order he says it.
 *
 * The briefing used to be a phase machine that stopped at 明唔明？ after every card and waited for
 * a button. It is a **script** now: a flat array of beats that plays itself out, with the reader
 * free to cut in at any point by holding the bar. Two things did not change, because they are the
 * constitution rather than the interaction design:
 *
 *   - the warning-sign beats come first, ahead of every other card, by construction here — no
 *     model output and no reader action can reorder them (principle II);
 *   - every beat carrying a fact off the page carries that line's `source` with it, so each bubble
 *     still opens the printed line it stands on (principle IV).
 *
 * `lead` is the app's own connective («跟住講藥。»), always from `lib/i18n/ui.ts` and never from a
 * model turn; `text` is the card body, which is where the AI label attaches.
 */
export interface Beat {
  /** Stable within one reading, so a re-render cannot shuffle the script under the driver. */
  key: string;
  /** The quiet connective above the body, or null. App copy, never generated. */
  lead: string | null;
  /** The body. Model-written when `origin` is "model". */
  text: string;
  origin: "rule" | "model";
  tone: "warn" | null;
  /**
   * Every printed line this bubble was built from, in order.
   *
   * Plural because a bubble is a SECTION now, not a card. Four warning signs used to arrive as
   * four separate amber boxes and three medicines as three white ones, which is what Kevin saw on
   * his phone and called "the AI shooting out a lot of text" — a wall of small boxes rather than
   * somebody talking. They are one message each now, and one message has to be able to cite all
   * the lines underneath it or constitution IV quietly becomes "the first line of each section".
   */
  sources: SourceReference[];
  link: "track" | null;
  stopped: boolean;
  unverified: boolean;
  /**
   * After this beat, STOP and wait for the reader. The beat's own text is the question.
   *
   * This is the difference between a conversation and a monologue with pauses in it. The briefing
   * used to play every beat to the end whatever the reader did, which meant the only way to be
   * heard was to interrupt — and a reader in their seventies does not interrupt, they sit there.
   * Now the script hands the floor over at the end of every section and does not take it back
   * until something comes in.
   */
  awaits: boolean;
  /**
   * Which run of the script this beat belongs to, so "say that again" can replay the whole
   * section rather than the single bubble the reader happened to stop on.
   */
  section: string;
}

/** The connective that introduces each kind of card. `warning` has its own longer lead-in. */
const LEAD_KEY: Partial<Record<CardType, UiKey>> = {
  medicine: "lead.medicine",
  followUp: "lead.followUp",
  diet: "lead.diet",
  activity: "lead.activity",
  unreadable: "lead.unreadable",
};

/** What `buildBeats` needs from the page: the dictionary, and the reader's script conversion. */
export interface BeatContext {
  dialect: Dialect;
  /** `t` bound to the interface locale. */
  t: (key: UiKey) => string;
  /** Converts app copy and card bodies into the reader's script. Quotes are never converted. */
  display: (text: string) => string;
  /**
   * What the greeting calls the thing it has read — the plain word 出院紙 / 出院纸 / discharge
   * sheet, not the sheet's filed title.
   *
   * `sheetTitle()` derives that title from the first clinic the page printed, which is right for
   * a header and wrong in a sentence: on the bundled Hong Kong fixture it is "SOPD", and 「你張
   * SOPD我已經睇咗喇」 is not something a person would say. The header still carries the specific
   * title; the greeting says what the document is.
   */
  sheetWord: string;
}

/**
 * The whole briefing, start to finish.
 *
 * Two greeting beats, then the warning lead-in and one bubble per warning sign, then the
 * teach-back question, then one bubble per remaining card with its connective, then the closing
 * line. A connective is printed only on the FIRST card of a run — three medicines get one
 * 「跟住講藥。」 between them, not three, because a connective repeated on every line stops being
 * speech and becomes a column heading.
 */
export function buildBeats(cards: Card[], ctx: BeatContext): Beat[] {
  const { warnings, pieces, empty } = splitCards(cards);
  const { t, display, dialect } = ctx;
  const beats: Beat[] = [];

  const rule = (key: string, text: string, section: string, awaits = false): Beat => ({
    key,
    lead: null,
    text: display(text),
    origin: "rule",
    tone: null,
    sources: [],
    link: null,
    stopped: false,
    unverified: false,
    awaits,
    section,
  });

  /**
   * The opening: what is on the page, in numbers, and an offer of where to start.
   *
   * A reader who has just been handed a medical document does not know what is in it, and 明仔
   * launching straight into red flags gives them no idea how long this is going to take or what is
   * coming. One sentence of shape first — four things to watch for, five medicines, one visit —
   * and then the floor, because someone who came to the app worried about one specific thing
   * should be able to say so instead of sitting through the rest to reach it.
   */
  const medicines = pieces.filter((card) => card.type === "medicine");
  const counts: string[] = [];
  if (warnings.length > 0 && !empty) {
    counts.push(fill(t("count.warnings"), { n: warnings.length }));
  }
  if (medicines.length > 0) counts.push(fill(t("count.medicines"), { n: medicines.length }));
  const visits = pieces.filter((card) => card.type === "followUp").length;
  if (visits > 0) counts.push(fill(t("count.followUp"), { n: visits }));

  beats.push(
    rule(
      "summary",
      counts.length > 0
        ? fill(t("brief.summary"), { sheet: ctx.sheetWord, parts: counts.join(t("count.join")) })
        : fill(t("brief.summaryBare"), { sheet: ctx.sheetWord }),
      "opening",
      // Only worth asking where to start when there is more than one place to start.
      counts.length > 1,
    ),
  );

  /**
   * The red flags, as ONE bubble with the question inside it.
   *
   * Grouped rather than one-per-turn on purpose, and this is the one place the grouping is not
   * just about tidiness: these are the lines that say "stop and go back to hospital". Splitting
   * them across four turns would make the most urgent thing on the page the slowest to get
   * through, and a reader who answers 明白 twice and then puts the phone down would have been
   * shown half of them.
   */
  if (warnings.length > 0) {
    const body = warnings.map((card) => display(pieceSpeech(card, dialect))).join(JOIN);
    const lead = empty ? "" : `${display(t("brief.warnLead"))}${JOIN}`;
    beats.push({
      key: "warn",
      lead: null,
      text: `${lead}${body}${ASK_GAP}${display(t("ask.warn"))}`,
      origin: warnings.some((card) => card.aiGenerated) ? "model" : "rule",
      tone: empty ? null : "warn",
      sources: warnings
        .map((card) => card.source)
        .filter((source): source is SourceReference => source !== null),
      link: null,
      stopped: false,
      unverified: warnings.some((card) => card.unverified === true),
      // Nothing to hold the floor for if the page had nothing else on it.
      awaits: pieces.length > 0,
      section: "warn",
    });
  }

  /**
   * The rest of the page. Medicines get a turn EACH; everything else is one turn per kind.
   *
   * A medicine is a discrete thing to remember — a name, a strength, a printed instruction — and
   * five of them in one bubble is the wall of text this rebuild exists to remove. Follow-up, diet
   * and activity are one idea each, so they stay whole.
   */
  const trackAt = trackLinkIndex(pieces);
  let previousType: CardType | null = null;
  let medicineNumber = 0;

  pieces.forEach((card, i) => {
    const isMedicine = card.type === "medicine";
    const isNewRun = card.type !== previousType;
    previousType = card.type;

    let lead: string | null = null;
    if (isMedicine) {
      medicineNumber += 1;
      lead = display(
        fill(t("lead.medicineNth"), { n: medicineNumber, total: medicines.length }),
      );
    } else if (isNewRun) {
      const key = LEAD_KEY[card.type];
      lead = key ? display(t(key)) : null;
    }

    const last = i === pieces.length - 1;
    const askKey = isMedicine && !last ? "ask.medicine" : "ask.section";
    // The last piece asks nothing: the closing line follows it and does the asking.
    const ask = last ? "" : `${ASK_GAP}${display(t(askKey))}`;

    beats.push({
      key: `piece-${i}`,
      lead,
      text: `${display(pieceSpeech(card, dialect))}${ask}`,
      origin: card.aiGenerated ? "model" : "rule",
      tone: null,
      sources: card.source ? [card.source] : [],
      link: i === trackAt ? "track" : null,
      stopped: card.stopped === true,
      unverified: card.unverified === true,
      awaits: !last,
      section: isMedicine ? `medicine-${medicineNumber}` : `piece-${card.type}`,
    });
  });

  beats.push(rule("end", t("brief.end"), "end"));
  return beats;
}

/**
 * What a beat says out loud: the connective and the body, as one utterance.
 *
 * Joined with a space only when the connective ends in Latin punctuation. A space after 「跟住講藥。」
 * is a gap a Chinese voice reads as a pause in the wrong place, and it shows on screen as a hole.
 */
export function beatSpeech(beat: Beat): string {
  if (!beat.lead) return beat.text;
  const gap = /[。！？、，；：]$/.test(beat.lead) ? "" : " ";
  return `${beat.lead}${gap}${beat.text}`;
}

/** How long to wait after `beat` before starting the next one. */
export function pauseAfter(beat: Beat): number {
  return beat.tone === "warn" ? AFTER_WARN_MS : BETWEEN_MS;
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
