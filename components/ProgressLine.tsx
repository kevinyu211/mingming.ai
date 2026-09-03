"use client";

/**
 * S3 — the reading state. Not a spinner: a page being scanned, three named steps
 * (讀緊 → 執緊重點 → 準備讀出), and the line that says what comes first, 首先會讀警號.
 *
 * The point of naming the steps is that the person holding the phone in a taxi knows the warning
 * signs are the thing being prepared, so the wait feels like the product working rather than the
 * network hanging. `aria-live` announces each step once, for the same reason.
 *
 * The page and its scan line are decoration and are hidden from screen readers: the three steps
 * and the note are the whole of what this says.
 */
import { useT } from "@/components/LocaleProvider";

export type ProgressStep = 1 | 2 | 3;

/**
 * The scan sweeping the page and the dot breathing on the step in progress. Kept next to the one
 * component that uses them; globals.css already collapses both under reduced motion, and the rule
 * below settles them at rest rather than at whichever keyframe the collapsed run ended on.
 */
const PROGRESS_CSS = `
@keyframes sheet-scan { from { transform: translateY(0); } to { transform: translateY(232px); } }
@keyframes step-dot { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
.sheet-scan { animation: sheet-scan 2.6s ease-in-out infinite alternate; }
.step-dot { animation: step-dot 1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .sheet-scan, .step-dot { animation: none; }
}
`;

export default function ProgressLine({
  step,
  className = "",
}: {
  step: ProgressStep;
  className?: string;
}) {
  const t = useT();
  const steps = [t("progress.step1"), t("progress.step2"), t("progress.step3")];

  return (
    <section
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center gap-8 px-2 py-6 ${className}`}
    >
      <style dangerouslySetInnerHTML={{ __html: PROGRESS_CSS }} />

      <SheetBeingRead />

      <ol className="flex w-full flex-col gap-[18px]">
        {steps.map((label, index) => {
          const position = index + 1;
          const done = position < step;
          const active = position === step;
          return (
            <li key={label} className="flex items-center gap-3.5">
              <span
                aria-hidden="true"
                className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ${
                  done
                    ? "bg-accent text-accent-ink"
                    : active
                      ? "bg-chip"
                      : "border-[1.5px] border-card-border"
                }`}
              >
                {done ? <CheckMark /> : null}
                {active ? (
                  <span className="step-dot h-[9px] w-[9px] rounded-full bg-accent" />
                ) : null}
              </span>
              <span
                // The canvas greys the steps still to come to #B5AB9F; that is 2:1 on this
                // ground, so they keep the muted ink and the empty ring says "not yet".
                className={
                  active ? "text-[19px] font-semibold text-accent" : "text-body text-muted"
                }
                aria-current={active ? "step" : undefined}
              >
                {label}
                {done ? <span className="sr-only"> ✓</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="inline-flex items-center gap-2 rounded-full bg-warning-bg px-4 py-2.5 text-meta font-semibold text-warning-fg">
        <AlertGlyph />
        {t("progress.note")}
      </p>
    </section>
  );
}

/** The page under the scan line: a stand-in for the sheet, warmly abstract, never a document icon. */
function SheetBeingRead() {
  const line = (width: number, extra = "") => (
    <span className={`h-[6px] rounded-[3px] bg-card-border ${extra}`} style={{ width }} />
  );
  return (
    <div
      aria-hidden="true"
      className="relative flex h-[268px] w-[196px] flex-col gap-[11px] overflow-hidden rounded-[14px] bg-card px-6 py-[26px] shadow-card"
    >
      <span className="h-[8px] w-[96px] rounded-[4px] bg-ink opacity-75" />
      {line(142)}
      {line(120)}
      {line(148, "mt-1.5")}
      {line(132)}
      <span className="mt-1.5 h-[6px] w-[146px] rounded-[3px] bg-warning-fg/60" />
      <span className="h-[6px] w-[104px] rounded-[3px] bg-warning-fg/60" />
      {line(138, "mt-1.5")}
      {line(82)}
      <span
        className="sheet-scan absolute inset-x-0 top-[18px] h-10 border-b-2 border-accent"
        style={{
          background:
            "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--accent) 14%, transparent))",
        }}
      />
    </div>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[17px] w-[17px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[17px] w-[17px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8v5" />
      <circle cx="12" cy="16.5" r=".6" fill="currentColor" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
