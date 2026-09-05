"use client";

/**
 * The block under the two buttons on 記錄: 明明's conversation row, always, whenever there is an
 * active sheet — not only when a check-in is pending.
 *
 * **This is an IN-APP message.** There are no push notifications in this product and nothing here
 * may imply the phone will go off by itself: no bell, no "reminder", no "we'll tell you at 9".
 * What it looks like — a name, a time, an unread dot — is what a message that is already sitting
 * in the app looks like when you open it, which is exactly what this is. The timestamp is when
 * 明明 last said something in the thread, read back off the thread, never a time we scheduled.
 *
 * Unread (pending check-in, or a briefing that has not ended) keeps the jade-tint card, the
 * greeting pop, and the amber dot. Once the briefing is over and the check-in is not pending, the
 * same row goes quiet: white surface, idle, no dot. A finished check-in still collapses into the
 * doses line underneath, linking to 跟進.
 *
 * The pending-check-in question is assembled from the FIXED template `checkin.question` with the
 * medicine's name and the page's own frequency clause dropped in verbatim (brief §6). A model turn
 * never writes it. Without something countable, that question is omitted and the preview falls
 * back to the last thread line.
 */
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import { fill, formatTime } from "@/components/home/format";
import {
  homePreview,
  homeUnread,
  remainingToday,
} from "@/components/home/conversation";
import type { Sheet } from "@/lib/sheets";

export {
  countableTargets,
  homePreview,
  homeUnread,
  remainingToday,
} from "@/components/home/conversation";

export default function CheckinNotice({ sheet, today }: { sheet: Sheet; today: Date }) {
  const { locale, t } = useLocale();
  const unread = homeUnread(sheet);
  const last = sheet.thread.at(-1);
  const at = formatTime(last?.at ?? sheet.capturedAt, locale);
  const href = sheet.checkin === "pending" ? "/chat?checkin=1" : "/chat";

  return (
    <>
      <Link
        href={href}
        className={
          unread
            ? "companion-card mt-5 flex min-h-12 w-full items-center gap-4 rounded-[24px] p-4 no-underline shadow-raised lg:mt-0 lg:min-h-[11rem] lg:p-6"
            : "surface mt-5 flex min-h-12 w-full items-center gap-4 rounded-[24px] p-4 no-underline lg:mt-0 lg:min-h-[11rem] lg:p-6"
        }
      >
        <span className="companion-plate relative grid h-[88px] w-[88px] shrink-0 place-items-center rounded-full">
          <Mascot size={64} state={unread ? "greeting" : "idle"} />
          {unread ? (
            <>
              {/* Decoration; the line below carries the same fact in words for a screen reader. */}
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 h-[16px] w-[16px] rounded-full bg-warn-dot"
                style={{ border: "3px solid var(--companion-plate)" }}
              />
              <span className="sr-only">{t("tab.chatPending")}</span>
            </>
          ) : null}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`text-[20px] font-bold ${unread ? "companion-ink" : "text-ink"}`}>
              {t("mascot.name")}
            </span>
            {at ? <span className="shrink-0 text-[15px] text-muted">{at}</span> : null}
          </span>
          <span className="mt-1 block text-[19px] leading-[1.45] font-medium text-ink">
            {homePreview(sheet, t)}
          </span>
          <span
            className={`mt-2 block text-[16px] font-semibold ${unread ? "companion-ink" : "text-muted"}`}
          >
            {t("tab.chat")} ›
          </span>
        </span>
      </Link>

      {sheet.checkin === "done" ? <DoneLine sheet={sheet} today={today} /> : null}
    </>
  );
}

function DoneLine({ sheet, today }: { sheet: Sheet; today: Date }) {
  const { t } = useLocale();
  const left = remainingToday(sheet, today);
  return (
    <Link
      href="/track"
      className="flex min-h-12 w-full items-center gap-3 rounded-[18px] px-1 py-[18px] no-underline"
    >
      <CheckGlyph />
      <span className="flex-1 text-[18px] text-muted">
        {left > 0 ? fill(t("home.dosesLeft"), { n: left }) : t("home.dosesDone")}
      </span>
      <Chevron />
    </Link>
  );
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
