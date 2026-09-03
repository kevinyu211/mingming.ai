"use client";

/**
 * The honest states, designed rather than apologised for (design.md principle 5).
 *
 * Four of them share one shape — a page-with-a-question-mark mark, a plain title, one plain
 * sentence, and two ways out — because they are all the same moment for the person holding the
 * phone: this did not work, what do I tap now. Each way out is one tap (SC-007).
 *
 *   notASheet        FR-006 / S3: the photo is not a discharge sheet, so no cards at all.
 *   invalidReading   422: the page was a sheet but could not be read into a reading.
 *   modelUnavailable 502 / S10: the reading service is down; the bundled sample still works.
 *   typedText        FR-024's typing fallback, told the truth: this sprint reads photos only,
 *                    so the affordance stays visible and says what it can actually do.
 */
import { useLocale } from "@/components/LocaleProvider";
import type { UiLocale } from "@/lib/i18n/ui";

export type DeclineVariant = "notASheet" | "invalidReading" | "modelUnavailable" | "typedText";

type Copy = Record<UiLocale, string>;

/**
 * Strings that are not in `lib/i18n/ui.ts`. Kept local on purpose: that file is owned elsewhere
 * and is tested against the banned-term list as a whole, so these are written to the same rule
 * (no 診斷/治療/處方/治癒, no 能吃/不能吃, no numbers about the person).
 */
const INVALID_TITLE: Copy = {
  hant: "讀唔到呢張紙",
  hans: "读不到这张纸",
  en: "I couldn't read this sheet",
};
const INVALID_BODY: Copy = {
  hant: "影清楚啲再試多次，或者用示範紙睇下點運作。",
  hans: "拍清楚一点再试一次，或者用示范纸看看怎么用。",
  en: "Try a clearer photo, or open a sample sheet to see how this works.",
};
const UNAVAILABLE_BODY: Copy = {
  hant: "而家連唔到讀紙嗰邊。示範紙照用得，成個流程都睇到。",
  hans: "现在连不上读纸那边。示范纸还是能用，整个流程都看得到。",
  en: "The reading service is not answering right now. The sample sheet still shows the whole flow.",
};
const TYPED_TITLE: Copy = {
  hant: "打字輸入仲未做得到",
  hans: "打字输入还没做好",
  en: "Typing a sheet isn't ready yet",
};
const TYPED_BODY: Copy = {
  hant: "呢個版本淨係讀得到相。影張相，或者用示範紙睇下點運作。",
  hans: "这个版本只读得到照片。拍张照，或者用示范纸看看怎么用。",
  en: "This version only reads photos. Take a photo, or open a sample sheet to see how this works.",
};

export interface DeclineStateProps {
  variant: DeclineVariant;
  /** "再影一次" — omitted when there is nothing to retake. */
  onRetake?: () => void;
  /** "用示範紙" — always offered: it is the fallback every failure path lands on (FR-024). */
  onSample?: () => void;
  className?: string;
}

export default function DeclineState({
  variant,
  onRetake,
  onSample,
  className = "",
}: DeclineStateProps) {
  const { locale, t } = useLocale();

  const title =
    variant === "notASheet"
      ? t("notASheet.title")
      : variant === "invalidReading"
        ? INVALID_TITLE[locale]
        : variant === "modelUnavailable"
          ? t("fallback.modelUnavailable")
          : TYPED_TITLE[locale];

  const body =
    variant === "notASheet"
      ? t("notASheet.body")
      : variant === "invalidReading"
        ? INVALID_BODY[locale]
        : variant === "modelUnavailable"
          ? UNAVAILABLE_BODY[locale]
          : TYPED_BODY[locale];

  const retakeLabel = variant === "typedText" ? t("capture.camera") : t("capture.retake");

  return (
    <section
      aria-labelledby="decline-title"
      className={`flex flex-col items-center px-4 py-6 text-center ${className}`}
    >
      <BlankSheet />
      <h2
        id="decline-title"
        className="mt-[30px] text-[26px] leading-[1.3] font-bold tracking-[-0.4px] text-ink"
      >
        {title}
      </h2>
      <p className="mt-3 text-body leading-[1.65] text-muted">{body}</p>

      <div className="mt-[30px] flex w-full flex-col gap-2.5">
        {onRetake ? (
          <button
            type="button"
            onClick={onRetake}
            className="tap h-[54px] w-full gap-2 rounded-full bg-accent px-4 text-body font-semibold text-accent-ink shadow-raised"
          >
            <CameraGlyph />
            {retakeLabel}
          </button>
        ) : null}
        {onSample ? (
          <button
            type="button"
            onClick={onSample}
            className="tap h-[54px] w-full rounded-full bg-card px-4 text-body font-semibold text-ink shadow-card"
          >
            {t("capture.sample")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A blank sheet, hatched, with a question mark where the words should be: this did not read as a
 * discharge sheet. An illustration rather than an error icon (design.md principle 5).
 */
function BlankSheet() {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-[178px] w-[138px] items-center justify-center rounded-[14px] border-2 border-hairline bg-card"
    >
      <span
        className="absolute inset-0 rounded-[12px]"
        style={{
          background:
            "repeating-linear-gradient(135deg, color-mix(in srgb, var(--card-border) 35%, transparent) 0 6px, transparent 6px 14px)",
        }}
      />
      <svg
        viewBox="0 0 24 24"
        focusable="false"
        className="relative h-[52px] w-[52px] text-faint"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9.3 9.2a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.2 1-1.2 1.9v.5" />
        <circle cx="12" cy="17.6" r=".8" fill="currentColor" />
      </svg>
    </div>
  );
}

/** A camera, rounded 2 px stroke, no medical symbols (design.md 3). */
function CameraGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}
