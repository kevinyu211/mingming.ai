"use client";

/**
 * 跟進 — the active sheet's follow-up, and nothing else (brief §1, §7).
 *
 * Not a global list. Everything here belongs to the one sheet named at the top: its appointment,
 * its medicines, its warning signs. Archived sheets are unreachable from this tab on purpose —
 * their counters were frozen when they were archived, so a 跟進 built on one would be quoting a
 * page nobody is holding any more.
 *
 * With no sheet at all there is nothing to follow, and the screen says so and points at 記錄
 * rather than showing an empty scaffold.
 */
import { useCallback, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import TabBar, { TAB_BAR_HEIGHT } from "@/components/TabBar";
import CaptureButtons from "@/components/home/CaptureButtons";
import { homeUnread } from "@/components/home/conversation";
import { useSheets } from "@/components/home/useSheets";
import AppointmentCard from "@/components/track/AppointmentCard";
import DoseCard from "@/components/track/DoseCard";
import SheetStrip from "@/components/track/SheetStrip";
import ShareButton from "@/components/track/ShareButton";
import WarningSigns from "@/components/track/WarningSigns";
import type { UiLocale } from "@/lib/i18n/ui";
import { doseTargets } from "@/lib/rules/doses";
import { takeDose } from "@/lib/sheets";

const BOTTOM_GAP = TAB_BAR_HEIGHT + 24;

/** Copy with no key in `lib/i18n/ui.ts`, carried over from the v1 plan screen it replaces. */
const NO_SHEET: Record<UiLocale, string> = {
  hant: "仲未讀過出院紙，所以未有嘢跟進。拍張紙先。",
  hans: "还没读过出院纸，所以还没有东西跟进。先拍一张纸。",
  en: "No sheet has been read yet, so there is nothing to follow up. Photograph one first.",
};

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

  return (
    <>
      <main
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-3.5 pb-[var(--tab-pad)] lg:max-w-none lg:px-10 lg:pt-8 lg:pb-10"
        style={{ ["--tab-pad" as string]: `${BOTTOM_GAP}px` }}
      >
        <h1 className="mb-3.5 text-[30px] leading-[1.3] font-bold text-ink lg:text-[28px]">{t("track.title")}</h1>

        {!hydrated ? (
          <div className="mt-8 h-40" aria-hidden="true" />
        ) : active === null ? (
          <section className="mt-6 flex flex-col items-center gap-5 lg:mx-auto lg:mt-16 lg:max-w-xl">
            <span className="companion-plate grid h-[132px] w-[132px] place-items-center rounded-full lg:h-[168px] lg:w-[168px]">
              <Mascot size={92} state="greeting" />
            </span>
            <p className="surface w-full px-[18px] py-6 text-center text-[18px] leading-[1.55] text-muted">
              {NO_SHEET[locale]}
            </p>
            <CaptureButtons size="lg" />
          </section>
        ) : (
          <>
            <SheetStrip sheet={active} />

            <div className="lg:mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
              <div>
                <div className="mt-[22px] lg:mt-0">
                  <AppointmentCard plan={active.plan} reading={active.reading} today={today} />
                </div>

                {targets.length > 0 ? (
                  <>
                    <h2 className="mt-[30px] mb-3 px-0.5 text-[15px] font-medium tracking-[0.06em] text-muted">
                      {t("track.todayMeds")}
                    </h2>
                    <ul className="flex list-none flex-col gap-3 p-0">
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
                  </>
                ) : null}
              </div>

              <WarningSigns reading={active.reading} />
            </div>

            <div className="mt-[30px]">
              <ShareButton reading={active.reading} />
            </div>
          </>
        )}
      </main>

      <TabBar active="track" pending={active != null && homeUnread(active)} />
    </>
  );
}
