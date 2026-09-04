"use client";

/**
 * 跟緊呢張紙 — the strip at the top of 跟進 that names the sheet it is following.
 *
 * This is the piece that makes the whole tab honest. 跟進 is not a global list of medicines: it is
 * *this* sheet's medicines, *this* sheet's appointment, *this* sheet's warning signs (brief §1). A
 * counter that said 「張紙寫：每日兩次」 without naming which paper it was quoting would stop being
 * true the moment a second sheet was photographed, so the paper is named at the top and taps
 * straight back into its own conversation.
 */
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import PageThumb from "@/components/home/PageThumb";
import { formatMonthDay } from "@/components/home/format";
import type { Sheet } from "@/lib/sheets";

export default function SheetStrip({ sheet }: { sheet: Sheet }) {
  const { locale, t } = useLocale();
  const date = formatMonthDay(sheet.capturedAt, locale);

  return (
    <Link
      href="/chat"
      className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-neutral px-[18px] py-4 no-underline"
    >
      <PageThumb size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium text-muted">{t("track.following")}</span>
        <span className="mt-0.5 block text-[18px] leading-[1.4] font-medium text-ink">
          {[sheet.title, date].filter((part) => part.length > 0).join(" · ")}
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-[20px] leading-none text-faint">
        ›
      </span>
    </Link>
  );
}
