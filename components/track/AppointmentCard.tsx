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
 *
 * The row is the design's visit row: a charcoal date tile, the clinic, the date or the printed
 * words, and 加入日曆 as a pill. Tapping the row opens the printed lines it stands on.
 */
import { useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import ChunkyButton from "@/components/ChunkyButton";
import { useLocale } from "@/components/LocaleProvider";
import { daysUntil, fill, formatYmd } from "@/components/home/format";
import { useAddToCalendar } from "@/components/track/useAddToCalendar";
import type { StoredReading } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";
import type { DraftPlan } from "@/lib/rules/plan-from-reading";

const TAG: Record<UiLocale, string> = { hant: "zh-HK", hans: "zh-CN", en: "en-GB" };

export default function AppointmentCard({
  plan,
  reading,
  today,
}: {
  plan: DraftPlan;
  reading: StoredReading;
  today: Date;
}) {
  const { locale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const { available, add, note } = useAddToCalendar(plan, reading);

  const appointments = plan.items.filter((item) => item.kind === "appointment");

  // The page printed no follow-up at all: there is nothing to follow, and an empty card saying so
  // would only take the place of the medicines above it.
  if (appointments.length === 0) return null;

  const first = appointments[0];
  const parsed = plan.followUpDate;
  const date = parsed ? formatYmd(parsed, locale) : "";
  const days = parsed ? daysUntil(parsed, today) : null;
  const expired = days !== null && days < 0;
  /** A countdown exists only for a parsed date that is still ahead. Today counts nothing. */
  const countdown = !expired && days !== null && days > 0;

  const printed = !parsed && first.when.trim().length > 0 ? first.when.trim() : "";
  const label = first.label.trim().length > 0 ? first.label : t("plan.appointment");

  let tile: { month: string; day: string } | null = null;
  if (parsed) {
    const [y, m, d] = parsed.split("-").map(Number);
    tile = {
      month: new Intl.DateTimeFormat(TAG[locale], { month: "short" }).format(new Date(y, m - 1, d)),
      day: String(d),
    };
  }

  return (
    <>
      <section aria-label={t("track.nextVisit")} className="surface p-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-start gap-3.5 text-left"
        >
          {tile ? (
            <span className="flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center rounded-[12px] bg-ink text-white">
              <span className="text-[10px] font-medium tracking-[1px] text-on-dark-muted uppercase">
                {tile.month}
              </span>
              <span className="text-[20px] leading-[22px] font-bold">{tile.day}</span>
            </span>
          ) : (
            <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[12px] bg-neutral text-muted">
              <CalendarGlyph />
            </span>
          )}

          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-muted">{t("track.nextVisit")}</span>
            <span className="mt-0.5 block text-[16px] leading-[1.3] font-semibold text-ink">{label}</span>
            {date ? (
              <span className="mt-0.5 block text-[14px] leading-[20px] text-muted">{date}</span>
            ) : null}
            {printed ? (
              /* The rules could not read a date out of this line, so the line itself is what shows. */
              <span className="mt-0.5 block text-[14px] leading-[20px] text-muted">
                {fill(t("card.printed"), { text: printed })}
              </span>
            ) : null}
            {expired ? (
              <span className="mt-1.5 block text-[14px] leading-[1.45] text-ink">{t("plan.expired")}</span>
            ) : countdown ? (
              <span className="mt-1.5 block text-[14px] text-ink">
                <Countdown days={days} template={t("track.daysAfter")} />
              </span>
            ) : null}
          </span>
          <span aria-hidden="true" className="shrink-0 text-[20px] leading-none text-faint">
            ›
          </span>
        </button>

        {available ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 pl-[66px]">
            <button
              type="button"
              onClick={() => {
                add();
                setAdded(true);
              }}
              className={`chunky inline-flex min-h-12 items-center rounded-full border border-ink px-3.5 text-[13px] font-semibold ${
                added ? "bg-ink text-white" : "bg-card text-ink"
              }`}
            >
              {added ? t("companion.added") : t("plan.addToCalendar")}
            </button>
          </div>
        ) : null}
      </section>

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
                <p className="text-[17px] leading-[1.55] text-ink">
                  {fill(t("card.printed"), { text: item.when.trim() })}
                </p>
              ) : null}
              {/* The line itself, exactly as the page printed it. Never script-converted: a quote
                  that has been rewritten is no longer a quote (constitution IV). */}
              {item.source.quote.trim().length > 0 ? (
                <p className="mt-2 text-[16px] leading-[1.55] text-muted">
                  「{item.source.quote.trim()}」
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        {available ? (
          <div className="mt-5 flex flex-col gap-2">
            <ChunkyButton variant="jade" size="lg" fullWidth onClick={add}>
              {t("plan.addToCalendar")}
            </ChunkyButton>
            <p className="px-1 text-center text-[13px] leading-[1.45] text-muted">{note}</p>
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}

/** 「{n} 日之後」 puts the count first, "in {n} days" in the middle; split on the slot either way. */
function Countdown({ days, template }: { days: number; template: string }) {
  const [before, after] = template.split("{n}");
  return (
    <span className="inline-flex items-baseline gap-1">
      {before?.trim() ? <span>{before.trim()}</span> : null}
      <span className="text-[20px] leading-none font-bold">{days}</span>
      {after?.trim() ? <span>{after.trim()}</span> : null}
    </span>
  );
}

function CalendarGlyph() {
  return (
    <svg
      viewBox="0 0 21 21"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.2" y="3.4" width="16.6" height="15.4" rx="3" />
      <path d="M6.4 1.8v3.2M14.6 1.8v3.2M2.2 8.4h16.6" strokeLinecap="round" />
    </svg>
  );
}
