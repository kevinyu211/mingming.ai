"use client";

/**
 * The block under the two buttons on 記錄: either 明仔's check-in waiting to be read, or the quiet
 * line it collapses into once it has been answered (brief §7).
 *
 * **This is an IN-APP message.** There are no push notifications in this product and nothing here
 * may imply the phone will go off by itself: no bell, no "reminder", no "we'll tell you at 9".
 * What it looks like — a name, a time, an unread dot — is what a message that is already sitting
 * in the app looks like when you open it, which is exactly what this is. The timestamp is when
 * 明仔 last said something in the thread, read back off the thread, never a time we scheduled.
 *
 * The question itself is assembled from the FIXED template `checkin.question` with the medicine's
 * name and the page's own frequency clause dropped in verbatim (brief §6). A model turn never
 * writes it, here or in the thread, which is why rendering a preview of it on this screen is safe.
 */
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import { fill, formatTime } from "@/components/home/format";
import { doseTargets, remaining, type DoseTarget } from "@/lib/rules/doses";
import type { Sheet } from "@/lib/sheets";

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

export default function CheckinNotice({ sheet, today }: { sheet: Sheet; today: Date }) {
  const { locale, t } = useLocale();

  if (sheet.checkin === "pending") {
    const [first] = countableTargets(sheet);
    // §6 makes the check-in conditional on there being something countable. If there is not, the
    // question has no verbatim clause to quote, so there is nothing honest to show and we show
    // nothing — 傾緊呢張 immediately below is still the way into the thread.
    if (!first) return null;

    const last = sheet.thread.at(-1);
    const at = formatTime(last?.at ?? sheet.capturedAt, locale);

    return (
      <Link
        href="/chat"
        className="mt-3.5 flex min-h-12 w-full items-center gap-[15px] rounded-[20px] bg-jade-tint p-5 no-underline animate-rise"
      >
        <span className="relative grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-jade">
          <Mascot size={30} />
          {/* Decoration; the line below carries the same fact in words for a screen reader. */}
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 h-[13px] w-[13px] rounded-full bg-warn-dot"
            style={{ border: "2.5px solid var(--jade-tint)" }}
          />
          <span className="sr-only">{t("tab.chatPending")}</span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[17px] font-bold text-jade-ink">{t("mascot.name")}</span>
            {at ? <span className="shrink-0 text-[14px] text-muted">{at}</span> : null}
          </span>
          <span className="mt-1 block text-[19px] leading-[1.45] font-medium text-ink">
            {fill(t("checkin.question"), { name: first.name, printed: first.printed })}
          </span>
        </span>

        <Chevron />
      </Link>
    );
  }

  if (sheet.checkin === "done") {
    const left = remainingToday(sheet, today);
    return (
      <Link
        href="/track"
        className="mt-3.5 flex min-h-12 w-full items-center gap-3 rounded-[18px] px-1 py-[18px] no-underline"
      >
        <CheckGlyph />
        <span className="flex-1 text-[18px] text-muted">
          {left > 0 ? fill(t("home.dosesLeft"), { n: left }) : t("home.dosesDone")}
        </span>
        <Chevron />
      </Link>
    );
  }

  // "none" (nothing countable, or the briefing has not finished) and "open" (already tapped into,
  // still unanswered) show neither block. Brief §7 names only the two states above.
  return null;
}

/** Pure decoration: --faint is only ever allowed on a glyph that carries no word. */
function Chevron() {
  return (
    <span aria-hidden="true" className="shrink-0 text-[22px] leading-none text-faint">
      ›
    </span>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 17 17"
      fill="none"
      stroke="var(--jade)"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.4 9l3.4 3.4L13.8 4.8" />
    </svg>
  );
}
