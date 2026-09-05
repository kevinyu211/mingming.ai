"use client";

/**
 * 以前嘅 (N) — the read-only history, collapsed by default.
 *
 * The rows are DIVS, not links, and that is the whole point of the screen. An archived sheet's
 * counters were frozen the moment a new sheet was photographed (`lib/sheets/store.ts`), so opening
 * one would show a 跟進 quoting a page nobody is holding any more. 只可以睇 is printed on every row
 * so the reader is told why it does not respond, rather than tapping a dead card and wondering.
 *
 * The canvas fades these rows to 72% opacity. They are drawn at full strength here instead: an
 * archived sheet still names a hospital and a date somebody may need to read, and 72% would take
 * --muted on white from 5.3:1 down to about 2.6:1. The row recedes through its layout and its
 * 只可以睇 label, never through unreadable text.
 */
import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import PageThumb from "@/components/home/PageThumb";
import { fill, formatMonthDay } from "@/components/home/format";
import type { Sheet } from "@/lib/sheets";

export default function OlderSheets({ sheets }: { sheets: Sheet[] }) {
  const { locale, t } = useLocale();
  const [open, setOpen] = useState(false);

  if (sheets.length === 0) return null;

  return (
    <section className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between px-0.5 py-5 text-left"
      >
        <span className="text-[15px] text-muted">{fill(t("home.older"), { n: sheets.length })}</span>
        <span aria-hidden="true" className="text-[20px] leading-none text-faint">
          {open ? "⌃" : "⌄"}
        </span>
      </button>

      {open ? (
        <ul className="flex list-none flex-col gap-2.5 p-0 animate-rise">
          {sheets.map((sheet) => (
            <li
              key={sheet.id}
              className="surface flex items-center gap-3.5 rounded-[18px] p-[18px]"
            >
              <PageThumb size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[16px] leading-[1.3] font-semibold text-ink">{sheet.title}</p>
                <p className="mt-[3px] text-[13px] text-muted">
                  {[formatMonthDay(sheet.capturedAt, locale), t("home.readOnly")]
                    .filter((part) => part.length > 0)
                    .join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
