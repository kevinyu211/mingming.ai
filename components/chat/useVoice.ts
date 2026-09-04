"use client";

/**
 * 明仔 typing himself out and speaking at the same time (v2 build brief §6).
 *
 * **There is no play button anywhere in this product.** A message is revealed one clause per
 * ~360 ms and the audio starts on the same tick, so the words on screen and the words in the air
 * are the same sentence arriving together. The 讀住 waveform the UI draws off `speaking` is a
 * status indicator, never a control; the only voice control in the whole screen is the header's
 * speaker toggle, which silences the audio and lets the text keep typing.
 *
 * **The token pattern is not decoration.** Every timer chain and every `speak()` promise carries
 * the token that was current when it started, and checks it before touching state. Without that,
 * a briefing abandoned halfway keeps writing its old clauses into whatever is on screen now — the
 * single most obvious bug in a screen made of chained timeouts, and the reason the design canvas
 * has `this.tok` too. `cancel()` bumps the token, drops the whole timer queue and stops the audio,
 * and it runs on unmount, on navigation, and before every new utterance.
 *
 * On iOS a first sound with no user gesture behind it can be refused by the autoplay policy.
 * `speak()` reports that honestly as `text-only`, which sets `voiceUnavailable` — the text is
 * already on screen either way, so a refused sound costs the reader nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { chunks, CLAUSE_MS, COMMIT_MS } from "@/components/chat/briefing";
import type { Dialect } from "@/lib/domain/schemas";
import { speak, stopSpeaking } from "@/lib/speech/tts";

export interface Voice {
  /** The clauses revealed so far, or null when nothing is being typed. */
  typing: string | null;
  /** Audio is playing right now. Drives the 讀住 waveform, which is status and not a control. */
  speaking: boolean;
  /** The last attempt produced no sound at all: no cloud voice, no device voice. */
  voiceUnavailable: boolean;
  /** Types `text` out clause by clause, speaking it, then calls `onDone` once. */
  say: (text: string, onDone?: () => void) => void;
  /** Re-speaks something already on screen. Never re-types it (再講一次, brief §6). */
  resay: (text: string) => void;
  /** Drops the timer queue, stops the audio, and invalidates everything in flight. */
  cancel: () => void;
}

export function useVoice(dialect: Dialect, speakerOn: boolean): Voice {
  const [typing, setTyping] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);

  const token = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const utterance = useRef<AbortController | null>(null);

  // Read inside timer callbacks, which were created before the current render's props existed.
  // Synced in an effect rather than during render: the React Compiler is on for this project and
  // a ref written while rendering is not a safe thing for it to reason about.
  const speakerRef = useRef(speakerOn);
  const dialectRef = useRef(dialect);
  useEffect(() => {
    speakerRef.current = speakerOn;
    dialectRef.current = dialect;
  }, [speakerOn, dialect]);

  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const cancel = useCallback(() => {
    token.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    utterance.current?.abort();
    utterance.current = null;
    stopSpeaking();
    setTyping(null);
    setSpeaking(false);
  }, []);

  /**
   * Starts the audio for one line. Fire and forget: the typing chain never waits on it, so a slow
   * or missing voice cannot hold the words off the screen.
   */
  const utter = useCallback((text: string) => {
    if (!speakerRef.current || text.trim().length === 0) return;
    const mine = token.current;
    const controller = new AbortController();
    utterance.current = controller;
    setSpeaking(true);

    void speak(text, dialectRef.current, { signal: controller.signal }).then(({ mode }) => {
      // `speak` falls through to the device voice when the cloud path fails, and a listener added
      // to an already-aborted signal never fires — so a silenced utterance is stopped again here
      // rather than being left to finish out loud.
      if (controller.signal.aborted) {
        stopSpeaking();
        return;
      }
      if (token.current !== mine) return;
      setSpeaking(false);
      setVoiceUnavailable(mode === "text-only");
    });
  }, []);

  const say = useCallback(
    (text: string, onDone?: () => void) => {
      cancel();
      const mine = token.current;
      const parts = chunks(text);
      setTyping("");
      utter(text);

      parts.forEach((_, n) => {
        at(CLAUSE_MS * (n + 1), () => {
          if (token.current !== mine) return;
          setTyping(parts.slice(0, n + 1).join(""));
        });
      });

      at(CLAUSE_MS * parts.length + COMMIT_MS, () => {
        if (token.current !== mine) return;
        setTyping(null);
        onDone?.();
      });
    },
    [at, cancel, utter],
  );

  const resay = useCallback(
    (text: string) => {
      // Deliberately does NOT bump the token: 再講一次 is a repeat, not a new turn, and the
      // briefing is sitting still at 明唔明？ while it plays.
      utterance.current?.abort();
      stopSpeaking();
      utter(text);
    },
    [utter],
  );

  // Silencing the speaker stops the sound; the clause timers keep running and the text keeps
  // arriving, which is the whole point of the toggle. Only the audio is touched here — `speaking`
  // is derived below rather than set, so this effect talks to an external system and to nothing
  // else.
  useEffect(() => {
    if (speakerOn) return;
    utterance.current?.abort();
    stopSpeaking();
  }, [speakerOn]);

  // Leaving the screen must not leave a chain of timeouts writing into a page that is gone.
  useEffect(() => cancel, [cancel]);

  // A silenced speaker is not speaking, whatever the last utterance thinks it is doing. Derived
  // rather than stored so the waveform disappears on the same frame the sound does.
  return { typing, speaking: speaking && speakerOn, voiceUnavailable, say, resay, cancel };
}
