"use client";

/**
 * 下次覆診 — the appointment, and the one place in the product where a date may appear.
 *
 * **A date and a countdown exist only when `plan.followUpDate` parsed.** `lib/rules/plan-from-
 * reading.ts` produces that string only for printed forms that can mean exactly one thing, and
 * returns null for everything hedged ("about 2 weeks", 「大約兩星期」), everything ambiguous
 * ("01/02/2026" — day-first or month-first?) and everything it does not recognise. When it is
 * null this card shows the sheet's own words behind 「張紙寫：」 and counts nothing. Rendering
 * "21 days" from a line the rules refused to read would be the app deciding a medical date on the
 * family's behalf, which is exactly what the constitution's "everything traces to a line" forbids.
 *
 * A visit already in the past keeps its date and swaps the countdown for FR-021's fixed sentence.
 * Nothing is extended, nothing is rescheduled, nothing is removed.
 */
import { useCallback, useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import ChunkyButton from "@/components/ChunkyButton";
import { useLocale } from "@/components/LocaleProvider";
import { daysUntil, fill, formatYmd } from "@/components/home/format";
import type { StoredReading } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";
import { buildIcs, hasCalendarEvents } from "@/lib/plan/ics";
import type { DraftPlan } from "@/lib/rules/plan-from-reading";
import { CAUTION_SUFFIX } from "@/lib/rules/template-fallback";

/**
 * Copy with no key in `lib/i18n/ui.ts`, carried over verbatim from the v1 plan screen because it
 * is a promise about what the agent does (constitution's agent-limits constraint), not decoration.
 */
const CALENDAR_NOTE: Record<UiLocale, string> = {
  hant: "日曆入面淨係抄返張紙點寫，冇時間表，冇鬧鐘。",
  hans: "日历里只抄纸上写的内容，没有时间表，没有闹钟。",
  en: "The calendar entry copies what the sheet says. No schedule, no alarms.",
};

const ICS_FILE_NAME = "follow-up.ics";

export default function AppointmentCard({
  plan,
  reading,
  today,
}: {
  plan: DraftPlan;
  reading: StoredReading;
  today: Date;
}) {
  const { dialect, locale, t } = useLocale();
  const [open, setOpen] = useState(false);

  const appointments = plan.items.filter((item) => item.kind === "appointment");

  const addToCalendar = useCallback(() => {
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

  // The page printed no follow-up at all: there is nothing to follow, and an empty card saying so
  // would only take the place of the medicines below it.
  if (appointments.length === 0) return null;

  const first = appointments[0];
  const parsed = plan.followUpDate;
  const date = parsed ? formatYmd(parsed, locale) : "";
  const days = parsed ? daysUntil(parsed, today) : null;
  const expired = days !== null && days < 0;
  /** A countdown exists only for a parsed date that is still ahead. Today counts nothing. */
  const countdown = !expired && days !== null && days > 0;

  // Split on the placeholder so the count can be the big numeral the canvas draws, in every
  // locale: 「{n} 日之後」 puts it first, "in {n} days" puts it in the middle.
  const [beforeCount, afterCount] = t("track.daysAfter").split("{n}");

  const headline = date || (first.when.trim().length > 0 ? "" : first.label);
  const printed = !parsed && first.when.trim().length > 0 ? first.when.trim() : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="chunky w-full rounded-[22px] bg-jade px-[22px] py-6 text-left text-white"
      >
        {/*
          Every word on this card is solid white. The canvas fades these secondary lines to 76–85%
          alpha, which on --jade lands at 4.1:1 — under AA for text a seventy-year-old has to read
          at arm's length. Solid white is 5.05:1; hierarchy comes from size and weight instead.
        */}
        <span className="block text-[15px] font-medium tracking-[0.06em] text-white">
          {t("track.nextVisit")}
        </span>

        {headline ? (
          <span className="mt-[7px] block text-[26px] leading-[1.35] font-bold">{headline}</span>
        ) : null}

        {printed ? (
          /* The rules could not read a date out of this line, so the line itself is what shows. */
          <span className="mt-[7px] block text-[22px] leading-[1.4] font-bold">
            {fill(t("card.printed"), { text: printed })}
          </span>
        ) : null}

        {first.label.trim().length > 0 && first.label !== headline ? (
          <span className="mt-1 block text-[18px] leading-[1.5] text-white">{first.label}</span>
        ) : null}

        {/*
          The footer exists only when there is something true to put in it. No parsed date, or a
          visit that is today, means no countdown — and an empty band under a rule would read as a
          number that failed to load rather than as a number the rules declined to invent.
        */}
        <span
          className={`mt-4 flex items-baseline justify-between gap-3 ${
            countdown ? "border-t border-white/25 pt-4" : ""
          }`}
        >
          {expired ? (
            <span className="text-[17px] leading-[1.5] text-white">{t("plan.expired")}</span>
          ) : countdown ? (
            <span className="flex items-baseline gap-2">
              {beforeCount ? <span className="text-[19px]">{beforeCount.trim()}</span> : null}
              <span className="text-[40px] leading-none font-bold">{days}</span>
              {afterCount ? <span className="text-[19px]">{afterCount.trim()}</span> : null}
            </span>
          ) : (
            <span />
          )}
          <span aria-hidden="true" className="shrink-0 text-[22px] leading-none text-white/80">
            ›
          </span>
        </span>
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={date || t("plan.appointment")}
        subtitle={first.label.trim().length > 0 ? first.label : undefined}
      >
        <ul className="flex list-none flex-col gap-3 p-0">
          {appointments.map((item, index) => (
            <li key={index} className="rounded-2xl bg-neutral-2 px-[18px] py-4">
              {item.when.trim().length > 0 ? (
                <p className="text-[18px] leading-[1.55] text-ink">
                  {fill(t("card.printed"), { text: item.when.trim() })}
                </p>
              ) : null}
              {/* The line itself, exactly as the page printed it. Never script-converted: a quote
                  that has been rewritten is no longer a quote (constitution IV). */}
              {item.source.quote.trim().length > 0 ? (
                <p className="mt-2 text-[17px] leading-[1.55] text-muted">
                  「{item.source.quote.trim()}」
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        {hasCalendarEvents(
          { items: plan.items, confirmedAt: null, followUpDate: plan.followUpDate },
          { startDate: reading.readAt.slice(0, 10) },
        ) ? (
          <div className="mt-5 flex flex-col gap-2">
            <ChunkyButton variant="jade" size="lg" fullWidth onClick={addToCalendar}>
              {t("plan.addToCalendar")}
            </ChunkyButton>
            <p className="px-1 text-center text-[13px] leading-[1.45] text-muted">
              {CALENDAR_NOTE[locale]}
            </p>
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
