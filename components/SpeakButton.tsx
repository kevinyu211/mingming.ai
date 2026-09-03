"use client";

/**
 * The primary control on every card (design.md principle 3: speak-first, and the play state has
 * to be obvious from across a room, because the parent is watching too).
 *
 * Three states, all designed rather than apologetic:
 *   idle        — a filled capsule, "讀出嚟"
 *   speaking    — three levelling bars behind a soft pulse ring and "讀緊…"; tapping again stops
 *   unavailable — no voice on this phone at all, so the button becomes the S10 "睇字" note:
 *                 a quiet pill with the eye glyph, because there is nothing to tap — the words
 *                 are already on the card.
 *
 * Playback itself lives in `components/CardStack.tsx`, so that "play all" can walk the cards in
 * order and a second tap anywhere stops whatever is speaking. This component is presentational.
 */
import { useT } from "@/components/LocaleProvider";

export interface SpeakButtonProps {
  /** Announced to screen readers so "play" is never a bare verb, e.g. the card title. */
  label: string;
  speaking: boolean;
  unavailable: boolean;
  onPlay: () => void;
  onStop: () => void;
  className?: string;
  /**
   * Presentational only. Inside the amber warning card the capsule is amber, so that a teal
   * button never floats on an amber ground; everywhere else it is the teal accent.
   */
  tone?: "accent" | "warning";
}

/**
 * The speaking state's motion, from the design canvas: three bars levelling at a 150 ms stagger
 * behind a ring that breathes. Injected here rather than in globals.css so the animation lives
 * next to the only thing that uses it. The reduced-motion rule in globals.css already collapses
 * every animation; this repeats it with `none` so the bars settle at full height instead of at
 * whichever keyframe the collapsed run happened to end on.
 */
const SPEAK_CSS = `
@keyframes speak-bars { 0%, 100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }
@keyframes speak-ring { 0%, 100% { opacity: .5; transform: scale(1); } 50% { opacity: .16; transform: scale(1.06); } }
.speak-bar { transform-origin: bottom; animation: speak-bars .9s ease-in-out infinite; }
.speak-ring { animation: speak-ring 1.7s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .speak-bar, .speak-ring { animation: none; }
  .speak-ring { opacity: .3; }
}
`;

export default function SpeakButton({
  label,
  speaking,
  unavailable,
  onPlay,
  onStop,
  className = "",
  tone = "accent",
}: SpeakButtonProps) {
  const t = useT();

  if (unavailable) {
    return (
      <span
        role="note"
        aria-label={`${t("fallback.noVoice")}。${t("fallback.noVoiceNote")}`}
        className={`tap gap-2 rounded-full bg-soft px-4 text-meta font-semibold text-muted ${className}`}
      >
        <EyeIcon />
        {t("fallback.noVoice")}
      </span>
    );
  }

  const fill = tone === "warning" ? "bg-warning-fg text-warning-bg" : "bg-accent text-accent-ink";
  const ring = tone === "warning" ? "bg-warning-fg" : "bg-accent";

  return (
    <button
      type="button"
      onClick={speaking ? onStop : onPlay}
      aria-pressed={speaking}
      aria-label={`${speaking ? t("cards.stop") : t("cards.play")}：${label}`}
      className={`tap relative gap-2 rounded-full px-5 text-body font-semibold ${fill} ${className}`}
    >
      {speaking ? (
        <>
          <style dangerouslySetInnerHTML={{ __html: SPEAK_CSS }} />
          <span
            aria-hidden="true"
            className={`speak-ring absolute -inset-[3px] rounded-full ${ring}`}
          />
        </>
      ) : null}
      <span className="relative inline-flex items-center gap-2">
        {speaking ? <LevelBars /> : <SpeakIcon />}
        {speaking ? t("cards.playing") : t("cards.play")}
      </span>
    </button>
  );
}

/** Three bars levelling while the voice speaks: motion, not a symbol, so it reads from a metre away. */
function LevelBars() {
  return (
    <span aria-hidden="true" className="inline-flex h-[17px] shrink-0 items-end gap-[3px]">
      <span className="speak-bar h-[17px] w-[3px] rounded-[2px] bg-current" />
      <span
        className="speak-bar h-[17px] w-[3px] rounded-[2px] bg-current"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="speak-bar h-[17px] w-[3px] rounded-[2px] bg-current"
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}

/** A speech bubble with sound coming out of it. No medical symbols anywhere (design.md 3). */
function SpeakIcon() {
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
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h6A2.5 2.5 0 0 1 15 6.5v5A2.5 2.5 0 0 1 12.5 14H9l-4 3.5V14h-.5" />
      <path d="M18 8.5a4 4 0 0 1 0 7" />
    </svg>
  );
}

function EyeIcon() {
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
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
