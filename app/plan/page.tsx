"use client";

/**
 * S8 Plan — the one place this app behaves like an agent, and therefore the one place it has to
 * be most careful.
 *
 * Three states, in the order a plan lives through them (data-model.md, FollowUpPlan):
 *
 *   **draft**      `draftPlan(reading)` recomputed from the sheet on every visit. Nothing is in
 *                  storage. FR-020: nothing is saved until 確認 is tapped, so a reader who walks
 *                  away has left nothing behind.
 *   **confirmed**  the plan she tapped, rendered from storage exactly as it was saved — not
 *                  recomputed — so the screen can never quietly disagree with what she agreed to.
 *   **expired**    today is past `followUpDate`. FR-021: say the sheet's instructions were
 *                  written for the period up to that visit, and change *nothing*. No item is
 *                  removed, no date is extended, no reminder is rescheduled.
 *
 * Every date and time on screen is verbatim from a source line; `plan-from-reading.ts` is the
 * only thing that parses a date, and only when a line is unambiguous.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentLimits from "@/components/AgentLimits";
import PlanList from "@/components/PlanList";
import { useLocale } from "@/components/LocaleProvider";
import { buildIcs, hasCalendarEvents } from "@/lib/plan/ics";
import { draftPlan, expiryNotice, isExpired } from "@/lib/rules/plan-from-reading";
import { CAUTION_SUFFIX } from "@/lib/rules/template-fallback";
import type { UiLocale } from "@/lib/i18n/ui";
import {
  loadState,
  savePlan,
  subscribe,
  type FollowUpPlan,
  type StoredState,
} from "@/lib/storage/local";

/** Copy with no key in `lib/i18n/ui.ts`. Same rules as everything there (design.md section 6). */
const LOCAL: Record<
  "noReading" | "readSheet" | "confirmed" | "back" | "calendarNote",
  Record<UiLocale, string>
> = {
  noReading: {
    hant: "仲未讀過出院紙，所以整唔到計劃。讀咗張紙先。",
    hans: "还没读过出院纸，所以做不了计划。先读一张纸。",
    en: "No sheet has been read yet, so there is no plan to build. Read one first.",
  },
  readSheet: { hant: "去讀張紙", hans: "去读一张纸", en: "Read a sheet" },
  confirmed: { hant: "已確認", hans: "已确认", en: "Confirmed" },
  back: { hant: "返去張紙", hans: "回到这张纸", en: "Back to the sheet" },
  calendarNote: {
    hant: "日曆入面淨係抄返張紙點寫，冇時間表，冇鬧鐘。",
    hans: "日历里只抄纸上写的内容，没有时间表，没有闹钟。",
    en: "The calendar entry copies what the sheet says. No schedule, no alarms.",
  },
};

const ICS_FILE_NAME = "follow-up.ics";

export default function PlanPage() {
  const { dialect, locale, t } = useLocale();

  // Read after mount, exactly like the ask screen: storage does not exist on the server, and
  // `isExpired` needs a real clock, which must not run during a server render.
  const [state, setState] = useState<StoredState | null>(null);
  useEffect(() => {
    const apply = () => setState(loadState());
    apply();
    return subscribe(apply);
  }, []);

  const reading = state?.reading ?? null;
  const stored = state?.plan?.confirmedAt ? state.plan : null;

  const draft = useMemo(() => (reading ? draftPlan(reading) : null), [reading]);

  /**
   * What is on screen: the confirmed plan when there is one — rendered from storage, never
   * recomputed, so it cannot disagree with what was agreed to — otherwise the draft.
   */
  const plan: FollowUpPlan | null = useMemo(
    () =>
      stored ??
      (draft ? { items: draft.items, confirmedAt: null, followUpDate: draft.followUpDate } : null),
    [draft, stored],
  );

  const expired = plan !== null && isExpired(plan.followUpDate, new Date());

  const confirm = useCallback(() => {
    if (!draft) return;
    savePlan({
      items: draft.items,
      confirmedAt: new Date().toISOString(),
      followUpDate: draft.followUpDate,
    });
  }, [draft]);

  const addToCalendar = useCallback(() => {
    if (!plan || !reading) return;
    const ics = buildIcs(plan, {
      titlePrefix: t("cards.header"),
      startDate: reading.readAt.slice(0, 10),
      appointmentTitle: t("plan.appointment"),
      medicineTitle: t("card.medicine"),
      note: `${LOCAL.calendarNote[locale]} ${CAUTION_SUFFIX[dialect]}`,
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = ICS_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [dialect, locale, plan, reading, t]);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-5 pt-3 pb-4">
      <header className="flex min-h-12 items-center justify-between gap-3">
        <h1 className="min-w-0 text-card-title font-bold text-ink">{t("plan.title")}</h1>
        <Link
          href={reading ? "/read" : "/"}
          className="tap shrink-0 gap-1 rounded-full px-1 text-meta font-semibold text-accent"
        >
          <ChevronLeft />
          {LOCAL.back[locale]}
        </Link>
      </header>

      {state === null ? (
        <div className="mt-10 h-40" aria-hidden="true" />
      ) : !plan ? (
        <section className="surface mt-5 px-[18px] py-6">
          <p className="text-body leading-relaxed text-muted">{LOCAL.noReading[locale]}</p>
          <Link
            href="/"
            className="tap mt-5 h-[54px] w-full rounded-full bg-accent px-4 text-body font-semibold text-accent-ink shadow-raised"
          >
            {LOCAL.readSheet[locale]}
          </Link>
        </section>
      ) : (
        <section className="mt-4">
          {/* FR-021. The notice sits above the plan and the plan below it is untouched. */}
          {expired ? (
            <p
              role="status"
              className="flex items-start gap-3 rounded-card bg-warning-bg px-4 py-3.5 text-body leading-relaxed text-ink"
            >
              <AlertGlyph />
              <span>{expiryNotice()[dialect]}</span>
            </p>
          ) : null}

          {plan.items.length === 0 ? (
            <p className="surface mt-4 px-[18px] py-6 text-body leading-relaxed text-muted">
              {t("plan.empty")}
            </p>
          ) : (
            <>
              <PlanList
                items={plan.items}
                confirmedLabel={stored ? LOCAL.confirmed[locale] : undefined}
              />

              {stored ? (
                hasCalendarEvents(plan, { startDate: reading?.readAt.slice(0, 10) }) ? (
                  <div className="mt-6 flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={addToCalendar}
                      className="tap h-[50px] w-full gap-2 rounded-full text-body font-semibold text-accent"
                    >
                      <CalendarGlyph />
                      {t("plan.addToCalendar")}
                    </button>
                    <p className="px-1 text-center text-fine text-muted">
                      {LOCAL.calendarNote[locale]}
                    </p>
                  </div>
                ) : null
              ) : (
                <div className="mt-6 flex flex-col gap-2.5">
                  <p className="px-1 text-fine text-muted">{t("plan.draftNote")}</p>
                  <button
                    type="button"
                    onClick={confirm}
                    className="tap h-[54px] w-full rounded-full bg-accent text-body font-semibold text-accent-ink shadow-raised"
                  >
                    {t("plan.confirm")}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <AgentLimits className="mt-7" />
    </main>
  );
}

function ChevronLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[18px] w-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 6l-6 6 6 6" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[19px] w-[19px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="5" width="17" height="16" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

/** Colour is never the only signal (design.md section 7): the amber block also carries a glyph. */
function AlertGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="mt-1 h-[22px] w-[22px] shrink-0 text-warning-fg"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.4v.2" />
    </svg>
  );
}
