"use client";

/**
 * "示範紙，唔係真嘅" — the sample banner (FR-023, and the hackathon rule that demo data must be
 * visibly synthetic).
 *
 * A dashed chip directly under the header, so it reads as part of the "who this is for" line
 * rather than as a card of its own — dotted like the other honest states, and never dismissible:
 * a judge who scrolls in halfway must still be able to tell that this sheet was written by us.
 */
import { useT } from "@/components/LocaleProvider";

export default function SampleBanner({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <p
      role="note"
      className={`inline-flex items-center gap-2 rounded-full border border-dashed border-card-border bg-soft py-2 pr-4 pl-3 text-meta font-semibold text-muted ${className}`}
    >
      <PageMark />
      {t("cards.sampleBanner")}
    </p>
  );
}

/** A page with a folded corner. Rounded 2 px stroke, no medical symbols (design.md 3). */
function PageMark() {
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
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
