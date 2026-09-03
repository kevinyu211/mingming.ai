"use client";

/**
 * The AI label required on every model-written body (FR-009). A chip, not a toast:
 * design.md treats honest states as first-class components.
 */
import { useT } from "@/components/LocaleProvider";

export default function AiLabel({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-fine leading-none font-medium text-accent ${className}`}
    >
      <Sparkle />
      {t("aiChip")}
    </span>
  );
}

function Sparkle() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.75 9.4 5.6a1 1 0 0 0 .6.6l3.85 1.4-3.85 1.4a1 1 0 0 0-.6.6L8 13.45 6.6 9.6a1 1 0 0 0-.6-.6L2.15 7.6 6 6.2a1 1 0 0 0 .6-.6L8 1.75Z" />
      <path d="M13 1.75v2M12 2.75h2" />
    </svg>
  );
}
