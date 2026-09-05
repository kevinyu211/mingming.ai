"use client";

/**
 * 記錄 — the first tab, in its two states (brief §7).
 *
 * **Empty**, before anything has been photographed: the two big buttons, then 明明 at full
 * strength in greeting with 「仲未有紙。拍完我就即刻講俾你聽。」
 *
 * **With a sheet**: the same two buttons at the smaller size, the conversation row (and the
 * quiet doses line it keeps underneath once the check-in is answered), the active sheet, and
 * 以前嘅 behind a disclosure.
 *
 * ONE ACTIVE SHEET (brief §1) is the rule the whole screen is shaped around. There is no list of
 * sheets to choose between: there is the sheet being talked about, and behind it, history that can
 * only be looked at. Photographing a new one replaces the first and freezes the old one's counters.
 *
 * `today` is created once per mount rather than per render so the counter cannot change under a
 * re-render, and so the pure rules underneath keep taking their clock as an argument.
 *
 * Desktop (`lg:` and up) is a two-column workspace around the same facts. The phone column,
 * the tab bar, and the 92 px greeting stay as they were.
 */
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import TabBar, { TAB_BAR_HEIGHT } from "@/components/TabBar";
import CaptureButtons from "@/components/home/CaptureButtons";
import CheckinNotice from "@/components/home/CheckinNotice";
import { homeUnread } from "@/components/home/conversation";
import OlderSheets from "@/components/home/OlderSheets";
import SheetCard from "@/components/home/SheetCard";
import { useSheets } from "@/components/home/useSheets";

/** Clear of the 96px tab bar plus a little air, so the last row is never half under it. */
const BOTTOM_GAP = TAB_BAR_HEIGHT + 24;

export default function HomeScreen() {
  const { t } = useLocale();
  const { active, archive, hydrated } = useSheets();
  const [today] = useState(() => new Date());

  return (
    <>
      <main
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-3.5 pb-[var(--tab-pad)] lg:max-w-none lg:px-10 lg:pt-8 lg:pb-10"
        style={{ ["--tab-pad" as string]: `${BOTTOM_GAP}px` }}
      >
        <header className="flex items-start justify-between gap-3">
          <h1 className="text-[30px] leading-[1.3] font-bold text-ink lg:text-[28px]">{t("home.title")}</h1>
          {/*
            The canvas has no control here. This one stays because `/settings` is the only route to
            刪除所有資料, and the constitution requires that control to exist and be reachable
            (principle V). It is a 48px target and it says what it is to a screen reader.
            On a desktop the rail already has Settings, so the gear hides at `lg`.
          */}
          <Link
            href="/settings"
            aria-label={t("settings.title")}
            className="tap shrink-0 rounded-full text-muted lg:hidden"
          >
            <GearGlyph />
          </Link>
        </header>

        {/*
          Before the stored sheets have been read, hold the shape. Flashing 「仲未有紙」 at someone
          who photographed a sheet an hour ago is the one thing this screen must not do.
        */}
        {!hydrated ? (
          <div className="mt-8 h-40" aria-hidden="true" />
        ) : active === null ? (
          <EmptyState />
        ) : (
          <div className="lg:mt-6 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start lg:gap-8">
            {/*
              明明 first. Once a sheet exists, the job is to hear it — not to photograph another
              one. The camera pair drops below the paper so the conversation is the thing a
              bystander sees from across the table.
            */}
            <CheckinNotice sheet={active} today={today} />

            <div>
              <h2 className="mt-[30px] mb-3 px-0.5 text-[15px] font-medium tracking-[0.06em] text-muted lg:mt-0">
                {t("home.nowTalking")}
              </h2>
              <SheetCard sheet={active} />

              <div className="mt-5">
                <CaptureButtons size="sm" />
              </div>

              <OlderSheets sheets={archive} />
            </div>
          </div>
        )}
      </main>

      <TabBar active="record" pending={active != null && homeUnread(active)} />
    </>
  );
}

function EmptyState() {
  const { t } = useLocale();

  return (
    <>
      <p className="mt-1.5 text-[18px] leading-[1.55] text-muted lg:mx-auto lg:mt-4 lg:max-w-xl lg:text-center">
        {t("home.emptySubtitle")}
      </p>
      <div className="mt-8 mb-5 flex flex-col items-center gap-4 lg:mt-16 lg:mb-10 lg:gap-6">
        <span className="companion-plate grid h-[132px] w-[132px] place-items-center rounded-full lg:h-[168px] lg:w-[168px]">
          <Mascot size={92} state="greeting" />
        </span>
        <p className="max-w-[280px] text-center text-[20px] leading-[1.55] font-medium text-ink lg:max-w-md lg:text-[22px]">
          {t("home.emptyMascot")}
        </p>
      </div>
      <div className="lg:mx-auto lg:w-full lg:max-w-xl">
        <CaptureButtons size="lg" />
      </div>
    </>
  );
}

function GearGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a1.9 1.9 0 1 1 0-3.8h.3a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 2.8-1.1v-.2a1.9 1.9 0 1 1 3.8 0v.3a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1.1Z" />
    </svg>
  );
}
