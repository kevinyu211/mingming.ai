"use client";

/**
 * The sheet that stands between a tap and something irreversible (design.md S9, and the
 * component inventory's "Confirm sheet (delete)").
 *
 * An iOS action sheet, as drawn on the canvas: two translucent blocks over a scrim, the
 * destructive choice grouped with the sentence that explains it, and cancel on its own as the
 * bigger, bolder, easier thing to hit. Portalled to the body, `role="dialog"`, Escape and the
 * scrim both cancel, and focus lands on **cancel**, not on confirm.
 *
 * The destructive row is `--danger`, the palette's one red, used nowhere else. design.md's ban on
 * red is a ban on red as a verdict about a person; this is a verdict about a button.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface ConfirmSheetProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      // Stops above the disclaimer footer, which stays visible on every screen (rules.md 16).
      // The footer measures and publishes its own height, so this is right in every locale.
      className="fixed inset-x-0 top-0 bottom-[var(--disclaimer-height)] z-50 flex flex-col justify-end"
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={onCancel}
        className="absolute inset-0 bg-ink/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-sheet-title"
        aria-describedby="confirm-sheet-body"
        className="relative flex max-h-[80vh] flex-col gap-2 overflow-y-auto px-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <div className="overflow-hidden rounded-card bg-card/95 backdrop-blur-xl">
          <div className="flex flex-col gap-1.5 px-5 py-[18px] text-center">
            <p id="confirm-sheet-title" className="text-meta font-semibold text-muted">
              {title}
            </p>
            <p id="confirm-sheet-body" className="text-fine leading-normal text-muted">
              {body}
            </p>
          </div>

          <div aria-hidden="true" className="h-px bg-card-border" />

          <button
            type="button"
            onClick={onConfirm}
            className="tap h-14 w-full text-body font-semibold text-danger"
          >
            {confirmLabel}
          </button>
        </div>

        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="tap h-14 w-full rounded-card bg-card/95 text-body font-bold text-accent backdrop-blur-xl"
        >
          {cancelLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
