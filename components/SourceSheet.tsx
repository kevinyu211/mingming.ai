"use client";

/**
 * S5 — the line on the page a card came from.
 *
 * Constitution principle IV: everything traces to a line, and the user must be able to see it.
 * So this is part of the card anatomy, not a menu item, and it shows the quote **verbatim**:
 * English stays English, simplified stays simplified, nothing is run through `toScript` and
 * nothing is rephrased. Close is the only action — there is nothing to edit about the page.
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
        className="absolute inset-0 bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-sheet-title"
        style={{ boxShadow: "0 -10px 34px color-mix(in srgb, var(--ink) 20%, transparent)" }}
        className="relative max-h-[80vh] overflow-y-auto rounded-t-[26px] bg-card px-[22px] pt-3 pb-[calc(1.875rem+env(safe-area-inset-bottom))]"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-[18px] h-[5px] w-10 rounded-full bg-card-border"
        />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="source-sheet-title" className="text-card-title font-bold text-ink">
              {t("source.title")}
            </h2>
            <p className="mt-0.5 text-meta text-muted">{cardTitle}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("source.close")}
            className="tap -mr-[7px] shrink-0"
          >
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-panel text-muted">
              <CrossMark />
            </span>
          </button>
        </div>

        {/* Verbatim. Never converted, never translated, never trimmed of its own wording. */}
        <blockquote className="mt-[18px] rounded-[14px] border-l-[3px] border-accent bg-soft p-[18px]">
          <dl className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] tracking-[0.2px] text-muted">
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
