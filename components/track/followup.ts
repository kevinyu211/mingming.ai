/**
 * The two things 明明 has to say on 跟進, built by rules from what is already on the screen.
 *
 * Neither reaches a model. The spoken line is the counters and the appointment in a sentence;
 * the recap is a count of what the reader did in the conversation. Both are pure so the unit
 * tests can pin them without a browser, and both take `t` rather than a locale so the copy lives
 * in one place (`lib/i18n/ui.ts`) with the rest.
 */
import { classifyReply } from "@/components/chat/turns";
import { fill } from "@/components/home/format";
import type { UiKey } from "@/lib/i18n/ui";
import type { BriefPhase, ThreadMessage } from "@/lib/sheets/types";

type T = (key: UiKey) => string;

export interface FollowUpLineInput {
  /** Doses still to take today across the countable medicines. */
  left: number;
  /** How many medicines are countable at all; zero means the sheet printed no daily counts. */
  countable: number;
  /** Whole days until the printed appointment, or null when no date could be read. */
  daysToVisit: number | null;
}

/**
 * 「今日仲有 2 次藥。3 日之後覆診。食咗就撳一下。」 — or the parts of it the page supports.
 *
 * Every clause is conditional on a fact the rules already established for the cards below it:
 * no countable medicine means no dose clause and no tap instruction; no parsed date means no
 * visit clause; a visit that is today or past says nothing about days. An empty result means
 * there is nothing for 明明 to say, and the caller shows nothing rather than a greeting for its
 * own sake.
 */
export function followUpLine(input: FollowUpLineInput, t: T): string {
  const parts: string[] = [];
  if (input.countable > 0) {
    parts.push(input.left > 0 ? fill(t("dose.left"), { n: input.left }) : t("dose.done"));
  }
  if (input.daysToVisit !== null && input.daysToVisit > 0) {
    parts.push(fill(t("track.visitIn"), { n: input.daysToVisit }));
  }
  if (input.countable > 0 && input.left > 0) {
    parts.push(t("track.tapWhenTaken"));
  }
  // Each clause ends with the locale's full stop; Chinese sentences sit flush, English ones take a
  // space — decided from the stop itself rather than from a second key that would be blank.
  const stop = t("track.stop");
  const gap = stop === "." ? " " : "";
  return parts.map((part) => (/[。.!?！？]$/.test(part) ? part : `${part}${stop}`)).join(gap);
}

export interface Recap {
  /** Beats the briefing has committed to the thread. */
  sections: number;
  /** The briefing reached its closing line. */
  done: boolean;
  /** Replies that meant "understood, go on". */
  understood: number;
  /** Replies that asked for the section again. */
  repeated: number;
  /** Everything else the reader typed or said: questions of their own. */
  asked: number;
}

/**
 * What the reader did in the conversation, counted from the thread itself.
 *
 * Nothing is stored for this: every user line is re-read with the same `classifyReply` that
 * drove the conversation, so the recap cannot disagree with what actually happened. The check-in
 * answers (食咗 / 未食) are the reader's too, but they answer a different question, so the caller
 * passes them in to be left out.
 */
export function recap(
  thread: readonly ThreadMessage[],
  briefing: { phase: BriefPhase; step: number },
  exclude: readonly string[] = [],
): Recap {
  const out: Recap = { sections: briefing.step, done: briefing.phase === "end", understood: 0, repeated: 0, asked: 0 };
  const skip = new Set(exclude.map((s) => s.trim()));
  for (const message of thread) {
    if (message.role !== "user") continue;
    const text = message.text.trim();
    if (text.length === 0 || skip.has(text)) continue;
    const intent = classifyReply(text);
    if (intent === "continue") out.understood += 1;
    else if (intent === "repeat") out.repeated += 1;
    else out.asked += 1;
  }
  return out;
}

/** True when there is something worth recapping: the reader has answered at least once, or it ended. */
export function hasRecap(r: Recap): boolean {
  return r.done || r.understood + r.repeated + r.asked > 0;
}
