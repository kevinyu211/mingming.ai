"use client";

/**
 * 跟進, as the design's 今日 (Companion D): the active sheet's follow-up, and nothing else.
 *
 * Not a global list. Everything here belongs to the one sheet named at the top: its medicines
 * with their slots to tick, its appointment, its warning signs, and 分享俾屋企人. Archived sheets
 * are unreachable from this tab on purpose — their counters were frozen when they were archived,
 * so a 跟進 built on one would be quoting a page nobody is holding any more.
 *
 * With no sheet at all there is nothing to follow, and the screen says so and points at 記錄
 * rather than showing an empty scaffold.
 *
 * The design's water tracker is deliberately not here. Nothing on a discharge sheet says how much
 * to drink, and a cup count with a goal is the app writing an instruction the page did not print.
 */
import Link from "next/link";
import { useCallback, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import TabBar, { TAB_BAR_HEIGHT } from "@/components/TabBar";
import CaptureButtons from "@/components/home/CaptureButtons";
import { homeUnread } from "@/components/home/conversation";
import { daysUntil, fill } from "@/components/home/format";
import { useSheets } from "@/components/home/useSheets";
import AppointmentCard from "@/components/track/AppointmentCard";
import DoseCard from "@/components/track/DoseCard";
import FollowUpNote from "@/components/track/FollowUpNote";
import RecapCard from "@/components/track/RecapCard";
import { followUpLine, hasRecap, recap } from "@/components/track/followup";
import SheetStrip from "@/components/track/SheetStrip";
import ShareButton from "@/components/track/ShareButton";
import WarningSigns from "@/components/track/WarningSigns";
import type { UiKey, UiLocale } from "@/lib/i18n/ui";
import { doseTargets, remaining } from "@/lib/rules/doses";
import { takeDose } from "@/lib/sheets";

/** Room for the tab bar, the floating 同明明傾傾 pill above it, and a little air. */
const BOTTOM_GAP = TAB_BAR_HEIGHT + 96;

/** Copy with no key in `lib/i18n/ui.ts`, carried over from the v1 plan screen it replaces. */
const NO_SHEET: Record<UiLocale, string> = {
  hant: "仲未讀過出院紙，所以未有嘢跟進。拍張紙先。",
  hans: "还没读过出院纸，所以还没有东西跟进。先拍一张纸。",
  en: "No sheet has been read yet, so there is nothing to follow up. Photograph one first.",
};

/** 早晨 / 午安 / 晚上好 from the device's own clock — a fact about the phone, not the person. */
function greetingKey(now: Date): UiKey {
  const hour = now.getHours();
  if (hour < 12) return "companion.morning";
  if (hour < 18) return "companion.afternoon";
  return "companion.evening";
}

/** Whole days since the sheet was read, counting the day it was read as day 1. */
function dayNumber(capturedAt: string, today: Date): number {
  const from = new Date(capturedAt);
  if (Number.isNaN(from.getTime())) return 1;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export default function TrackScreen() {
  const { locale, t } = useLocale();
  const { active, hydrated } = useSheets();
  // One clock per mount: the counter must not move under a re-render, and every rule below still
  // takes `today` as an argument rather than reading a clock of its own.
  const [today] = useState(() => new Date());

  // `new Date()` here rather than the mounted `today`: the write must land on the calendar day the
  // tap actually happened on, even if the phone has been open since before midnight. `useSheets`
  // is subscribed to the store, so the counter re-renders from the persisted value.
  const onTake = useCallback((key: string) => {
    takeDose(key, new Date());
  }, []);

  const targets = active ? doseTargets(active.reading) : [];
  const countable = targets.filter((x) => !x.stopped && !x.asNeeded && x.total > 0);
  const left = active
    ? countable.reduce((sum, x) => sum + remaining(x, active.doses[x.key], today), 0)
    : 0;
  // 明明's line and the recap: both pure, both from facts the cards below already stand on.
  const line = active
    ? followUpLine(
        { left, countable: countable.length, daysToVisit: daysUntil(active.plan.followUpDate, today) },
        t,
      )
    : "";
  const talked = active
    ? recap(active.thread, active.briefing, [t("checkin.took"), t("checkin.notYet")])
    : null;

  return (
    <>
      <main
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-3.5 pb-[var(--tab-pad)] lg:max-w-none lg:px-10 lg:pt-8 lg:pb-10"
        style={{ ["--tab-pad" as string]: `${BOTTOM_GAP}px` }}
      >
        <header className="flex min-h-11 items-center justify-between gap-3">
          {active ? (
            <span className="pill min-h-8 px-3 text-[13px]">
              {fill(t("companion.dayPill"), { n: dayNumber(active.capturedAt, today) })}
            </span>
          ) : (
            <span />
          )}
          <Link
            href="/settings"
            aria-label={t("settings.title")}
            className="pill h-9 w-9 shrink-0 !px-0 text-muted lg:hidden"
          >
            <GearGlyph />
          </Link>
        </header>

        {/* The tab's own name, small; the greeting under it is the artboard's headline. */}
        <h1 className="mt-2 text-[13px] leading-[18px] font-semibold tracking-normal text-muted">
          {t("track.title")}
        </h1>
        <p className="mt-2 text-[30px] leading-[36px] font-bold tracking-[-0.3px] text-ink lg:text-[28px]">
          {t(greetingKey(today))}
        </p>
        <p className="mt-1 text-[15px] leading-[22px] text-muted">{t("companion.todaySub")}</p>

        {!hydrated ? (
          <div className="mt-8 h-40" aria-hidden="true" />
        ) : active === null ? (
          <section className="mt-6 flex flex-col items-center gap-5 lg:mx-auto lg:mt-16 lg:max-w-xl">
            <span className="companion-plate grid h-[132px] w-[132px] place-items-center rounded-full lg:h-[168px] lg:w-[168px]">
              <Mascot size={92} state="greeting" />
            </span>
            <p className="surface w-full px-[18px] py-6 text-center text-[17px] leading-[1.55] text-muted">
              {NO_SHEET[locale]}
            </p>
            <div className="w-full">
              <CaptureButtons size="lg" />
            </div>
          </section>
        ) : (
          <>
            <div className="mt-5">
              <SheetStrip sheet={active} />
            </div>

            <FollowUpNote text={line} />

            <div className="lg:mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
              <div>
                {targets.length > 0 ? (
                  <section className="surface mt-3 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-[17px] font-bold text-ink">{t("track.todayMeds")}</h2>
                      {countable.length > 0 ? (
                        <span className="text-[13px] text-muted">
                          {left > 0 ? fill(t("dose.left"), { n: left }) : t("dose.done")}
                        </span>
                      ) : null}
                    </div>
                    <ul className="mt-3.5 flex list-none flex-col gap-4 p-0">
                      {targets.map((target) => (
                        <DoseCard
                          key={target.key}
                          target={target}
                          state={active.doses[target.key]}
                          today={today}
                          onTake={onTake}
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}

                <div className="mt-3">
                  <AppointmentCard plan={active.plan} reading={active.reading} today={today} />
                </div>
                {talked && hasRecap(talked) ? <RecapCard recap={talked} /> : null}
              </div>

              <div>
                <WarningSigns reading={active.reading} />
                <div className="mt-3 flex justify-center">
                  <ShareButton reading={active.reading} />
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* One button to the conversation, floating above the tabs; one pill in the chat comes back. */}
      {hydrated && active ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-20 flex justify-center px-5 lg:hidden"
          style={{ bottom: `calc(var(--disclaimer-height) + ${TAB_BAR_HEIGHT + 12}px)` }}
        >
          <Link
            href="/chat"
            className="talk-grad chunky pointer-events-auto inline-flex min-h-[52px] items-center gap-2.5 rounded-full px-[26px] text-[15px] font-semibold text-white no-underline shadow-raised"
          >
            <span aria-hidden="true">✦</span>
            {t("companion.talk")}
          </Link>
        </div>
      ) : null}

      <TabBar active="track" pending={active != null && homeUnread(active)} />
    </>
  );
}

function GearGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a1.9 1.9 0 1 1 0-3.8h.3a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 2.8-1.1v-.2a1.9 1.9 0 1 1 3.8 0v.3a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1.1Z" />
    </svg>
  );
}
