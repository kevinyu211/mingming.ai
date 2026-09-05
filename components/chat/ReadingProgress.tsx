"use client";

/**
 * The reading screen (Companion D): the photograph inside the dark card, elapsed time, and one
 * line saying which stage of the job the reader is watching.
 *
 * The stage changes on actual submission, model, and checking events from `/api/read`. Elapsed
 * seconds show waiting without pretending to know how much model work remains.
 *
 * Nothing on this screen says anything about the sheet until the sheet says it: the one thing
 * shown before the reading lands is a warning sign whose line `/api/read` has already completed
 * and checked, handed over ahead of the rest so the red flags are not the last thing heard.
 */
import { useEffect, useState } from "react";
import { useT } from "@/components/LocaleProvider";
import ChunkyButton from "@/components/ChunkyButton";
import type { ReadProgressPhase } from "@/lib/domain/read-policy";
import Mascot from "@/components/Mascot";
import { fill } from "@/components/home/format";

export default function ReadingProgress({
  pageCount,
  line = null,
  phase = "submitting",
  pageImage = null,
  warnings = [],
  onCancel,
}: {
  pageCount: number;
  /** What 明明 is saying while he reads — a fixed line from `lib/i18n/ui.ts`, never a claim about the sheet. */
  line?: string | null;
  /** A stage reported by the read route. */
  phase?: ReadProgressPhase;
  /** The first page, as a data URL, shown inside the card. Null on the sample path. */
  pageImage?: string | null;
  /** Warning signs already streamed ahead of the reading, in the reader's script, in page order. */
  warnings?: string[];
  onCancel: () => void;
}) {
  const t = useT();
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [pageCount, phase, startedAt]);

  const overlayLine = phase === "submitting"
    ? t("reading.submitting")
    : phase === "checking"
      ? t("reading.checking")
      : fill(t("reading.scanning"), { n: Math.max(1, pageCount) });

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <div
        className="relative w-full max-w-[300px] overflow-hidden rounded-[24px] bg-ink"
        style={{ aspectRatio: "0.8" }}
      >
        {/* The page that was sent, tilted the way the artboard tilts it. */}
        {pageImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL that stays on the phone
          <img
            src={pageImage}
            alt=""
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 w-[72%] -translate-x-1/2 -translate-y-1/2 -rotate-[1.5deg] rounded-[4px] object-cover"
            style={{ aspectRatio: "0.72", boxShadow: "0 18px 40px rgba(0,0,0,.5)" }}
          />
        ) : (
          <span className="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center">
            <Mascot size={92} state="speaking" />
          </span>
        )}
        <div className="absolute inset-[18px] rounded-[14px] border-[1.5px] border-white/35" />

        <div
          className="animate-fade-up absolute inset-0 flex flex-col items-center justify-center gap-4 text-white"
          style={{ background: "rgba(19,19,19,.88)" }}
        >
          <span className="relative grid h-24 w-24 place-items-center rounded-full border-2 border-white/30">
            <span className="text-[18px] font-semibold">{Math.floor(elapsed / 1000)}s</span>
          </span>
          <p role="status" aria-live="polite" className="px-6 text-[17px] leading-[24px] font-semibold">{overlayLine}</p>
        </div>
      </div>

      <h1 className="text-[26px] leading-[32px] text-ink">{t("reading.title")}</h1>
      {pageCount > 0 ? (
        <p className="text-[15px] text-muted">
          {t(pageCount > 2 ? "reading.metaLong" : "reading.meta").replace("{n}", String(pageCount))}
        </p>
      ) : null}
      <p className="text-[15px] text-muted">{t("progress.note")}</p>
      {line ? (
        <p role="status" className="surface mt-1 max-w-xs px-5 py-4 text-[17px] leading-[1.5] text-ink">
          {line}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <ol
          role="status"
          aria-live="polite"
          className="mt-1 w-full max-w-xs list-decimal rounded-[18px] bg-warn-bg px-5 py-4 pl-9 text-left text-[17px] leading-[1.5] font-medium text-warn-ink"
        >
          {warnings.map((warning, i) => (
            <li key={i} className="whitespace-pre-line">{warning}</li>
          ))}
        </ol>
      ) : null}
      {elapsed >= 30_000 ? <p className="text-[15px] text-muted">{t("reading.slow")}</p> : null}
      <ChunkyButton type="button" variant="tinted" className="mt-1" onClick={onCancel}>
        {t("reading.cancel")}
      </ChunkyButton>
    </div>
  );
}
