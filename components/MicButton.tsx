"use client";

/**
 * Hold to talk (design.md section 3: "the mic button grows while held, with a level ring").
 *
 * Four states, each visible from across a room because the parent is watching too:
 *
 *   idle        52 px teal circle, white microphone glyph, lifted off the panel by a soft shadow
 *   held        larger, with a ring pulsing around it — the button is capturing
 *   processing  the ring stills, the glyph dims: released, transcribing
 *   unavailable outlined circle with a struck-through glyph; the typed box takes over
 *
 * Press-and-hold is done with pointer events plus pointer capture, so a finger that slides off
 * the circle still ends the recording on release. Space and Enter do the same thing for a
 * keyboard, because a hold-to-talk control that only answers to a finger is not a control.
 *
 * `SpeechUnavailableError` is not an error state to apologise for: the component switches to
 * `unavailable` and tells the page, which moves focus to the text field (FR-024, User Story 1
 * scenario 11). The text field is visible at all times anyway; this only saves a tap.
 *
 * The ring is a time-based pulse, not a real level meter: the browser `SpeechRecognition` path
 * never exposes the audio stream, so a real meter would mean opening a second microphone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/LocaleProvider";
import type { InputLanguage } from "@/lib/domain/schemas";
import {
  SpeechUnavailableError,
  isSttAvailable,
  listen,
  type SpeechUnavailableReason,
} from "@/lib/speech/stt";

export type MicState = "idle" | "held" | "processing" | "unavailable";

export interface MicButtonProps {
  /** The language the question is spoken in; sets the recognition locale. */
  language: InputLanguage;
  /** Partial transcript while the button is held. Browser recognition only. */
  onInterim?: (text: string) => void;
  /** The final transcript, once. Never called with an empty string. */
  onTranscript: (text: string) => void;
  /** Speech input cannot work here; the page moves focus to the text field. */
  onUnavailable?: (reason: SpeechUnavailableReason | "no_api") => void;
  /** Reports every state change so the page can show the matching hint line. */
  onStateChange?: (state: MicState) => void;
  disabled?: boolean;
  className?: string;
}

export default function MicButton({
  language,
  onInterim,
  onTranscript,
  onUnavailable,
  onStateChange,
  disabled = false,
  className = "",
}: MicButtonProps) {
  const t = useT();
  const [state, setState] = useState<MicState>("idle");
  const stopRef = useRef<AbortController | null>(null);
  const cancelRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving the screen mid-hold must not leave the microphone open.
      cancelRef.current?.abort();
    };
  }, []);

  const go = useCallback(
    (next: MicState) => {
      if (!mounted.current) return;
      setState(next);
      onStateChange?.(next);
    },
    [onStateChange],
  );

  // The unavailable state is known before the first tap on most devices, so say so up front
  // instead of letting the user hold a dead button.
  useEffect(() => {
    if (!isSttAvailable()) go("unavailable");
  }, [go]);

  const start = useCallback(() => {
    if (disabled) return;
    if (state === "unavailable") {
      onUnavailable?.("no_api");
      return;
    }
    if (state !== "idle") return;

    const stop = new AbortController();
    const cancel = new AbortController();
    stopRef.current = stop;
    cancelRef.current = cancel;
    go("held");

    void (async () => {
      try {
        const { text } = await listen(language, {
          onInterim,
          stop: stop.signal,
          cancel: cancel.signal,
        });
        go("idle");
        const trimmed = text.trim();
        if (trimmed.length > 0) onTranscript(trimmed);
      } catch (error) {
        if (error instanceof SpeechUnavailableError) {
          go("unavailable");
          onUnavailable?.(error.reason);
          return;
        }
        // Anything else is a one-off: stay usable rather than locking the button out.
        go("idle");
      } finally {
        stopRef.current = null;
        cancelRef.current = null;
      }
    })();
  }, [disabled, state, language, onInterim, onTranscript, onUnavailable, go]);

  /** Release: stop capturing and transcribe what was heard. */
  const release = useCallback(() => {
    if (state !== "held") return;
    go("processing");
    stopRef.current?.abort();
  }, [state, go]);

  const held = state === "held";
  const processing = state === "processing";
  const unavailable = state === "unavailable";

  // Unavailable is a mic state, so the label points at the typed box, not at the play fallback.
  const label = unavailable
    ? t("capture.type")
    : held
      ? t("ask.holding")
      : processing
        ? t("ask.processing")
        : t("ask.hold");

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`}>
      {/* The level ring. Purely decorative, and the reduced-motion rule in globals.css stops it. */}
      {held ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-accent/30"
        />
      ) : null}
      <button
        type="button"
        aria-label={label}
        aria-pressed={held}
        // Not aria-disabled when speech is merely unavailable: the button still works (a tap
        // hands focus to the text field, FR-024), and telling assistive tech otherwise would
        // contradict what pointer users get. The unavailable state is carried by the label.
        aria-disabled={disabled}
        disabled={disabled}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.pointerType === "mouse") return;
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          start();
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          // A system gesture took the pointer: throw the recording away rather than send half.
          if (state === "held") {
            cancelRef.current?.abort();
            go("idle");
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          if (event.repeat) return;
          event.preventDefault();
          start();
        }}
        onKeyUp={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          release();
        }}
        // Held grows by transform, not by size: the row beside it must not reflow mid-sentence.
        // touch-none keeps a hold from turning into a page scroll on the phone.
        className={`tap relative h-[52px] w-[52px] touch-none rounded-full transition-transform duration-150 ${
          held ? "scale-110" : ""
        } ${
          unavailable
            ? "border-2 border-dashed border-card-border bg-soft text-muted"
            : processing
              ? "bg-accent/70 text-accent-ink"
              : "bg-accent text-accent-ink shadow-raised"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <MicGlyph struck={unavailable} className={held ? "h-7 w-7" : "h-6 w-6"} />
      </button>
    </span>
  );
}

function MicGlyph({ struck, className }: { struck: boolean; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
      {struck ? <path d="M4 20 20 4" /> : null}
    </svg>
  );
}
