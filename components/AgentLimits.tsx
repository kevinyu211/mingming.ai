"use client";

/**
 * What the agent can and cannot do, stated on screen (FR-022, and the rulebook's agent-behavior
 * constraint). Two rows, never collapsed behind a disclosure: the point is that a judge or a
 * daughter can read it without looking for it.
 *
 * Design canvas S9: a grouped card, a teal check on the half it will do and a muted cross on the
 * half it will not. The glyphs are a second signal, not the only one — both rows say it in words.
 */
import { useT } from "@/components/LocaleProvider";

export default function AgentLimits({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <section aria-label={t("agentLimits.title")} className={className}>
      <h2 className="mb-2 ml-1 text-fine font-semibold text-muted">{t("agentLimits.title")}</h2>

      <div className="surface overflow-hidden">
        <div className="flex items-start gap-3 px-[18px] py-[15px]">
          <CheckGlyph />
          <p className="text-body leading-relaxed text-ink">{t("agentLimits.can")}</p>
        </div>

        <div aria-hidden="true" className="ml-[18px] h-px bg-hairline" />

        <div className="flex items-start gap-3 px-[18px] py-[15px]">
          <CrossGlyph />
          <p className="text-body leading-relaxed text-muted">{t("agentLimits.cannot")}</p>
        </div>
      </div>
    </section>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="mt-1 h-5 w-5 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="mt-1 h-5 w-5 shrink-0 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
