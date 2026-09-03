"use client";

/**
 * The disclaimer required on every screen (rules.md section 16, constitution's Hackathon
 * Compliance Constraints). Fixed to the bottom so it survives every route, above the
 * home-indicator safe area. Its wording is the one string exempt from the banned-term filter.
 *
 * It also publishes its own height as `--disclaimer-height`. globals.css seeds that variable with
 * 4.5rem, which is about right for the Chinese wording and roughly 60 px short of the English
 * one, so a fixed value hid the bottom of every screen as soon as the interface was switched to
 * English. `body` already reserves `calc(var(--disclaimer-height) + env(safe-area-inset-bottom))`,
 * so measuring here is what makes that reserve true — for this footer's own locale, its own text
 * size, and its own viewport width. The seeded value stays as the pre-measurement fallback.
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-ground/95 px-5 pt-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm"
    >
      <p className="text-fine font-normal text-muted">{t("disclaimer")}</p>
    </footer>
  );
}
