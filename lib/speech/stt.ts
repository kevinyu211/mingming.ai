"use client";

/**
 * Hearing the question, on the phone.
 *
 * Push-to-talk. On the cloud path both engines run AT THE SAME TIME (research.md R6):
 *
 *   1. The browser's `SpeechRecognition` starts first and reports interim text through
 *      `onInterim`, so the reader's words appear on screen while they are still speaking. That
 *      is what makes the bar feel instant, and it is the only thing that can — an upload cannot.
 *   2. `MediaRecorder` captures the same utterance alongside it.
 *   3. On release the clip is posted to `/api/stt`, and THAT transcript is the question. It is
 *      the accurate one, and it is far better at Cantonese than any browser engine.
 *   4. If the upload fails, times out, or comes back empty, the browser's own text is sent
 *      instead. A bad venue network degrades to yesterday's behaviour, never to silence.
 *
 * Why not the browser alone: it fails silently, it behaves differently on every iOS point
 * release, it is weak on Cantonese, and on Chrome it uploads the audio to Google anyway — so
 * "on device" was never true. Why not the cloud alone: nothing appears on screen until the
 * upload comes back, and the reader has no idea whether the phone heard them.
 *
 * When `NEXT_PUBLIC_STT_MODE` is not "cloud", or the device has no recorder, only step 1 runs.
 * With neither engine, `listen` throws `SpeechUnavailableError`, which is the UI's signal to
 * show the typed box. The typed box is visible at all times anyway; this just moves focus to it.
 *
 * Only the recorded question leaves the phone (constitution principle V): never the profile,
 * never the image, never an identifier.
 *
 * Client-only: the sole import from `lib/speech/providers/` is a type, erased at compile time.
 */

import type { InputLanguage } from "./providers/types";

export type SttMode = "cloud" | "browser";

export type SpeechUnavailableReason =
  | "no_api"
  | "denied"
  | "no_speech"
  | "network"
  | "provider";

/** Thrown when speech input cannot produce a transcript. The UI shows the typed box. */
export class SpeechUnavailableError extends Error {
  readonly code = "speech_unavailable";
  readonly reason: SpeechUnavailableReason;

  constructor(reason: SpeechUnavailableReason, message?: string) {
    super(message ?? `Speech input is unavailable (${reason}). Type the question instead.`);
    this.name = "SpeechUnavailableError";
    this.reason = reason;
  }
}

export interface ListenOptions {
  /**
   * Partial transcript as the user speaks, from the browser engine. On the hybrid path this
   * keeps firing even though the sent question will usually come from the upload instead.
   */
  onInterim?: (text: string) => void;
  /** Release-to-send. Abort this to stop capture and transcribe what was recorded. */
  stop?: AbortSignal;
  /** Hard cancel. Abort this to discard the recording; `listen` then resolves with "". */
  cancel?: AbortSignal;
  /** Safety stop. Default 15 s: a question about a discharge sheet is short. */
  maxMs?: number;
  /** How long the upload gets before the browser's text is sent instead. Default 6 s. */
  cloudTimeoutMs?: number;
}

const DEFAULT_MAX_MS = 15_000;

/**
 * How long `/api/stt` gets before the browser's own text is sent instead.
 *
 * Measured against gpt-4o-mini-transcribe on 2026-09-04: a 3.05 s Cantonese clip came back in a
 * median of 913 ms, worst of eight 1433 ms. Six seconds is room for a bad venue network and
 * still short enough that a reader who let go does not think the app died.
 */
const DEFAULT_CLOUD_TIMEOUT_MS = 6_000;

/**
 * How long the browser engine gets to deliver its last words after `stop()`, and only when the
 * upload gave us nothing so that text is all we have. iOS Safari can take a few hundred
 * milliseconds to end a session, and sometimes never ends it at all — hence a race, not an await.
 */
const RECOGNITION_SETTLE_MS = 700;

/** Recording formats to try, in order of what the `/api/stt` providers handle best. */
const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** Recognition locale per input language. Hong Kong English is `en-HK`. */
function recognitionLocale(language: InputLanguage): string {
  switch (language) {
    case "yue":
      return "zh-HK";
    case "cmn":
      return "zh-CN";
    case "en":
      return "en-HK";
  }
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Which path this build uses, from `NEXT_PUBLIC_STT_MODE`. This is the only speech setting the
 * client is told about; provider names and keys stay on the server.
 */
export function getSttMode(): SttMode {
  const value =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STT_MODE : undefined;
  return value === "cloud" ? "cloud" : "browser";
}

/* --------------------------------------------------- browser SpeechRecognition */

/**
 * Minimal structural types for the Web Speech API. TypeScript's `lib.dom` ships
 * `SpeechRecognitionResult` and friends but not the `SpeechRecognition` constructor, and never
 * the `webkit`-prefixed one that iOS Safari and older Chrome expose.
 */
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (!isBrowser()) return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * A running recognition session, held as a handle rather than a promise.
 *
 * The hybrid needs to read what has been heard SO FAR without waiting for the engine to end its
 * session, because on the good path the upload has already answered and the engine's tail is
 * pure latency. `heard()` is therefore synchronous and always safe to call.
 */
interface Recognition {
  /** Resolves when the engine's session has ended. May never resolve; always race it. */
  readonly ended: Promise<void>;
  /** Best text so far: the final transcript, else the last interim guess. */
  heard(): string;
  /** Why the session failed, once it has ended. Null while it is still running. */
  failure(): SpeechUnavailableError | null;
  /** Ask the engine to finish and deliver. */
  stop(): void;
  /** Throw the session away. */
  abort(): void;
}

/** Start the browser engine. Returns null when this device has none, or refuses to start. */
function startRecognition(
  language: InputLanguage,
  onInterim?: (text: string) => void,
): Recognition | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = recognitionLocale(language);
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  /**
   * The last interim transcript, kept because releasing the bar usually beats the final result.
   *
   * `stop()` ends the session, and on iOS Safari a short utterance frequently ends WITHOUT the
   * engine ever promoting its interim guess to `isFinal` — so `finalText` is empty and the
   * reader watched their own words appear in the bubble and then vanish unsent. That is the
   * "I said it, I let go, and nothing happened" everyone hits.
   *
   * An interim transcript is the engine's best guess rather than its confirmed one, so it is
   * only used when there is no final at all. Sending the reader's words as heard beats sending
   * nothing and making them say it twice.
   */
  let interimText = "";
  let failure: SpeechUnavailableError | null = null;
  let done = false;
  let settle: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const finish = () => {
    if (done) return;
    done = true;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    settle();
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (interim) interimText = interim;
    if (interim && onInterim) onInterim(finalText + interim);
  };

  recognition.onerror = (event) => {
    const code = event.error ?? "";
    if (code === "not-allowed" || code === "service-not-allowed") {
      failure = new SpeechUnavailableError("denied", "Microphone permission was refused.");
    } else if (code === "no-speech" || code === "audio-capture") {
      failure = new SpeechUnavailableError("no_speech", "Nothing was heard.");
    } else if (code === "aborted") {
      failure = null;
    } else {
      failure = new SpeechUnavailableError("network", `Recognition failed (${code}).`);
    }
  };

  recognition.onend = finish;

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    ended,
    heard: () => (finalText.trim() || interimText.trim()).trim(),
    failure: () => failure,
    stop: () => {
      try {
        recognition.stop();
      } catch {
        finish();
      }
    },
    abort: () => {
      try {
        recognition.abort();
      } catch {
        // Already gone. `finish` below is what actually matters.
      }
      finish();
    },
  };
}

/** The browser engine on its own: what this app did before the hybrid, and its fallback. */
async function listenWithBrowser(
  language: InputLanguage,
  opts: ListenOptions,
): Promise<{ text: string }> {
  const recognition = startRecognition(language, opts.onInterim);
  if (!recognition) {
    throw new SpeechUnavailableError("no_api", "This browser has no SpeechRecognition API.");
  }

  let cancelled = false;
  const timer = setTimeout(() => recognition.stop(), opts.maxMs ?? DEFAULT_MAX_MS);
  opts.stop?.addEventListener("abort", () => recognition.stop(), { once: true });
  opts.cancel?.addEventListener(
    "abort",
    () => {
      cancelled = true;
      recognition.abort();
    },
    { once: true },
  );

  await recognition.ended;
  clearTimeout(timer);
  if (cancelled) return { text: "" };

  const text = recognition.heard();
  const failure = recognition.failure();
  if (failure && text.length === 0) throw failure;
  return { text };
}

/* ------------------------------------------------------------- audio capture */

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** A running capture. `clip` always resolves, with an empty blob when nothing was captured. */
interface Recording {
  readonly clip: Promise<Blob>;
  stop(): void;
}

const EMPTY_CLIP = () => new Blob([], { type: "" });

/**
 * Open the microphone and start recording. Throws `SpeechUnavailableError`, which the hybrid
 * treats as "no accurate path today" rather than as a failure — the browser engine may still be
 * running beside it.
 */
async function startRecording(): Promise<Recording> {
  if (
    typeof MediaRecorder === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new SpeechUnavailableError("no_api", "This browser cannot record audio.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new SpeechUnavailableError("denied", "Microphone permission was refused.");
  }

  const release = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  const mimeType = pickRecorderMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    release();
    throw new SpeechUnavailableError("no_api", "This browser cannot record audio.");
  }

  const chunks: Blob[] = [];
  let deliver: (clip: Blob) => void = () => {};
  const clip = new Promise<Blob>((resolve) => {
    deliver = resolve;
  });

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    release();
    deliver(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
  };
  // A recorder that errors mid-hold must not leave the caller waiting on `clip` forever; an
  // empty blob is the signal to fall back to what the browser engine heard.
  recorder.onerror = () => {
    release();
    deliver(EMPTY_CLIP());
  };

  try {
    recorder.start();
  } catch {
    release();
    throw new SpeechUnavailableError("no_api", "Recording could not be started.");
  }

  return {
    clip,
    stop: () => {
      if (recorder.state === "inactive") {
        // Never started, or already ended: there is no clip to wait for.
        release();
        deliver(EMPTY_CLIP());
        return;
      }
      recorder.stop();
    },
  };
}

/**
 * Post the clip to `/api/stt` and return the transcript, or null.
 *
 * Null for EVERY failure — no clip, no network, a timeout, a 503 meaning "recognise on the
 * device", a 502 from the provider, a body that is not JSON, an empty transcript. The caller
 * has the browser's text and one job: never turn a bad network into silence.
 */
async function transcribeClip(
  clip: Blob,
  language: InputLanguage,
  timeoutMs: number,
): Promise<string | null> {
  if (clip.size === 0) return null;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/stt?language=${encodeURIComponent(language)}`, {
      method: "POST",
      headers: { "Content-Type": clip.type || "application/octet-stream" },
      body: clip,
      signal: abort.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { text?: string };
    const text = (payload.text ?? "").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------- hybrid */

/**
 * Both engines at once: the browser for what the reader sees, the recording for what is sent.
 *
 * Neither is required. With no recorder this is exactly `listenWithBrowser`; with no browser
 * engine it is a plain record-and-upload, silent until the answer comes back. Only when both are
 * missing does it give up and ask for the keyboard.
 */
async function listenHybrid(
  language: InputLanguage,
  opts: ListenOptions,
): Promise<{ text: string }> {
  // Recognition starts FIRST, and synchronously: `getUserMedia` below can sit behind a
  // permission prompt for seconds, and nothing may delay words reaching the screen.
  const recognition = startRecognition(language, opts.onInterim);

  let recording: Recording | null = null;
  let holdOver = false;
  let cancelled = false;
  let released: () => void = () => {};
  const release = new Promise<void>((resolve) => {
    released = resolve;
  });

  const endHold = () => {
    if (holdOver) return;
    holdOver = true;
    recognition?.stop();
    recording?.stop();
    released();
  };

  const timer = setTimeout(endHold, opts.maxMs ?? DEFAULT_MAX_MS);
  opts.stop?.addEventListener("abort", endHold, { once: true });
  opts.cancel?.addEventListener(
    "abort",
    () => {
      cancelled = true;
      endHold();
    },
    { once: true },
  );

  let micFailure: SpeechUnavailableError | null = null;
  try {
    recording = await startRecording();
    // The hold can end behind the permission prompt. Nothing may keep the microphone open.
    if (holdOver) recording.stop();
  } catch (error) {
    micFailure = error instanceof SpeechUnavailableError ? error : null;
  }

  if (!recognition && !recording) {
    clearTimeout(timer);
    throw (
      micFailure ?? new SpeechUnavailableError("no_api", "This device has no speech input.")
    );
  }

  await release;
  clearTimeout(timer);

  if (cancelled) {
    recognition?.abort();
    return { text: "" };
  }

  // The accurate transcript, when the network allows it.
  if (recording) {
    const cloud = await transcribeClip(
      await recording.clip,
      language,
      opts.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS,
    );
    if (cloud) return { text: cloud };
  }

  // It did not, so send what the reader already watched appear on screen.
  if (recognition) {
    await Promise.race([recognition.ended, sleep(RECOGNITION_SETTLE_MS)]);
    const text = recognition.heard();
    const failure = recognition.failure();
    // Only the ENGINE's own failure counts here, never `micFailure`. A phone with no recorder
    // still has a working bar, so "this browser cannot record audio" must not be raised as
    // though speech input were gone — that would move the bar to the keyboard for good the
    // first time somebody held it and said nothing.
    if (failure && text.length === 0) throw failure;
    return { text };
  }

  // Recording only, and it gave us nothing. The caller says one sentence and the bar resets.
  return { text: "" };
}

/* ------------------------------------------------------------------- public */

/** True when some form of speech input exists on this device. */
export function isSttAvailable(): boolean {
  if (!isBrowser()) return false;
  const canRecognise = getSpeechRecognitionCtor() !== null;
  if (getSttMode() === "cloud") {
    const canRecord =
      typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    return canRecord || canRecognise;
  }
  return canRecognise;
}

/**
 * Capture one spoken question and return its transcript.
 *
 * Resolves `{ text: "" }` when the user cancels or said nothing usable, and throws
 * `SpeechUnavailableError` when speech input cannot work at all, which is the UI's cue to show
 * the typed box.
 */
export async function listen(
  language: InputLanguage,
  opts: ListenOptions = {},
): Promise<{ text: string }> {
  if (!isBrowser()) {
    throw new SpeechUnavailableError("no_api", "Speech input needs a browser.");
  }
  if (getSttMode() === "cloud") return listenHybrid(language, opts);
  return listenWithBrowser(language, opts);
}
