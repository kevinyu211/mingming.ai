"use client";

/**
 * Hearing the question, on the phone.
 *
 * Push-to-talk. The chain is cloud, then browser, then the typed box (research.md R6):
 *
 *   1. When `NEXT_PUBLIC_STT_MODE` is "cloud", capture with `MediaRecorder` and post the clip
 *      to `/api/stt`. No interim text is possible on this path.
 *   2. Otherwise (or when the cloud path is unavailable), the browser
 *      `SpeechRecognition` / `webkitSpeechRecognition` API with `lang` set to zh-HK, zh-CN or
 *      en-HK, reporting interim results through `onInterim`.
 *   3. Neither available: throw `SpeechUnavailableError`, which is the UI's signal to show the
 *      typed box. The typed box is visible at all times anyway; this just moves focus to it.
 *
 * Only the recorded question is sent (constitution principle V). The transcript is shown to the
 * user before it is submitted, which is why R6 accepts the lower-accuracy browser path.
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
   * Partial transcript as the user speaks. Browser path only: `MediaRecorder` produces no
   * interim text, so on the cloud path this is never called.
   */
  onInterim?: (text: string) => void;
  /** Release-to-send. Abort this to stop capture and transcribe what was recorded. */
  stop?: AbortSignal;
  /** Hard cancel. Abort this to discard the recording; `listen` then resolves with "". */
  cancel?: AbortSignal;
  /** Safety stop. Default 15 s: a question about a discharge sheet is short. */
  maxMs?: number;
}

const DEFAULT_MAX_MS = 15_000;

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

function listenWithBrowser(
  language: InputLanguage,
  opts: ListenOptions,
): Promise<{ text: string }> {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return Promise.reject(
      new SpeechUnavailableError("no_api", "This browser has no SpeechRecognition API."),
    );
  }

  const recognition = new Ctor();
  recognition.lang = recognitionLocale(language);
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  return new Promise<{ text: string }>((resolve, reject) => {
    let finalText = "";
    let settled = false;
    let failure: SpeechUnavailableError | null = null;

    const cleanup = () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      clearTimeout(timer);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (interim && opts.onInterim) opts.onInterim(finalText + interim);
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

    recognition.onend = () => {
      const text = finalText.trim();
      if (failure && text.length === 0) settle(() => reject(failure));
      else settle(() => resolve({ text }));
    };

    const timer = setTimeout(() => recognition.stop(), opts.maxMs ?? DEFAULT_MAX_MS);
    opts.stop?.addEventListener("abort", () => recognition.stop(), { once: true });
    opts.cancel?.addEventListener(
      "abort",
      () => {
        recognition.abort();
        settle(() => resolve({ text: "" }));
      },
      { once: true },
    );

    try {
      recognition.start();
    } catch {
      settle(() =>
        reject(new SpeechUnavailableError("no_api", "Recognition could not be started.")),
      );
    }
  });
}

/* ------------------------------------------------------------- cloud capture */

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Record until stopped, then post the clip to `/api/stt`. */
async function listenWithCloud(
  language: InputLanguage,
  opts: ListenOptions,
): Promise<{ text: string }> {
  if (
    !isBrowser() ||
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

  const mimeType = pickRecorderMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  let cancelled = false;

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const endCapture = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };

  const timer = setTimeout(endCapture, opts.maxMs ?? DEFAULT_MAX_MS);
  opts.stop?.addEventListener("abort", endCapture, { once: true });
  opts.cancel?.addEventListener(
    "abort",
    () => {
      cancelled = true;
      endCapture();
    },
    { once: true },
  );

  recorder.start();
  await stopped;
  clearTimeout(timer);
  for (const track of stream.getTracks()) track.stop();

  if (cancelled) return { text: "" };

  const clip = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
  if (clip.size === 0) throw new SpeechUnavailableError("no_speech", "Nothing was recorded.");

  let response: Response;
  try {
    response = await fetch(`/api/stt?language=${encodeURIComponent(language)}`, {
      method: "POST",
      headers: { "Content-Type": clip.type },
      body: clip,
    });
  } catch {
    throw new SpeechUnavailableError("network", "The transcription request did not go through.");
  }

  // 503 means the server is configured for browser recognition; fall through to it.
  if (response.status === 503) return listenWithBrowser(language, opts);
  if (!response.ok) {
    throw new SpeechUnavailableError("provider", `Transcription failed (${response.status}).`);
  }

  const payload = (await response.json()) as { text?: string };
  return { text: (payload.text ?? "").trim() };
}

/* ------------------------------------------------------------------- public */

/** True when some form of speech input exists on this device. */
export function isSttAvailable(): boolean {
  if (!isBrowser()) return false;
  if (getSttMode() === "cloud") {
    return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }
  return getSpeechRecognitionCtor() !== null;
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

  if (getSttMode() === "cloud") {
    try {
      return await listenWithCloud(language, opts);
    } catch (error) {
      // A missing recorder is not fatal while the browser API is there.
      if (error instanceof SpeechUnavailableError && error.reason === "no_api") {
        return listenWithBrowser(language, opts);
      }
      throw error;
    }
  }

  return listenWithBrowser(language, opts);
}
