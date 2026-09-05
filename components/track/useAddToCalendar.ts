"use client";

/**
 * 加入日曆 — one `.ics` built on the device from the plan, handed to the phone's own calendar.
 *
 * Shared by the appointment card on 跟進 and the visit rows in the thread, so both write exactly
 * the same event: the sheet's own words, no schedule, no alarm. `available` is false when the
 * plan has nothing a calendar can hold, and the button is simply not offered.
 */
import { useCallback, useMemo } from "react";
import { useLocale } from "@/components/LocaleProvider";
import type { StoredReading } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";
import { buildIcs, hasCalendarEvents } from "@/lib/plan/ics";
import type { DraftPlan } from "@/lib/rules/plan-from-reading";
import { CAUTION_SUFFIX } from "@/lib/rules/template-fallback";

/** A promise about what the agent does, carried over verbatim from the v1 plan screen. */
export const CALENDAR_NOTE: Record<UiLocale, string> = {
  hant: "日曆入面淨係抄返張紙點寫，冇時間表，冇鬧鐘。",
  hans: "日历里只抄纸上写的内容，没有时间表，没有闹钟。",
  en: "The calendar entry copies what the sheet says. No schedule, no alarms.",
};

const ICS_FILE_NAME = "follow-up.ics";

export function useAddToCalendar(plan: DraftPlan, reading: StoredReading) {
  const { dialect, locale, t } = useLocale();

  const available = useMemo(
    () =>
      hasCalendarEvents(
        { items: plan.items, confirmedAt: null, followUpDate: plan.followUpDate },
        { startDate: reading.readAt.slice(0, 10) },
      ),
    [plan, reading.readAt],
  );

  const add = useCallback(() => {
    const ics = buildIcs(
      { items: plan.items, confirmedAt: null, followUpDate: plan.followUpDate },
      {
        titlePrefix: t("cards.header"),
        startDate: reading.readAt.slice(0, 10),
        appointmentTitle: t("plan.appointment"),
        medicineTitle: t("card.medicine"),
        note: `${CALENDAR_NOTE[locale]} ${CAUTION_SUFFIX[dialect]}`,
      },
    );
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = ICS_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [dialect, locale, plan, reading, t]);

  return { available, add, note: CALENDAR_NOTE[locale] };
}
