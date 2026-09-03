"use client";

/**
 * S8 — the plan, as two grouped lists.
 *
 * Every row is the same three facts in the same order: what kind of item it is, what the sheet
 * called it, and **the sheet's own words for when** — "2/52", "BD with meals", 每日一次. That
 * right-hand column is set in the dose treatment and is never converted between scripts, never
 * translated and never normalised into a date, because FR-020 requires every date and time on
 * the plan to come from a source line and FR-003's "exactly" applies to the plan too.
 *
 * The kind moved from a heading inside each row to the group label above the card (design canvas
 * S8, an iOS grouped list) and stays on the row for a screen reader, so a row read on its own
 * still says what it is. The footnote under each group says in words what the typography is
 * trying to say: none of this was rewritten.
 *
 * The quote link is the same affordance as on a card (constitution principle IV: everything
 * traces to a line), and it opens the same `SourceSheet`, so the plan and the reading cannot
 * drift into two different ideas of what "from the page" means.
 */
import { useCallback, useState } from "react";
import SourceSheet from "@/components/SourceSheet";
import { useLocale } from "@/components/LocaleProvider";
import type { UiLocale } from "@/lib/i18n/ui";
import type { PlanItem } from "@/lib/storage/local";

/** Copy with no key in `lib/i18n/ui.ts`. Same rules as everything there (design.md section 6). */
const LOCAL: Record<"appointmentNote" | "medicineNote", Record<UiLocale, string>> = {
  appointmentNote: {
    hant: "照張紙寫嘅字，冇改過。",
    hans: "照纸上写的字，没有改过。",
    en: "Copied from the sheet, word for word.",
  },
  medicineNote: {
    hant: "冇自己編過時間，張紙寫幾多次就係幾多次。",
    hans: "没有自己编时间，纸上写多少次就是多少次。",
    en: "No timetable was invented. It says what the sheet says.",
  },
};

export interface PlanListProps {
  items: PlanItem[];
  /** Shows the confirmed mark above the groups. Absent while the list is still a draft. */
  confirmedLabel?: string;
}

interface Row {
  item: PlanItem;
  /** Position in the original `items` array, so the open source sheet is unambiguous. */
  index: number;
}

export default function PlanList({ items, confirmedLabel }: PlanListProps) {
  const { locale, t } = useLocale();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const close = useCallback(() => setOpenIndex(null), []);

  const rows: Row[] = items.map((item, index) => ({ item, index }));
  const groups = [
    {
      kind: "appointment" as const,
      label: t("plan.appointment"),
      note: LOCAL.appointmentNote[locale],
      rows: rows.filter(({ item }) => item.kind === "appointment"),
    },
    {
      kind: "medicineTime" as const,
      label: t("plan.medicineTime"),
      note: LOCAL.medicineNote[locale],
      rows: rows.filter(({ item }) => item.kind === "medicineTime"),
    },
  ].filter((group) => group.rows.length > 0);

  return (
    <div className="mt-4 flex flex-col gap-5">
      {confirmedLabel ? (
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-chip px-3 py-1.5 text-fine font-semibold text-accent">
          {/* Colour is never the only signal (design.md section 7): a glyph and a word. */}
          <Tick />
          {confirmedLabel}
        </p>
      ) : null}

      {groups.map((group) => (
        <section key={group.kind}>
          <h2 className="mb-2 ml-1 text-fine font-semibold text-muted">{group.label}</h2>

          <ul className="surface overflow-hidden" role="list">
            {group.rows.map(({ item, index }, position) => (
              <li key={`${item.kind}-${index}-${item.label}`}>
                {/* The iOS divider: inset from the left so the group reads as one card. */}
                {position > 0 ? <div aria-hidden="true" className="ml-[18px] h-px bg-hairline" /> : null}

                <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-[18px]">
                  <div className="min-w-0 flex-1">
                    {/* Said once per row for anyone reading it out of the group's context. */}
                    <span className="sr-only">{group.label}</span>
                    <p
                      className={`text-body font-semibold break-words text-ink ${
                        item.kind === "medicineTime" ? "dose" : ""
                      }`}
                    >
                      {item.label}
                    </p>
                  </div>

                  {/* Verbatim. "2/52" stays "2/52"; nothing here is turned into a calendar date. */}
                  <span className="dose max-w-[42%] shrink-0 text-right text-body break-words text-muted">
                    {item.when}
                  </span>

                  {item.source.quote.trim().length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setOpenIndex(index)}
                      aria-haspopup="dialog"
                      aria-label={`${t("card.sourceLink")}：${item.label}`}
                      className="tap shrink-0 rounded-full text-accent"
                    >
                      <QuoteMark />
                    </button>
                  ) : (
                    <span className="w-3 shrink-0" aria-hidden="true" />
                  )}
                </div>

                {openIndex === index ? (
                  <SourceSheet
                    source={item.source}
                    cardTitle={`${group.label}：${item.label}`}
                    onClose={close}
                  />
                ) : null}
              </li>
            ))}
          </ul>

          <p className="mt-2 ml-1 text-fine text-muted">{group.note}</p>
        </section>
      ))}
    </div>
  );
}

function Tick() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.5 12 13 4" />
    </svg>
  );
}

function QuoteMark() {
  return (
    <svg
      viewBox="0 0 24 16"
      aria-hidden="true"
      focusable="false"
      className="h-3 w-[17px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 13c0-5 2-8.5 6-10M11 13c0-5 2-8.5 6-10" />
    </svg>
  );
}
