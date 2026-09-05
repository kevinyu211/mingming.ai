/**
 * Pure facts the home conversation row needs: whether 明明 is waiting, and which line to show.
 *
 * No clock, no i18n table — callers pass `today` and a `t`-like so the same answers can be
 * asserted without rendering the row.
 */
import { fill } from "@/components/home/format";
import { doseTargets, remaining, type DoseTarget } from "@/lib/rules/doses";
import type { Sheet } from "@/lib/sheets";

/** How many glyphs the conversation preview keeps. Slice, not a summary. */
export const HOME_PREVIEW_GLYPHS = 40;

/** The medicines a counter is allowed to exist for: current, countable, and printed as a schedule. */
export function countableTargets(sheet: Sheet): DoseTarget[] {
  return doseTargets(sheet.reading).filter(
    (target) => !target.stopped && !target.asNeeded && target.total > 0,
  );
}

/** How many doses the page still expects today, across every countable medicine on this sheet. */
export function remainingToday(sheet: Sheet, today: Date): number {
  return countableTargets(sheet).reduce(
    (total, target) => total + remaining(target, sheet.doses[target.key], today),
    0,
  );
}

/**
 * 明明 has something unread: a pending check-in, or a briefing that has not finished
 * (including idle and partway).
 */
export function homeUnread(sheet: Sheet): boolean {
  return sheet.checkin === "pending" || sheet.briefing.phase !== "end";
}

type PreviewKey = "checkin.question" | "home.chatNotStarted";

/**
 * The line under 明明's name. Pending check-in with a countable medicine keeps the fixed
 * question; otherwise the last thread line, sliced, or `home.chatNotStarted`.
 */
export function homePreview(sheet: Sheet, t: (key: PreviewKey) => string): string {
  if (sheet.checkin === "pending") {
    const [first] = countableTargets(sheet);
    if (first) {
      return fill(t("checkin.question"), { name: first.name, printed: first.printed });
    }
  }

  const last = lastThreadText(sheet);
  if (last === null) return t("home.chatNotStarted");
  return last.length <= HOME_PREVIEW_GLYPHS ? last : last.slice(0, HOME_PREVIEW_GLYPHS);
}

function lastThreadText(sheet: Sheet): string | null {
  for (let i = sheet.thread.length - 1; i >= 0; i--) {
    const message = sheet.thread[i];
    if (!message || (message.role !== "agent" && message.role !== "user")) continue;
    const text = message.text.trim();
    if (text.length > 0) return text;
  }
  return null;
}
