"use client";

/**
 * Speaking a card, on the phone.
 *
 * The chain is the cloud voice, then the words on screen (research.md R5, and the
 * constitution's "failure paths are features" rule). The device's own voice is NOT a fallback:
 * it speaks only where it is the configured provider, because a companion that switches voice
 * mid-conversation reads as broken. See `speak`.
 *
 *   1. `POST /api/tts` with `{ text, dialect }`. Audio bytes come back and play through the ONE
 *      unlocked `HTMLAudioElement` in `lib/speech/unlock.ts` — see that file for why there is
 *      exactly one and why a fresh `new Audio()` per clip is silent on an iPhone. A 503 means the
 *      server is configured for browser speech (`TTS_PROVIDER=browser`), not that anything failed.
 *   2. `window.speechSynthesis` with a zh-HK / zh-CN voice.
 *   3. `{ mode: "text-only" }` when no voice exists at all: the caller keeps the card on
 *      screen and says nothing.
 *
 * Only the card or answer text is sent. Never the profile label, never a date, never an
 * identifier (constitution principle V).
 *
 * This module is client-only. It imports nothing from `lib/speech/providers/` except a type,
 * which the compiler erases, so no server code or API key can reach the browser bundle.
 *
 * The caution sentence required by the rulebook is appended by the CALLER, not here: `speak`
 * says exactly the string it is given, which is what keeps the per-string cache honest.
 */

import type { Dialect } from "./providers/types";
import { noteAudioPlaying, peekSpeechAudio, speechAudio } from "./unlock";

/**
 * Re-exported so a screen only ever imports from one speech module.
 *
 * `unlockAudio()` is the call a tap handler makes; see `lib/speech/unlock.ts` for the rule that
 * it has to be made synchronously, on the same tick as the gesture.
 */
export { armAudioUnlock, isAudioUnlocked, unlockAudio } from "./unlock";

export type SpeakMode = "cloud" | "browser" | "text-only";

export interface SpeakResult {
  mode: SpeakMode;
}

export interface SpeakOptions {
  /** Cancels the request and any playback already under way. */
  signal?: AbortSignal;
  /** Rate for the browser fallback only (cloud audio plays at the provider's rate). */
  rate?: number;
}

export interface PrefetchItem {
  text: string;
  dialect: Dialect;
}

/** How many `/api/tts` requests `prefetch` keeps in flight. */
const PREFETCH_CONCURRENCY = 3;

/** How long to wait for `voiceschanged` before deciding there are no voices. */
const VOICE_LOAD_TIMEOUT_MS = 1000;

/**
 * Session cache, keyed by the exact string plus dialect: replaying a card is instant and costs
 * nothing. Memory only, so it dies with the tab and audio of a discharge sheet is never
 * persisted.
 */
const audioCache = new Map<string, Blob>();

/**
 * Requests that have gone out and not come back, keyed the same way.
 *
 * Without this, warming the next line and then asking for it a moment later fires TWO calls to a
 * provider that takes two to three seconds and bills per call — and the second one starts from
 * scratch, so the warm-up buys nothing. Joining the request in flight is what makes `prefetch`
 * actually shorten the wait rather than just double it.
 */
const inFlight = new Map<string, Promise<Blob | null>>();

/** Set once the server has answered 503; stops every later card retrying the cloud path. */
let cloudDisabled = false;

/**
 * True only when this deployment is DELIBERATELY configured for device speech
 * (`TTS_PROVIDER=browser`, which answers 503). That is the one case where the device voice is
 * the chosen voice rather than an unannounced substitute for a failed clip — see `speak`.
 */
function deviceSpeechIsChosen(): boolean {
  return cloudDisabled;
}

/** Last non-empty voice list seen, because `getVoices()` can transiently return []. */
let cachedVoices: SpeechSynthesisVoice[] = [];

let currentObjectUrl: string | null = null;

/**
 * Resolves the clip that owns the shared element right now. Held here rather than inside
 * `playBlob` so that `stopSpeaking()` can end a clip it did not start: one element means the next
 * clip's `src` assignment silently orphans the previous one's `ended` event, and a `speak()` left
 * waiting on an event that will never fire never resolves, so the caller's `speaking` flag sticks
 * on for the rest of the session.
 */
let endCurrentClip: ((played: boolean) => void) | null = null;

function cacheKey(text: string, dialect: Dialect): string {
  return `${dialect} ${text}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Stop whatever is being spoken right now. Safe to call at any time.
 *
 * The element is paused and left alone: it is the session's ONE unlocked element and destroying
 * it — which is what `currentAudio.src = ""` used to amount to — would throw away the gesture
 * that bought the right to make a sound at all.
 */
export function stopSpeaking(): void {
  if (!isBrowser()) return;
  const audio = peekSpeechAudio();
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
  }
  endCurrentClip?.(false);
  endCurrentClip = null;
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (typeof window.speechSynthesis !== "undefined") {
    window.speechSynthesis.cancel();
  }
}

/** Drop the cached audio and re-enable the cloud path. Used by "delete everything" and tests. */
export function resetSpeechSession(): void {
  stopSpeaking();
  audioCache.clear();
  inFlight.clear();
  cloudDisabled = false;
}

/* ---------------------------------------------------------------- cloud path */

/**
 * One clip from `/api/tts`, cached and de-duplicated.
 *
 * The abort signal is deliberately NOT passed to `fetch`. A clip is shared between the line being
 * spoken and the warm-up that asked for it first, so cancelling the utterance must not cancel a
 * download somebody else is waiting on — and the bytes are worth keeping even for a line that was
 * interrupted, because 再講一次 is one tap away. `speak` races the shared request against its own
 * signal instead, below.
 */
function requestAudio(text: string, dialect: Dialect): Promise<Blob | null> {
  const key = cacheKey(text, dialect);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = fetchAudio(text, dialect).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

/** Fetch one clip from `/api/tts`. Returns null when the server says "use the browser". */
async function fetchAudio(text: string, dialect: Dialect): Promise<Blob | null> {
  const key = cacheKey(text, dialect);
  const cached = audioCache.get(key);
  if (cached) return cached;
  if (cloudDisabled) return null;

  let response: Response;
  try {
    response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, dialect }),
    });
  } catch {
    // Offline, blocked, or aborted. The caller falls through to text-only, not to another voice.
    return null;
  }

  if (response.status === 503) {
    // Configured for browser speech. Stop asking for the rest of the session.
    cloudDisabled = true;
    return null;
  }
  if (!response.ok) return null;

  const blob = await response.blob();
  if (blob.size === 0) return null;
  audioCache.set(key, blob);
  return blob;
}

/** The clip for one line, given up on if the caller's utterance is cancelled while it is in the air. */
function audioFor(text: string, dialect: Dialect, signal?: AbortSignal): Promise<Blob | null> {
  const cached = audioCache.get(cacheKey(text, dialect));
  if (cached) return Promise.resolve(cached);
  if (signal?.aborted) return Promise.resolve(null);

  const request = requestAudio(text, dialect);
  if (!signal) return request;

  return Promise.race([
    request,
    new Promise<null>((resolve) => {
      signal.addEventListener("abort", () => resolve(null), { once: true });
    }),
  ]);
}

/**
 * Play a blob to completion on the shared element. Resolves false if playback could not start.
 *
 * Every clip goes through the SAME element, because on iOS only an element a finger has touched
 * may make a sound (`lib/speech/unlock.ts`). Assigning `src` and calling `play()` on an already
 * unlocked element needs no gesture of its own, which is what lets 明仔 keep talking.
 */
async function playBlob(blob: Blob, signal?: AbortSignal): Promise<boolean> {
  const audio = speechAudio();
  if (!audio || signal?.aborted) return false;

  // Ends the previous clip, revokes its URL and clears its handlers off the shared element.
  stopSpeaking();

  const url = URL.createObjectURL(blob);
  currentObjectUrl = url;

  let settle!: (played: boolean) => void;
  const finished = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const done = (ok: boolean) => {
    if (endCurrentClip === done) endCurrentClip = null;
    audio.onended = null;
    audio.onerror = null;
    settle(ok);
  };
  endCurrentClip = done;
  audio.onended = () => done(true);
  audio.onerror = () => done(false);
  signal?.addEventListener("abort", () => done(false), { once: true });

  audio.src = url;
  try {
    await audio.play();
  } catch {
    // Autoplay policy, or a newer clip took the element. The device voice is no more likely to
    // work in that state, but the caller still gets a truthful mode back.
    if (endCurrentClip === done) stopSpeaking();
    return false;
  }
  // It made a sound, so the element is unlocked however that came about — and the safety-net
  // listener can stop reaching for an element that is already working.
  noteAudioPlaying();

  const ok = await finished;
  if (endCurrentClip === done) stopSpeaking();
  return ok;
}

/* -------------------------------------------------------------- browser path */

function normaliseLang(lang: string): string {
  return lang.toLowerCase().replace(/_/g, "-");
}

/**
 * Score a voice for a dialect. Higher wins; -1 means unusable.
 *
 * `voice.lang` is matched by prefix because the same voice is reported as "zh-HK", "zh_HK" or
 * "yue-Hant-HK" depending on platform. On iOS the zh-HK voice is named "Sin-ji", so that name
 * gets a bonus: it is the good one, and some devices also list a generic zh-HK entry.
 */
function scoreVoice(voice: SpeechSynthesisVoice, dialect: Dialect): number {
  const lang = normaliseLang(voice.lang ?? "");
  const name = (voice.name ?? "").toLowerCase();

  if (dialect === "yue") {
    let score = -1;
    if (lang.startsWith("zh-hk")) score = 100;
    else if (lang.startsWith("yue")) score = 95;
    else if (lang.startsWith("zh-yue")) score = 95;
    if (score < 0) return -1;
    if (name.includes("sin-ji") || name.includes("sinji")) score += 50;
    if (name.includes("cantonese") || name.includes("粵") || name.includes("粤")) {
      score += 20;
    }
    return score;
  }

  // Mandarin: zh-HK and zh-TW voices are the wrong reading, so they never qualify.
  if (lang.startsWith("zh-hk") || lang.startsWith("zh-tw") || lang.startsWith("yue")) return -1;
  if (lang.startsWith("zh-cn")) return 100;
  if (lang.startsWith("cmn")) return 95;
  if (lang.startsWith("zh-hans")) return 90;
  if (lang === "zh") return 60;
  return -1;
}

function readVoices(): SpeechSynthesisVoice[] {
  if (!isBrowser() || typeof window.speechSynthesis === "undefined") return cachedVoices;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) cachedVoices = voices;
  return cachedVoices;
}

/**
 * Wait for the platform to populate its voice list. Chrome and iOS Safari both return [] on the
 * first synchronous call. Call this once on mount before relying on `getVoiceAvailability`.
 */
export function ensureVoicesLoaded(): Promise<SpeechSynthesisVoice[]> {
  if (!isBrowser() || typeof window.speechSynthesis === "undefined") {
    return Promise.resolve([]);
  }
  const immediate = readVoices();
  if (immediate.length > 0) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const finish = () => {
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", finish);
      resolve(readVoices());
    };
    const timer = setTimeout(finish, VOICE_LOAD_TIMEOUT_MS);
    synth.addEventListener("voiceschanged", finish, { once: true });
  });
}

function pickVoice(dialect: Dialect): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of readVoices()) {
    const score = scoreVoice(voice, dialect);
    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }
  return bestScore >= 0 ? best : null;
}

/**
 * Which dialects the device can speak with its own voices. Cloud availability is not knowable
 * from the client, so this only answers "is the fallback there": the UI uses it to show the
 * on-screen-text state up front instead of after a silent tap.
 */
export function getVoiceAvailability(): { yue: boolean; cmn: boolean } {
  return { yue: pickVoice("yue") !== null, cmn: pickVoice("cmn") !== null };
}

/** Speak with the device voice. Resolves false when there is no usable voice. */
async function speakWithBrowser(
  text: string,
  dialect: Dialect,
  opts?: SpeakOptions,
): Promise<boolean> {
  if (!isBrowser() || typeof window.speechSynthesis === "undefined") return false;
  await ensureVoicesLoaded();
  const voice = pickVoice(dialect);
  if (!voice) return false;

  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  if (typeof opts?.rate === "number") utterance.rate = opts.rate;

  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      utterance.onend = null;
      utterance.onerror = null;
      resolve(ok);
    };
    utterance.onend = () => done(true);
    utterance.onerror = () => done(false);
    opts?.signal?.addEventListener(
      "abort",
      () => {
        window.speechSynthesis.cancel();
        done(false);
      },
      { once: true },
    );
    window.speechSynthesis.speak(utterance);
  });
}

/* ------------------------------------------------------------------- public */

/**
 * Speak one card. Returns the mode that actually produced sound, so the UI can show the
 * "on screen only" state honestly when it is `text-only`.
 */
export async function speak(
  text: string,
  dialect: Dialect,
  opts?: SpeakOptions,
): Promise<SpeakResult> {
  if (!isBrowser() || text.trim().length === 0) return { mode: "text-only" };

  const blob = await audioFor(text, dialect, opts?.signal);
  if (blob && (await playBlob(blob, opts?.signal))) return { mode: "cloud" };

  /**
   * The device's own voice used to sit here, and it has been removed deliberately.
   *
   * It was reached whenever a cloud clip failed to fetch OR failed to play — and on iOS the
   * commonest reason for the second is the autoplay policy, which fires on the ordinary path
   * where 明仔 speaks without being tapped. The result was a product that read most lines in the
   * chosen Cantonese voice and occasional lines in iOS's own robot, mid-conversation, with no
   * explanation. Kevin heard it immediately on a real phone and it reads as broken, because it is.
   *
   * A companion has ONE voice. If that voice cannot speak, the honest state is silence with the
   * words on screen — which the interface already designs for (`fallback.noVoice*`), and which is
   * what `text-only` means to every caller. `speakWithBrowser` is kept below for the deliberate
   * device-speech configuration (`TTS_PROVIDER=browser`), where it is the chosen voice rather
   * than an unannounced substitute.
   */
  if (deviceSpeechIsChosen()) {
    if (await speakWithBrowser(text, dialect, opts)) return { mode: "browser" };
  }

  return { mode: "text-only" };
}

/**
 * Warm the cache for lines that are about to be read, three requests at a time, so the voice
 * starts as the words do (research.md R5: "audio for every card is requested as soon as the card
 * arrives, in parallel, not on tap").
 *
 * Each MiniMax call measures two to three seconds. Asked for at the moment the bubble appears,
 * that is the whole line typed out and sitting there before a sound comes out of the phone —
 * which is what Kevin heard, and it is not a slow network, it is the request being made too late.
 * Warming the NEXT line while the current one is speaking moves the entire wait into a window
 * where 明仔 is already talking, and `requestAudio` makes sure the line that was warmed is joined
 * rather than fetched a second time.
 *
 * Never throws and never plays anything; a warm-up that fails just means `speak` fetches it or
 * falls back later.
 */
export async function prefetch(texts: PrefetchItem[]): Promise<void> {
  if (!isBrowser() || cloudDisabled) return;

  const seen = new Set<string>();
  const queue: PrefetchItem[] = [];
  for (const item of texts) {
    const key = cacheKey(item.text, item.dialect);
    if (seen.has(key) || audioCache.has(key) || item.text.trim().length === 0) continue;
    seen.add(key);
    queue.push(item);
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < queue.length && !cloudDisabled) {
      const item = queue[next];
      next += 1;
      try {
        await requestAudio(item.text, item.dialect);
      } catch {
        // Prefetch is best-effort by definition.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, worker),
  );
}

/** True when this exact string is already in the session cache. */
export function isCached(text: string, dialect: Dialect): boolean {
  return audioCache.has(cacheKey(text, dialect));
}
