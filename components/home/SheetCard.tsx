"use client";

/**
 * 傾緊呢張 — the one active sheet, as a card that opens its own thread.
 *
 * Three facts and no more: what the sheet is called, when it was photographed with how much is on
 * it, and where the conversation got to. Every one of them is derived by rule from the stored
 * sheet — `title` by `lib/sheets/title.ts`, the counts off the reading, the preview off
 * `briefing.phase` — so nothing on this card can be a model turn's idea of what the page said.
 *
 * **`pageCount === 0` means a sheet migrated from before v2**, when the page count was never
 * recorded. The 「N 頁」 chip is omitted outright rather than printed as 「1 頁」: the store refused
 * to invent a page count for a medical document and this card is not the place to invent one back.
 */
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import PageThumb from "@/components/home/PageThumb";
import { fill, formatMonthDay } from "@/components/home/format";
import type { Sheet } from "@/lib/sheets";

const DOT = " · ";

export default function SheetCard({ sheet }: { sheet: Sheet }) {
  const { locale, t } = useLocale();

  const meta = [
    formatMonthDay(sheet.capturedAt, locale),
    sheet.pageCount > 0 ? fill(t("home.pages"), { n: sheet.pageCount }) : "",
    fill(t("home.medicines"), { n: sheet.reading.medicines.length }),
  ]
    .filter((part) => part.length > 0)
    .join(DOT);

  const preview =
    sheet.briefing.phase === "idle"
      ? t("home.chatNotStarted")
      : sheet.briefing.phase === "end"
        ? t("home.chatDone")
        : t("home.chatPartway");

  return (
    <Link
      href="/chat"
      className="surface flex min-h-12 w-full items-center gap-4 rounded-[20px] p-5 no-underline"
    >
      <PageThumb size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block text-[22px] leading-[1.35] font-bold text-ink">{sheet.title}</span>
        <span className="mt-1 block text-[18px] leading-[1.5] text-muted">{meta}</span>
        <span className="mt-2 block text-[16px] leading-[1.5] text-muted">{preview}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-[22px] leading-none text-faint">
        ›
      </span>
    </Link>
  );
}
