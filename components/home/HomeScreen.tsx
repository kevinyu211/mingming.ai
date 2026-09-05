"use client";

/**
 * 記錄 — the first tab, in the "Three Things" cut (Companion D).
 *
 * **Empty**, before anything has been photographed, it is the start screen: the wordmark and the
 * language pill, 明明 with the one thing he has to say before there is a sheet, 「您好。畀我睇睇您嘅
 * 出院紙。」, and two big rows — take a photo, or upload a photo someone sent you.
 *
 * **With a sheet**: the conversation row (and the quiet doses line under it once the check-in is
 * answered), the active sheet, the two capture pills at the smaller size, and 以前嘅 behind a
 * disclosure.
 *
 * ONE ACTIVE SHEET (brief §1) is the rule the whole screen is shaped around. There is no list of
 * sheets to choose between: there is the sheet being talked about, and behind it, history that can
 * only be looked at. Photographing a new one replaces the first and freezes the old one's counters.
 *
 * `today` is created once per mount rather than per render so the counter cannot change under a
 * re-render, and so the pure rules underneath keep taking their clock as an argument.
 */
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import TabBar, { TAB_BAR_HEIGHT } from "@/components/TabBar";
import CaptureButtons from "@/components/home/CaptureButtons";
import CheckinNotice from "@/components/home/CheckinNotice";
import LanguagePill from "@/components/home/LanguagePill";
import { homeUnread } from "@/components/home/conversation";
import OlderSheets from "@/components/home/OlderSheets";
import SheetCard from "@/components/home/SheetCard";
import { useSheets } from "@/components/home/useSheets";
import Wordmark from "@/components/Wordmark";

/** Clear of the 96px tab bar plus a little air, so the last row is never half under it. */
const BOTTOM_GAP = TAB_BAR_HEIGHT + 24;

export default function HomeScreen() {
  const { t } = useLocale();
  const { active, archive, hydrated } = useSheets();
  const [today] = useState(() => new Date());

  return (
    <>
      <main
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-3.5 pb-[var(--tab-pad)] lg:max-w-none lg:px-10 lg:pt-8 lg:pb-10"
        style={{ ["--tab-pad" as string]: `${BOTTOM_GAP}px` }}
      >
        <header className="flex min-h-12 items-center justify-between gap-3">
          <Wordmark />
          <div className="flex items-center gap-2">
            <LanguagePill />
            {/*
              The gear stays because `/settings` is the only route to 刪除所有資料, and the
              constitution requires that control to exist and be reachable (principle V). On a
              desktop the rail already has Settings, so it hides at `lg`.
            */}
            <Link
              href="/settings"
              aria-label={t("settings.title")}
              className="pill h-9 w-9 shrink-0 !px-0 text-muted lg:hidden"
            >
              <GearGlyph />
            </Link>
          </div>
        </header>

        {/* The tab's own name, small, above whichever state follows. It is the page heading. */}
        <h1 className="mt-2 text-[13px] leading-[18px] font-semibold tracking-normal text-muted">
          {t("home.title")}
        </h1>

        {/*
          Before the stored sheets have been read, hold the shape. Flashing 「仲未有紙」 at someone
          who photographed a sheet an hour ago is the one thing this screen must not do.
        */}
        {!hydrated ? (
          <div className="mt-8 h-40" aria-hidden="true" />
        ) : active === null ? (
          <EmptyState />
        ) : (
          <>
            <div className="lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start lg:gap-8">
              {/* 明明 first. Once a sheet exists, the job is to hear it, not to photograph another. */}
              <CheckinNotice sheet={active} today={today} />

              <div>
                <h2 className="mt-7 mb-2.5 px-0.5 text-[13px] font-semibold text-muted lg:mt-0">
                  {t("home.nowTalking")}
                </h2>
                <SheetCard sheet={active} />

                <div className="mt-4">
                  <CaptureButtons size="sm" />
                </div>

                <OlderSheets sheets={archive} />
              </div>
            </div>
          </>
        )}
      </main>

      <TabBar active="record" pending={active != null && homeUnread(active)} />
    </>
  );
}

function EmptyState() {
  const { t } = useLocale();

  return (
    <div className="flex flex-1 flex-col lg:mx-auto lg:w-full lg:max-w-xl">
      <div className="flex-1" />

      {/* 明明, with the one thing he has to say before there is a sheet. */}
      <div className="flex items-center gap-4">
        <span className="companion-plate grid h-[112px] w-[112px] shrink-0 place-items-center rounded-full">
          <Mascot size={92} state="greeting" />
        </span>
        <p className="max-w-[220px] text-[15px] leading-[1.5] text-muted">{t("home.emptyMascot")}</p>
      </div>

      <p className="mt-7 text-[34px] leading-[40px] font-bold tracking-[-0.5px] whitespace-pre-line text-ink lg:text-[40px] lg:leading-[46px]">
        {t("companion.homeTitle")}
      </p>
      <p className="mt-3.5 max-w-[320px] text-[17px] leading-[26px] text-muted">
        {t("companion.homeSub")}
      </p>

      <div className="mt-9">
        <CaptureButtons size="lg" />
      </div>

      <div className="flex-1" />

      <p className="px-3 pt-6 pb-2 text-center text-[13px] leading-[18px] text-muted">
        {t("review.onDevice")}
      </p>
    </div>
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
