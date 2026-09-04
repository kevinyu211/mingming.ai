"use client";

/**
 * The scrim + `sheetUp` panel behind the language picker, the photo picker and the appointment
 * sheet. Generic: the children are the content.
 *
 * The brief's rule is "one active sheet at a time", so this does not try to stack. It traps focus,
 * closes on Escape and on a scrim tap, locks the body behind it, and gives focus back to whatever
 * opened it — the things a modal has to do to be usable without a mouse, and the things a
 * hand-rolled `position: fixed` div silently skips.
 *
 * It stops above the fixed disclaimer footer rather than running to the bottom edge: the
 * disclaimer has to stay visible on every screen (rules.md section 16), including under a sheet.
 * That is the one departure from the canvas, which draws these flush to the bottom.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/LocaleProvider";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * The sheet's accessible name, and its heading unless `titleHidden`. Required: an `aria-modal`
   * dialog with no name is announced as an unlabelled group.
   */
  title: string;
  /** The quiet line under the title (「明明會用你揀嘅話講同寫」). */
  subtitle?: string;
  /** Keeps `title` as the accessible name but draws no heading, for a sheet with its own layout. */
  titleHidden?: boolean;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  titleHidden = false,
  children,
  className = "",
}: BottomSheetProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Remember what had focus, move focus in, lock the page, and undo all three on close.
  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;

    // Held in a local, not read off the ref in the cleanup: by then React may have detached it.
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousOverflow;
      // Only if focus is still inside the sheet: something else may have claimed it on purpose.
      const active = document.activeElement;
      if (!active || active === document.body || panel?.contains(active)) {
        returnFocusRef.current?.focus?.();
      }
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 bottom-[var(--disclaimer-height)] z-50 flex flex-col justify-end"
      onKeyDown={onKeyDown}
      role="presentation"
    >
      {/*
        A real button, not a div with onClick: tapping outside is the fastest way out of a sheet on
        a phone, and it has to exist for a keyboard too.
      */}
      <button
        type="button"
        aria-label={t("sheet.close")}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(20,17,14,0.34)]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`animate-sheet-up relative max-h-[86%] overflow-y-auto rounded-t-[26px] bg-ground px-[22px] pt-3.5 pb-10 shadow-sheet outline-none ${className}`}
      >
        {/* The grabber. Decoration — the sheet is not draggable, so it gets no label. */}
        <span
          aria-hidden="true"
          className="mx-auto mb-[22px] block h-[5px] w-11 rounded-full bg-[color-mix(in_srgb,var(--ink)_16%,transparent)]"
        />

        {!titleHidden && (
          <h2 className="text-[24px] leading-[1.35] font-bold text-ink">{title}</h2>
        )}
        {!titleHidden && subtitle && (
          <p className="mt-1.5 text-[17px] leading-[1.5] text-muted">{subtitle}</p>
        )}

        <div className={titleHidden ? "" : "mt-5"}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
