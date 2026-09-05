"use client";

/**
 * The disclaimer required on every screen (rules.md section 16, constitution's Hackathon
 * Compliance Constraints). Fixed to the bottom so it survives every route, above the
 * home-indicator safe area. Its wording is the one string exempt from the banned-term filter.
 *
 * It also publishes its own height as `--disclaimer-height`. globals.css seeds that variable with
 * a value that is about right for the Chinese wording and well short of the English one, so a
 * fixed value hid the bottom of every screen as soon as the interface was switched to English.
 * `body` already reserves `var(--disclaimer-height)`, and `<main>` on several screens is sized
 * `100dvh` minus it, so measuring here is what makes that reserve true — for this footer's own
 * locale, its own text size, and its own viewport width. The seeded value stays as the
 * pre-measurement fallback.
 *
 * ## Why it is smaller than the rest of the app
 *
 * Every other size in this product is deliberately large, because the reader is seventy and the
 * phone is at arm's length. This is the one block that is not something to read: it is the
 * rulebook's own wording, present on every screen at all times, and at 13 px it took three lines
 * of a 375 px phone in Chinese and six in English — which, stacked on the chat bar, was a quarter
 * of the screen gone before a word of the discharge sheet appeared.
 *
 * So it is 12 px on 1.3 leading with narrower gutters, and that is the whole change. rules.md §16
 * and the constitution's Hackathon Compliance Constraints require the wording to be shown
 * prominently: every character of it is still on the screen, never clipped, never behind a tap,
 * never collapsed — and --muted on --ground is 5.03:1, unchanged and still past AA, because
 * contrast is the part of "legible" that shrinking type must not touch.
 */
import { useEffect, useRef } from "react";
import { useT } from "@/components/LocaleProvider";

const HEIGHT_PROPERTY = "--disclaimer-height";

export default function Disclaimer() {
  const t = useT();
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const footer = footerRef.current;
    if (typeof ResizeObserver === "undefined" || !footer) return;
    const root = document.documentElement;

    const publish = () => {
      // Rounded up: half a pixel short would let a descender sit under the footer's edge.
      const next = `${Math.ceil(footer.getBoundingClientRect().height)}px`;
      // Only on a real change, so writing the variable can never feed its own observer.
      if (root.style.getPropertyValue(HEIGHT_PROPERTY) !== next) {
        root.style.setProperty(HEIGHT_PROPERTY, next);
      }
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(footer);

    return () => {
      observer.disconnect();
      // Back to the stylesheet's own value rather than a stale measurement.
      root.style.removeProperty(HEIGHT_PROPERTY);
    };
  }, []);

  return (
    <footer
      ref={footerRef}
      role="note"
      aria-label={t("disclaimer")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-ground/95 px-3.5 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:px-8"
    >
      <p className="text-[12px] leading-[1.3] font-normal text-muted">{t("disclaimer")}</p>
    </footer>
  );
}
