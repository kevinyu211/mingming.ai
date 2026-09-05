"use client";

/**
 * The reading screen (Companion D): the photograph inside the dark card, a ring filling over it,
 * and one line saying which half of the job the reader is watching.
 *
 * Two things here are true and one is an estimate, and the screen is honest about which is which.
 * The photograph is the page that was sent. The line switches from 「讀緊 N 頁…」 to 「用簡單嘅話
 * 講。」 on a real event — the first card arriving from `/api/read`, which is the moment the model
 * has finished looking and started writing. The ring is a guess at how far along that is: it
 * climbs on a clock calibrated to how long a page takes, leaps forward when writing starts, and
 * never claims to be finished until the stream is. It is a mood, not a measurement, and the number
 * in it is there because a card that visibly moves is what stops a reader from tapping again.
 *
 * Nothing on this screen says anything about the sheet. The app has not read it yet.
 */
import { useEffect, useState } from "react";
import { useT } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import { fill } from "@/components/home/format";

export type ReadPhase = "reading" | "writing";

/** About how long one page takes on the deployed model, with a floor for the fixed cost of a call. */
const BASE_MS = 12_000;
const PER_PAGE_MS = 14_000;
/** The ring never reaches these on its own; only the stream ending does. */
const READING_CAP = 62;
const WRITING_CAP = 94;
const RING = 2 * Math.PI * 42;

function estimate(elapsed: number, pageCount: number, phase: ReadPhase): number {
  const expected = BASE_MS + PER_PAGE_MS * Math.max(1, pageCount);
  // Ease-out toward the cap: fast at first, then slower, never arriving.
  const curve = 1 - Math.exp(-elapsed / (expected / 1.8));
  if (phase === "writing") return Math.min(WRITING_CAP, Math.max(READING_CAP, READING_CAP + curve * (WRITING_CAP - READING_CAP)));
  return Math.min(READING_CAP, curve * READING_CAP);
}

export default function ReadingProgress({
  pageCount,
  line = null,
  phase = "reading",
  pageImage = null,
}: {
  pageCount: number;
  /** What 明明 is saying while he reads — a fixed line from `lib/i18n/ui.ts`, never a claim about the sheet. */
  line?: string | null;
  /** `writing` once the first card has arrived. */
  phase?: ReadPhase;
  /** The first page, as a data URL, shown inside the card. Null on the sample path. */
  pageImage?: string | null;
}) {
  const t = useT();
  const [startedAt] = useState(() => Date.now());
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const tick = () => setPercent(Math.round(estimate(Date.now() - startedAt, pageCount, phase)));
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [pageCount, phase, startedAt]);

  const overlayLine =
    phase === "writing" ? t("reading.writing") : fill(t("reading.scanning"), { n: Math.max(1, pageCount) });

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
          role="status"
          aria-live="polite"
          className="animate-fade-up absolute inset-0 flex flex-col items-center justify-center gap-4 text-white"
          style={{ background: "rgba(19,19,19,.88)" }}
        >
          <span className="relative grid h-24 w-24 place-items-center">
            <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full" aria-hidden="true">
              <circle cx="48" cy="48" r="42" fill="none" stroke="#2F2F2F" strokeWidth="2" />
              <circle
                cx="48"
                cy="48"
                r="42"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${(percent / 100) * RING} ${RING}`}
                transform="rotate(-90 48 48)"
                style={{ transition: "stroke-dasharray .5s ease" }}
              />
            </svg>
            <span className="text-[22px] font-bold">{percent}%</span>
          </span>
          <p className="px-6 text-[17px] leading-[24px] font-semibold">{overlayLine}</p>
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
    </div>
  );
}
