"use client";

/**
 * 明明 typing himself out and speaking at the same time (v2 build brief §6).
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
 * **The clip is fetched before the bubble needs it.** One MiniMax call measures two to three
 * seconds. Asked for at the moment the bubble appears — which is what this hook used to do — the
 * whole line is typed out and sitting still before a sound comes out of the phone, and 明明 reads
 * a message the reader finished half a sentence ago. So `say()` takes the lines that come AFTER
 * this one and warms them while the current one is speaking (`warm`, `prefetch`): by the time each
 * bubble appears its audio is already in the session cache, and the voice starts on the same tick
 * as the text. Nothing ever waits on it — an unwarmed line still types immediately and speaks when
 * the clip lands, because holding words off the screen to wait for a voice is the worse failure.
 *
 * On iOS a first sound with no user gesture behind it is refused by the autoplay policy, and 明明
 * speaks without being tapped. `lib/speech/unlock.ts` is what buys the right to make a sound — one
 * element, unlocked on a real tap and reused for every clip. If it is still refused, `speak()`
 * reports that honestly as `text-only`, which sets `voiceUnavailable`: the text is already on
 * screen either way, so a refused sound costs the reader nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { chunks, CLAUSE_MS, COMMIT_MS } from "@/components/chat/briefing";
import type { Dialect } from "@/lib/domain/schemas";
import { prefetch, speak, stopSpeaking } from "@/lib/speech/tts";

/**
 * How many lines ahead of the one being spoken are fetched.
 *
 * Three, because `prefetch` runs three requests at a time and a beat lasts about as long as one
 * request: two ahead keeps the next bubble warm even when the reader's line is short, and a
 * fourth would be paid for before there is any chance of it being reached.
 */
const WARM_AHEAD = 3;

/** How one `say` ended. `heard` is false when no sound was made (speaker off, or no voice). */
export interface SayResult {
  heard: boolean;
}

/**
 * The longest a finished typing chain waits for its clip to end before the script moves on
 * anyway. A clip is a few seconds; this only exists so a stuck element can never freeze 明明.
 */
export const AUDIO_WAIT_CAP_MS = 45_000;

/**
 * Decides when one line is over. Both halves have to close — the typing chain AND the clip —
 * and `onDone` fires exactly once. Pure, so it is tested on its own: the bug it replaces was
 * `onDone` firing on the typing timer alone, so a Cantonese clip that outlasted the typing was
 * cut off by the next line's `say`, which is what Kevin heard on every medicine.
 */
export function doneGate(onDone: (result: SayResult) => void): {
  typed: () => void;
  audio: (heard: boolean) => void;
} {
  let typed = false;
  let audio: boolean | null = null;
  let fired = false;
  const fire = () => {
    if (fired || !typed || audio === null) return;
    fired = true;
    onDone({ heard: audio });
  };
  return {
    typed: () => {
      typed = true;
      fire();
    },
    audio: (heard: boolean) => {
      if (audio === null) audio = heard;
      fire();
    },
  };
}

export interface Voice {
  /** The clauses revealed so far, or null when nothing is being typed. */
  typing: string | null;
  /** Audio is playing right now. Drives the 讀住 waveform, which is status and not a control. */
  speaking: boolean;
  /** The last attempt produced no sound at all: no cloud voice, no device voice. */
  voiceUnavailable: boolean;
  /**
   * Types `text` out clause by clause, speaking it, then calls `onDone` once.
   *
   * `next` is the lines that come after this one, in order. They are fetched while this one is
   * being spoken, which is the difference between the voice arriving with the words and the voice
   * arriving two seconds after the reader has finished reading them. Passing nothing is safe and
   * simply leaves the following line to fetch itself when its turn comes.
   */
  say: (text: string, onDone?: (result: SayResult) => void, next?: string[]) => void;
  /** Re-speaks something already on screen. Never re-types it (再講一次, brief §6). */
  resay: (text: string) => void;
  /**
   * Fetch these lines now, without saying any of them.
   *
   * For the line that has no line before it: the opening bubble cannot be warmed by the one that
   * precedes it, so whoever knows the script warms it in the pause before 明明 starts talking.
   */
  warm: (lines: string[]) => void;
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
  const utter = useCallback((text: string): Promise<boolean> => {
    if (!speakerRef.current || text.trim().length === 0) return Promise.resolve(false);
    const mine = token.current;
    const controller = new AbortController();
    utterance.current = controller;
    setSpeaking(true);
    return speak(text, dialectRef.current, { signal: controller.signal }).then(
      ({ mode }) => {
        // A listener added to an already-aborted signal never fires, and every clip now shares one
        // element — so a silenced utterance is stopped again here rather than being left to finish
        // out loud on the element the next line is about to claim.
        if (controller.signal.aborted) {
          stopSpeaking();
          return false;
        }
        if (token.current !== mine) return false;
        setSpeaking(false);
        setVoiceUnavailable(mode === "text-only");
        return mode !== "text-only";
      },
      () => false,
    );
  }, []);

  /**
   * Ask for the audio of lines that have not been said yet. Never plays anything, never throws,
   * and never blocks: a warm-up that fails just means `speak` fetches that line when it arrives.
   *
   * Silenced means silenced: with the speaker off there is nothing to warm up for, and a warm-up
   * is a paid call to the provider.
   */
  const warm = useCallback((lines: string[]) => {
    if (!speakerRef.current || lines.length === 0) return;
    const dialect = dialectRef.current;
    const ahead = lines
      .filter((text) => text.trim().length > 0)
      .slice(0, WARM_AHEAD)
      .map((text) => ({ text, dialect }));
    if (ahead.length > 0) void prefetch(ahead);
  }, []);

  const say = useCallback(
    (text: string, onDone?: (result: SayResult) => void, next?: string[]) => {
      cancel();
      const mine = token.current;
      const parts = chunks(text);
      setTyping("");
      // The line is over when the words have all arrived AND the clip has finished playing.
      // Before this, the typing timer alone ended the line, and the next `say` cut the clip.
      const gate = doneGate((result) => {
        if (token.current !== mine) return;
        onDone?.(result);
      });
      void utter(text).then((heard) => gate.audio(heard));
      // After `utter`, so this line's own clip is the first request out.
      if (next && next.length > 0) warm(next);

      parts.forEach((_, n) => {
        at(CLAUSE_MS * (n + 1), () => {
          if (token.current !== mine) return;
          setTyping(parts.slice(0, n + 1).join(""));
        });
      });

      at(CLAUSE_MS * parts.length + COMMIT_MS, () => {
        if (token.current !== mine) return;
        setTyping(null);
        gate.typed();
        // A clip that never ends must not freeze the script.
        at(AUDIO_WAIT_CAP_MS, () => gate.audio(false));
      });
    },
    [at, cancel, utter, warm],
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
  return { typing, speaking: speaking && speakerOn, voiceUnavailable, say, resay, warm, cancel };
}
