"use client";

/**
 * S5 — the line on the page a card came from.
 *
 * Constitution principle IV: everything traces to a line, and the user must be able to see it.
 * So this is part of the card anatomy, not a menu item, and it shows the quote **verbatim**:
 * English stays English, simplified stays simplified, nothing is run through `toScript` and
 * nothing is rephrased. Close is the only action — there is nothing to edit about the page.
 *
 * v2: restyled onto the new tokens and shaped like the other bottom sheets. Behaviour is
 * deliberately untouched — this component is how principle IV stays visible, so the quote, its
 * section and its line number are still the whole content, and nothing here filters or trims them.
 * The quote itself went UP a step in contrast (--ink on --neutral-2, 13.41:1) and the section/line
 * meta went from 12px to 15px: it names which line you are looking at, so it is information, not
 * furniture, and 12px grey is not something a seventy-year-old reads.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/LocaleProvider";
import type { SourceReference } from "@/lib/domain/schemas";

export interface SourceSheetProps {
  source: SourceReference;
  /** The card this came from, announced with the sheet so the context is not lost. */
  cardTitle: string;
  onClose: () => void;
}

export default function SourceSheet({ source, cardTitle, onClose }: SourceSheetProps) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const lineLabel =
    source.lineIndex === null ? t("source.lineUnknown") : String(source.lineIndex + 1);

  // Portalled to the body on purpose: a card in the middle of its arrival animation is a
  // containing block for `position: fixed`, which would strand this sheet inside the card.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      // Stops above the disclaimer footer, which stays visible on every screen (rules.md 16).
      className="fixed inset-x-0 top-0 bottom-[var(--disclaimer-height)] z-50 flex flex-col justify-end"
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <button
        type="button"
        aria-label={t("source.close")}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(20,17,14,0.34)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-sheet-title"
        className="animate-sheet-up relative max-h-[80vh] overflow-y-auto rounded-t-[26px] bg-ground px-[22px] pt-3.5 pb-[calc(1.875rem+env(safe-area-inset-bottom))] shadow-sheet"
      >
        <span
          aria-hidden="true"
          className="mx-auto mb-[22px] block h-[5px] w-11 rounded-full bg-[color-mix(in_srgb,var(--ink)_16%,transparent)]"
        />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="source-sheet-title"
              className="text-[24px] leading-[1.35] font-bold text-ink"
            >
              {t("source.title")}
            </h2>
            <p className="mt-1 text-[17px] leading-[1.5] text-muted">{cardTitle}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("source.close")}
            className="tap -mr-[7px] shrink-0"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral text-muted">
              <CrossMark />
            </span>
          </button>
        </div>

        {/*
          Verbatim. Never converted, never translated, never trimmed of its own wording.
          `--neutral-2` is the same fill as the 「張紙寫：」 quote block on the dose cards, on
          purpose: quoted page text looks like quoted page text everywhere in the app.
        */}
        <blockquote className="mt-[18px] rounded-[16px] border-l-[3px] border-jade bg-neutral-2 p-[18px]">
          <dl className="flex flex-wrap items-baseline gap-x-1.5 text-meta text-muted">
            <dt className="sr-only">{t("source.section")}</dt>
            <dd className="break-words">{source.section || "—"}</dd>
            <dt className="before:mr-1.5 before:content-['·']">{t("source.line")}</dt>
            <dd className="break-words">{lineLabel}</dd>
          </dl>
          <p className="dose mt-2.5 text-[21px] leading-[1.45] font-medium break-words whitespace-pre-wrap text-ink">
            {source.quote.trim().length > 0 ? source.quote : t("card.unreadableBody")}
          </p>
        </blockquote>
      </div>
    </div>,
    document.body,
  );
}

function CrossMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
