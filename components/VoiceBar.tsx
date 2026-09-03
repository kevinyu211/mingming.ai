"use client";

/**
 * The pinned voice bar (design canvas `AskAnswered.dc.html`): the always-reachable way to ask,
 * sitting at the bottom edge of the one-screen conversation on `/read`.
 *
 * Top to bottom: the input-language segmented control (廣東話 / 普通話 / English), then a row of a
 * 52px clear button, a text field that is always visible, and a 52px round mic on the right, then
 * the caption line. While the mic is capturing the field is replaced by a breathing waveform, but
 * the field itself stays mounted so its ref never goes stale.
 *
 * Fully controlled: every piece of ask state lives on the page (which needs the transcript for the
 * thread), and this component only paints it and calls back. It owns nothing except the CSS for the
 * waveform. `MicButton` keeps all four of its states, its pointer handlers and its aria contract —
 * including that it is NOT `aria-disabled` merely because speech is unavailable, and that a tap on
 * the unavailable mic moves focus to the text field (FR-024).
 */
import { type RefObject } from "react";
import LanguageToggle from "@/components/LanguageToggle";
import MicButton, { type MicState } from "@/components/MicButton";
import { useLocale } from "@/components/LocaleProvider";
import type { InputLanguage } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";

/**
 * Copy with no key in `lib/i18n/ui.ts`. Same rules as everything there: no 診斷/治療/處方/治癒,
 * no 能吃/唔食得, no "you should", no number about the person.
 */
const LOCAL: Record<"micUnavailable" | "typeHere" | "clear", Record<UiLocale, string>> = {
  micUnavailable: {
    hant: "而家聽唔到你講嘢，打字問就得。",
    hans: "现在听不到你说话，打字问就行。",
    en: "Speech input isn't available here. Type the question instead.",
  },
  // The placeholder inside the capsule. The field's own label keeps `ask.placeholder`, which is the
  // sentence a screen reader hears; this is the short form that fits the box.
  typeHere: { hant: "打字問…", hans: "打字问…", en: "Type a question…" },
  clear: { hant: "清走", hans: "清掉", en: "Clear" },
};

export interface VoiceBarProps {
  inputLanguage: InputLanguage;
  onInputLanguageChange: (language: InputLanguage) => void;
  /** The typed question, owned by the page (it also feeds the thread's transcript preview). */
  text: string;
  onTextChange: (text: string) => void;
  /** Send the current text. The page runs the crisis / medicine gates before anything is sent. */
  onSubmit: () => void;
  /** Empty the composer. Never touches an answer already in the thread. */
  onClear: () => void;
  /** Partial transcript while the mic is held; kept on the page so the thread can preview it. */
  interim: string;
  /** Mic state, owned by the page so the caption and the waveform stay in step with the thread. */
  micState: MicState;
  onMicState: (state: MicState) => void;
  onInterim: (text: string) => void;
  /** The final transcript. Shown for review in the thread; nothing is sent until the user taps 問. */
  onTranscript: (text: string) => void;
  /** True while a request is in flight: the language toggle, the mic and the field all rest. */
  disabled: boolean;
  /** Shared with the page so its "改一改先" edit affordance can focus and select the same field. */
  inputRef: RefObject<HTMLInputElement | null>;
}

export default function VoiceBar({
  inputLanguage,
  onInputLanguageChange,
  text,
  onTextChange,
  onSubmit,
  onClear,
  interim,
  micState,
  onMicState,
  onInterim,
  onTranscript,
  disabled,
  inputRef,
}: VoiceBarProps) {
  const { locale, t } = useLocale();

  // The middle of the composer is a waveform while the mic is capturing, and the typed field the
  // rest of the time. The field stays mounted either way so its ref never goes stale.
  const listening = micState === "held" || micState === "processing";

  const caption =
    micState === "unavailable"
      ? LOCAL.micUnavailable[locale]
      : micState === "held"
        ? t("ask.holding")
        : micState === "processing"
          ? t("ask.processing")
          : t("ask.hold");

  return (
    <div className="shrink-0 rounded-t-[24px] bg-panel px-4 pt-3.5 pb-4">
      {/* The bars animation. globals.css turns it off under prefers-reduced-motion. */}
      <style>{"@keyframes askBars{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}"}</style>

      <LanguageToggle
        value={inputLanguage}
        onChange={onInputLanguageChange}
        disabled={disabled}
      />

      <form
        className="mt-3.5 flex items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <button
          type="button"
          aria-label={LOCAL.clear[locale]}
          onClick={onClear}
          disabled={disabled || (text.length === 0 && interim.length === 0)}
          className="tap h-[52px] w-[52px] shrink-0 rounded-full bg-track text-muted disabled:opacity-40"
        >
          <CloseGlyph />
        </button>

        <div className="relative flex h-[52px] min-w-0 flex-1 items-center rounded-full bg-card pr-[2px] pl-4 shadow-[inset_0_0_0_1px_rgba(31,27,22,0.05)]">
          <label className="sr-only" htmlFor="ask-question">
            {t("ask.placeholder")}
          </label>
          <input
            id="ask-question"
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            enterKeyHint="send"
            value={text}
            placeholder={LOCAL.typeHere[locale]}
            onChange={(event) => onTextChange(event.target.value)}
            className={`h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted ${
              listening ? "invisible" : ""
            }`}
          />
          <button
            type="submit"
            aria-label={t("ask.send")}
            disabled={disabled || text.trim().length === 0}
            className={`tap h-12 w-12 shrink-0 rounded-full bg-accent text-accent-ink disabled:opacity-40 ${
              listening ? "invisible" : ""
            }`}
          >
            <SendGlyph />
          </button>
          {listening ? <Waveform /> : null}
        </div>

        <MicButton
          language={inputLanguage}
          disabled={disabled}
          onStateChange={onMicState}
          onInterim={onInterim}
          onTranscript={onTranscript}
          onUnavailable={() => inputRef.current?.focus()}
        />
      </form>

      <p className="mt-3 text-center text-fine text-muted">{caption}</p>
    </div>
  );
}

/** Seven bars breathing under the words being spoken. Decorative: the transcript is the truth. */
const BARS: readonly { height: number; opacity: number; delay: number | null }[] = [
  { height: 8, opacity: 0.35, delay: null },
  { height: 14, opacity: 0.55, delay: 0 },
  { height: 22, opacity: 1, delay: 0.1 },
  { height: 30, opacity: 1, delay: 0.2 },
  { height: 22, opacity: 1, delay: 0.3 },
  { height: 14, opacity: 0.55, delay: 0.4 },
  { height: 8, opacity: 0.35, delay: null },
];

function Waveform() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center gap-[3px] rounded-full bg-card"
    >
      {BARS.map((bar, index) => (
        <span
          key={index}
          className="w-[3px] rounded-[2px] bg-accent"
          style={{
            height: `${bar.height}px`,
            opacity: bar.opacity,
            transformOrigin: "center",
            animation: bar.delay === null ? undefined : `askBars 1s ease-in-out ${bar.delay}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}
