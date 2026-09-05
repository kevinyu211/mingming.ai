"use client";

/**
 * The transitional screen while `/api/read` streams (v2 build brief §7).
 *
 * It says what is happening and how long it takes, and nothing else. No progress bar that can lie
 * about a stream whose length is unknown, and no reassurance about what the sheet will say — the
 * app has not read it yet. 明明 at 92 is the only thing moving.
 *
 * The page count comes from the pages actually being sent. When it is unknown the line is dropped
 * rather than guessed, because 「1 頁」 on a four-page discharge would be a claim about a medical
 * document (constitution IV).
 */
import { useT } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";

export default function ReadingProgress({
  pageCount,
  line = null,
}: {
  pageCount: number;
  /** What 明明 is saying while he reads — a fixed line from `lib/i18n/ui.ts`, never a claim about the sheet. */
  line?: string | null;
}) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      {/* The design's dark card over the photograph: a ring that turns, and one line under it. */}
      <div className="ceremony flex h-[200px] w-[200px] flex-col items-center justify-center gap-4 rounded-[24px]">
        <span aria-hidden="true" className="relative grid h-[84px] w-[84px] place-items-center">
          <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full animate-spin [animation-duration:1.6s]">
            <circle cx="48" cy="48" r="42" fill="none" stroke="#2F2F2F" strokeWidth="2" />
            <circle
              cx="48"
              cy="48"
              r="42"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="70 194"
            />
          </svg>
          <Mascot size={44} state="speaking" />
        </span>
        {pageCount > 0 ? (
          <p className="px-4 text-[13px] text-on-dark-muted">
            {t(pageCount > 2 ? "reading.metaLong" : "reading.meta").replace("{n}", String(pageCount))}
          </p>
        ) : null}
      </div>
      <h1 className="text-[26px] leading-[32px] text-ink">{t("reading.title")}</h1>
      <p className="text-[15px] text-muted">{t("progress.note")}</p>
      {line ? (
        <p
          role="status"
          className="surface mt-1 max-w-xs px-5 py-4 text-[17px] leading-[1.5] text-ink"
        >
          {line}
        </p>
      ) : null}
    </div>
  );
}
