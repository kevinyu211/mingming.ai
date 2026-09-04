"use client";

/**
 * The one `<audio>` element 明仔 speaks through, and the tap that unlocks it.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────
 *
 * On iOS, Safari will not play sound that no finger asked for. A page may call `play()` only from
 * inside a real user gesture, and only on an element that gesture has already touched — after
 * that, the SAME element may be re-`src`ed and replayed as often as you like, with no further
 * taps. That is the whole trick, and it is the only one that works.
 *
 * `lib/speech/tts.ts` used to do `new Audio(url)` per clip. A freshly constructed element has no
 * gesture behind it, so on a real iPhone the very first `audio.play()` was rejected — and 明仔
 * starts talking on his own, with nothing to press, so there was never a gesture to inherit. The
 * report from the phone was exactly what that produces: *"some don't even speak… I had to click
 * on it, and then it kind of did."*
 *
 * So: ONE element for the whole session, made here, unlocked here, and handed to `tts.ts` for
 * every clip.
 *
 * ── Where the gesture comes from ─────────────────────────────────────────────────────────────
 *
 * A read is always preceded by at least one tap — 明白，開始 on the consent notice, 拍張紙 /
 * 上載相片, then 講俾我聽 — and every one of those happens in the SAME document, because the app
 * navigates with the client router and never reloads. So an unlock done at any of them is still
 * good when the briefing starts on `/chat`.
 *
 * Two things arrange that:
 *
 *   1. `unlockAudio()`, called straight from a handler. This is the reliable one, and it must be
 *      called SYNCHRONOUSLY inside the handler — iOS counts the gesture on that tick and not one
 *      microtask later, so a call from inside `.then()` or after an `await` is already too late.
 *   2. `armAudioUnlock()`, armed from module scope below, which does the same thing on the first
 *      pointer or key event to reach the document, wherever it lands. It is the safety net for a
 *      route that forgot to call (1): the listener is capture-phase and passive, it never calls
 *      `preventDefault`, and it takes itself off as soon as the element is unlocked.
 *
 * ── What is actually played ──────────────────────────────────────────────────────────────────
 *
 * 30 ms of genuine silence, not a muted clip: muted playback is allowed on iOS anyway, so it
 * proves nothing and unlocks nothing. Silence is inaudible on the phone and audible to the
 * autoplay policy, which is exactly the combination wanted.
 *
 * This module is client-only and imports nothing. `tests/unit/tts-unlock.test.ts` covers it.
 */

/** 30 ms of silence: 8 kHz, mono, 8-bit PCM. 8-bit silence is 128, not 0. */
const SILENCE =
  "data:audio/wav;base64,UklGRhQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YfAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=";

/** The element every clip plays through, once something has asked for it. */
let element: HTMLAudioElement | null = null;

/** True once a `play()` we started inside a gesture was not refused. */
let unlocked = false;

/** Takes the safety-net listeners back off. Null when none are armed. */
let disarm: (() => void) | null = null;

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.Audio !== "undefined";
}

/**
 * Tell iOS this page is playing content, not a notification sound.
 *
 * Without it the ring/silent switch on the side of the phone silences the reading, and the app
 * looks broken to a reader who has no idea the switch is even involved. Safari 16.4+ only;
 * everywhere else the property is absent and this does nothing.
 */
function claimPlaybackSession(): void {
  if (typeof navigator === "undefined") return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try {
    if (session.type !== "playback") session.type = "playback";
  } catch {
    // Not settable on this build. The reading still plays with the switch off.
  }
}

/** The shared element, made on first use. Null anywhere there is no `Audio`. */
export function speechAudio(): HTMLAudioElement | null {
  if (element) return element;
  if (!hasWindow()) return null;
  const made = new window.Audio();
  made.preload = "auto";
  // Keep the sound in the page instead of handing it to iOS's full-screen player.
  made.setAttribute("playsinline", "");
  (made as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  element = made;
  return made;
}

/** The element if one has been made, WITHOUT making one. Used by teardown paths. */
export function peekSpeechAudio(): HTMLAudioElement | null {
  return element;
}

/** True once the browser has let us start a sound. Diagnostic; nothing gates playback on it. */
export function isAudioUnlocked(): boolean {
  return unlocked;
}

/**
 * Unlock the shared element. **Call this synchronously from inside a click/tap handler.**
 *
 * Cheap, idempotent, and safe to call on every tap: once unlocked it does nothing but return
 * true. Returns whether an unlock was attempted, not whether it succeeded — the browser answers
 * that a tick later, in `isAudioUnlocked()`.
 */
export function unlockAudio(): boolean {
  const audio = speechAudio();
  if (!audio) return false;
  claimPlaybackSession();
  if (unlocked) return true;

  /**
   * Something is already coming out of it, so the lock was never the problem — and pointing the
   * element at the silence now would cut 明仔 off mid-sentence.
   *
   * Reachable on any browser that allows autoplay: nothing there ever calls `unlockAudio`, so the
   * safety net below stays armed for the whole session and fires on every tap. Without this line,
   * tapping a source link while a line was being read stopped the reading. Nothing on this screen
   * silences 明仔 except the two things that are meant to.
   */
  if (!audio.paused) {
    noteAudioPlaying();
    return true;
  }

  let started: Promise<void> | undefined;
  try {
    audio.src = SILENCE;
    started = audio.play();
  } catch {
    return false;
  }

  // Older browsers return nothing from `play()`; if it did not throw, it played.
  if (!started || typeof started.then !== "function") {
    accept(audio);
    return true;
  }

  started.then(
    () => accept(audio),
    (error: unknown) => {
      // A real clip that started before the silence finished aborts it. The gesture still
      // counted — only an outright refusal means we are still locked.
      const name = (error as { name?: string } | null)?.name;
      if (name !== "NotAllowedError") accept(audio);
    },
  );
  return true;
}

/** The browser let us play. Stop the silence if it is still what the element is holding. */
function accept(audio: HTMLAudioElement): void {
  noteAudioPlaying();
  if (audio.src === SILENCE) {
    audio.pause();
    audio.currentTime = 0;
  }
}

/**
 * A real clip started, so the element is unlocked however that came about.
 *
 * `lib/speech/tts.ts` calls this the first time a `play()` resolves. On a browser with no autoplay
 * policy that is the ONLY thing that ever marks the element unlocked, and marking it matters: it
 * takes the safety-net listener back off, so no later tap can touch an element that is working.
 */
export function noteAudioPlaying(): void {
  unlocked = true;
  disarm?.();
}

/**
 * The safety net: unlock on the first gesture to reach the document, whatever it was for.
 *
 * Armed from module scope, so it is already listening by the time any screen renders. Idempotent.
 */
export function armAudioUnlock(): void {
  if (unlocked || disarm !== null) return;
  if (typeof document === "undefined") return;

  // `pointerdown` covers taps and clicks on every current browser; `touchend` is there for the
  // iOS builds that only count a completed touch, and `keydown` for a keyboard.
  const events = ["pointerdown", "touchend", "keydown"] as const;
  const onGesture = () => unlockAudio();

  for (const event of events) {
    document.addEventListener(event, onGesture, { capture: true, passive: true });
  }
  disarm = () => {
    disarm = null;
    for (const event of events) {
      document.removeEventListener(event, onGesture, { capture: true });
    }
  };
}

/** Test seam: forget the element and the unlock. Never called by the app. */
export function resetAudioUnlock(): void {
  disarm?.();
  element = null;
  unlocked = false;
}

armAudioUnlock();
