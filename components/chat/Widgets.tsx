"use client";

/**
 * The widgets 明明 hands you inside the conversation (Companion D, "Three Things").
 *
 *   summary  the dark card: what is on the page, in three numbers
 *   pills    the medicine checklist — tap a slot when a dose is taken
 *   visits   the follow-up rows with 加入日曆
 *   flags    the numbered warning signs and the hospital's own contact line
 *
 * Every number here is a rule's number and every sentence is the page's own or a fixed template.
 * The checklist counts times remaining today off `lib/rules/doses.ts` and never shows a clock
 * time; the visit tile shows a date only when `plan.followUpDate` parsed; the warning list is the
 * reading's own signs, so it carries the AI chip. Nothing in this file calls a model.
 *
 * Widgets read the LIVE sheet (`sheet` is the active one, not a snapshot in the message), so a
 * dose logged on 今日 is already ticked in the thread when the reader scrolls back up.
 */
import { useState } from "react";
import AiLabel from "@/components/AiLabel";
import { useLocale } from "@/components/LocaleProvider";
import { fill, formatYmd } from "@/components/home/format";
import DoseSlots from "@/components/track/DoseSlots";
import { useAddToCalendar } from "@/components/track/useAddToCalendar";
import type { StoredReading } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";
import { doseTargets, remaining } from "@/lib/rules/doses";
import type { DraftPlan } from "@/lib/rules/plan-from-reading";
import type { Sheet, ThreadWidget } from "@/lib/sheets/types";

export interface WidgetContext {
  sheet: Sheet;
  /** One clock per mount, passed down exactly as the rules take it. */
  today: Date;
  /** Converts app copy and page bodies into the reader's script. Never applied to a quote. */
  display: (text: string) => string;
  onTake: (key: string) => void;
}

export function ThreadWidgetView({
  widget,
  ctx,
}: {
  widget: ThreadWidget | null | undefined;
  ctx: WidgetContext;
}) {
  if (!widget) return null;
  switch (widget) {
    case "summary":
      return <SummaryWidget sheet={ctx.sheet} />;
    case "pills":
      return <PillsWidget sheet={ctx.sheet} today={ctx.today} onTake={ctx.onTake} />;
    case "visits":
      return <VisitsWidget plan={ctx.sheet.plan} reading={ctx.sheet.reading} />;
    case "flags":
      return <FlagsWidget reading={ctx.sheet.reading} display={ctx.display} />;
  }
}

/* ------------------------------------------------------------------ summary */

const TAG: Record<UiLocale, string> = { hant: "zh-HK", hans: "zh-CN", en: "en-GB" };

/** 「18/9」 from "YYYY-MM-DD", read as a local calendar date. "" when it is not a date. */
function shortDay(ymd: string | null, locale: UiLocale): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(TAG[locale], { day: "numeric", month: "numeric" }).format(
    new Date(y, m - 1, d),
  );
}

export function SummaryWidget({ sheet }: { sheet: Sheet }) {
  const { locale, t } = useLocale();
  const medicines = sheet.reading.medicines.length;
  const warnings = sheet.reading.warningSigns.length;
  const visit = shortDay(sheet.plan.followUpDate, locale);

  return (
    <div className="ceremony p-[18px]">
      <p className="text-[11px] font-medium tracking-[1.3px] text-on-dark-muted uppercase">
        {t("companion.whatSheetSays")}
      </p>
      <p className="mt-2 text-[18px] leading-[26px] font-semibold">{sheet.title}</p>
      <div className="mt-4 flex gap-2">
        <Stat value={String(medicines)} label={t("companion.statMeds")} />
        <Stat value={String(warnings)} label={t("companion.statWarnings")} />
        <Stat
          value={visit || t("companion.statNone")}
          label={t("companion.statVisit")}
          small={!visit}
        />
      </div>
    </div>
  );
}

function Stat({ value, label, small = false }: { value: string; label: string; small?: boolean }) {
  return (
    <div className="flex-1 rounded-[12px] bg-charcoal-elevated px-2 py-2.5 text-center">
      <p className={`leading-[24px] font-bold ${small ? "text-[12px]" : "text-[20px]"}`}>{value}</p>
      <p className="mt-0.5 text-[10px] font-medium tracking-[1px] text-on-dark-muted uppercase">
        {label}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- pills */

export function PillsWidget({
  sheet,
  today,
  onTake,
}: {
  sheet: Sheet;
  today: Date;
  onTake: (key: string) => void;
}) {
  const { t } = useLocale();
  const targets = doseTargets(sheet.reading);
  if (targets.length === 0) return null;

  const countable = targets.filter((x) => !x.stopped && !x.asNeeded && x.total > 0);
  const total = countable.reduce((sum, x) => sum + x.total, 0);
  const left = countable.reduce((sum, x) => sum + remaining(x, sheet.doses[x.key], today), 0);

  return (
    <div className="surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[17px] font-bold text-ink">{t("track.todayMeds")}</p>
        {total > 0 ? (
          <p className="text-[13px] text-muted">
            {left > 0 ? fill(t("dose.left"), { n: left }) : t("dose.done")}
          </p>
        ) : null}
      </div>
      <ul className="mt-3.5 flex list-none flex-col gap-3.5 p-0">
        {targets.map((target) => (
          <li key={target.key}>
            <p className="dose text-[15px] leading-[1.3] font-semibold text-ink">{target.name}</p>
            {/* The page's own words, verbatim, behind 「張紙寫：」 — never rewritten. */}
            <p className="mt-0.5 text-[13px] leading-[1.45] text-muted">
              {target.printed
                ? fill(t("card.printed"), { text: target.printed })
                : t("card.missingFrequency")}
            </p>
            <div className="mt-2">
              <DoseSlots
                target={target}
                state={sheet.doses[target.key]}
                today={today}
                onTake={onTake}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------- visits */

export function VisitsWidget({ plan, reading }: { plan: DraftPlan; reading: StoredReading }) {
  const { locale, t } = useLocale();
  const { available, add, note } = useAddToCalendar(plan, reading);
  const [added, setAdded] = useState(false);

  const appointments = plan.items.filter((item) => item.kind === "appointment");
  if (appointments.length === 0) return null;

  const parsed = plan.followUpDate;
  const long = parsed ? formatYmd(parsed, locale) : "";
  const tile = parsed ? dayTile(parsed, locale) : null;

  return (
    <div className="flex flex-col gap-2">
      {appointments.map((item, index) => (
        <div key={index} className="surface flex items-start gap-3.5 p-4">
          {/* The date tile exists only for the one date the rules could read. */}
          {index === 0 && tile ? (
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
          <div className="min-w-0 flex-1">
            <p className="text-[16px] leading-[1.3] font-semibold text-ink">
              {item.label.trim().length > 0 ? item.label : t("plan.appointment")}
            </p>
            <p className="mt-0.5 text-[14px] leading-[20px] text-muted">
              {index === 0 && long
                ? long
                : item.when.trim().length > 0
                  ? fill(t("card.printed"), { text: item.when.trim() })
                  : t("companion.statNone")}
            </p>
            {index === 0 && available ? (
              <button
                type="button"
                onClick={() => {
                  add();
                  setAdded(true);
                }}
                className={`chunky mt-2.5 inline-flex min-h-12 items-center rounded-full border border-ink px-3.5 text-[13px] font-semibold ${
                  added ? "bg-ink text-white" : "bg-card text-ink"
                }`}
              >
                {added ? t("companion.added") : t("plan.addToCalendar")}
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {available ? <p className="px-1 text-[12px] leading-[1.45] text-muted">{note}</p> : null}
    </div>
  );
}

function dayTile(ymd: string, locale: UiLocale): { month: string; day: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return {
    month: new Intl.DateTimeFormat(TAG[locale], { month: "short" }).format(date),
    day: String(d),
  };
}

/* -------------------------------------------------------------------- flags */

/** Digits with the spaces and dashes a printed phone number carries. Seven or more, so a date does not match. */
const PHONE = /(\+?\d[\d\s-]{6,}\d)/;

export function FlagsWidget({
  reading,
  display,
}: {
  reading: StoredReading;
  display: (text: string) => string;
}) {
  const { dialect, t } = useLocale();
  const signs = reading.warningSigns ?? [];
  if (signs.length === 0) return null;

  const contact = reading.hospitalContact?.text?.trim() ?? "";
  const phone = contact.match(PHONE)?.[1]?.trim() ?? null;

  return (
    <div className="surface p-4">
      <p className="text-[17px] leading-[24px] font-bold text-ink">{t("brief.warnTitle")}</p>
      <ol className="mt-2 flex list-none flex-col p-0">
        {signs.map((sign, index) => (
          <li
            key={index}
            className="flex items-start gap-3 border-b border-hairline py-2.5 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className="mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-ink text-[11px] font-bold text-ink"
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] leading-[22px] text-ink">
                {display(sign.symptom[dialect])}
              </span>
              <span className="mt-0.5 block text-[13px] leading-[18px] text-muted">
                {display(sign.action[dialect])}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {/* The hospital's own line, exactly as printed. A number in it is tappable; nothing is invented. */}
      {contact ? (
        phone ? (
          <a
            href={`tel:${phone.replace(/[\s-]+/g, "")}`}
            className="mt-3.5 flex min-h-12 items-center justify-center gap-2 rounded-full bg-ink px-4 text-[15px] font-semibold text-white no-underline"
          >
            <PhoneGlyph />
            <span className="truncate">{contact}</span>
          </a>
        ) : (
          <p className="mt-3.5 rounded-[14px] bg-neutral-2 px-4 py-3 text-[14px] leading-[1.45] text-ink">
            <span className="text-muted">{t("companion.contact")} · </span>
            {contact}
          </p>
        )
      ) : null}

      <div className="mt-3">
        <AiLabel />
      </div>
    </div>
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

function PhoneGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1.1 1A16 16 0 0 1 4 5.1 1 1 0 0 1 5 4z" />
    </svg>
  );
}
