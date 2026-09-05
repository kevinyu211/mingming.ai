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
      <Mascot size={92} state="speaking" />
      <h1 className="text-display font-bold text-ink">{t("reading.title")}</h1>
      {pageCount > 0 ? (
        <p className="text-body text-muted">
          {t(pageCount > 2 ? "reading.metaLong" : "reading.meta").replace("{n}", String(pageCount))}
        </p>
      ) : null}
      <p className="text-meta text-muted">{t("progress.note")}</p>
      {line ? (
        <p
          role="status"
          className="surface mt-2 max-w-xs rounded-[18px] px-5 py-4 text-[17px] leading-[1.5] text-ink"
        >
          {line}
        </p>
      ) : null}
    </div>
  );
}
