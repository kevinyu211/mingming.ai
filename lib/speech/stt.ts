"use client";

/**
 * Hearing the question, on the phone.
 *
 * Push-to-talk. **One engine per hold, chosen before the microphone opens.** In cloud mode that
 * is `getUserMedia` + `MediaRecorder` + `/api/stt`; everywhere else it is the browser's own
 * `SpeechRecognition`. The two never run at the same time any more, and this file is mostly the
 * story of why.
 *
 * ── What the phone actually did, and why "sometimes" was the symptom ─────────────────────────
 *
 * The previous build ran BOTH at once: recognition for instant on-screen words, a recorder for
 * the accurate upload. On a laptop that is free. On an iPhone it is two claims on one microphone,
 * and it produced a bar that worked, then did not, then did:
 *
 *   1. **Two permission prompts, racing.** iOS asks separately for the microphone and for speech
 *      recognition. Whichever the reader dismissed first killed the other, and the hold was over
 *      before either had answered. One capture path means one prompt.
 *   2. **The hold outlived by the prompt.** `getUserMedia` sat behind that prompt while the
 *      reader spoke and let go; the recorder started and stopped in the same tick and produced an
 *      empty clip, and the engine beside it had been listening to a muted session. Nothing was
 *      sent and nothing was said about it.
 *   3. **An unbounded wait.** `await recording.clip` had no ceiling. iOS Safari can leave a
 *      recorder whose audio session was taken away in `recording` with `onstop` never firing — so
 *      `listen()` never resolved, `ChatBar`'s `finally` never ran, and its `listening` guard
 *      stayed latched. Every hold after that returned at its first line. That is the failure that
 *      does not recover, and it matches "it works, then it doesn't" exactly.
 *   4. **The audio session was still set to playback.** `lib/speech/unlock.ts` sets
 *      `navigator.audioSession.type = "playback"` so the ring/silent switch cannot mute 明明.
 *      That is the right type for speaking and the wrong one for listening, so capture now claims
 *      `play-and-record` for the length of the hold and hands it straight back.
 *   5. **The bar said 「聽住你講…」 before anything was listening.** Measured in real Chrome on a
 *      cold page: `getUserMedia` had not resolved by the end of a 900 ms hold. The bar had gone
 *      jade at 220 ms regardless, so the reader said their whole sentence into a microphone that
 *      was not open yet, let go, and got 「我冇聽到」. On a phone that first call is behind a
 *      PERMISSION PROMPT, so this is the first hold of every session. `onOpen` now fires when
 *      capture is genuinely running, and the bar does not claim to be listening until it does.
 *
 * ── What is guaranteed now ───────────────────────────────────────────────────────────────────
 *
 * A hold that captured audio ends in TEXT or in a visible failure — never in silence. A hold that
 * captured nothing resolves `{ text: "" }`, which is the caller's cue to say so. Every path out,
 * including errors, cancels and timeouts, stops the microphone track: a leaked track is the other
 * good explanation for "the second one doesn't work", so releasing is idempotent and is done from
 * a `finally` as well as from the recorder's own events. And NOTHING in here awaits without a
 * ceiling, on either path — one unbounded await is all it takes to latch the bar for good.
 *
 * The price is the upload's second or two, during which the reader sees 「送緊…」 rather than
 * their own words appearing live. That is the trade, taken deliberately: a two-second path that
 * always works beats an instant one that fails one hold in three.
 *
 * ── When it falls back ───────────────────────────────────────────────────────────────────────
 *
 * Recording is not offered as a coin flip. If the recorder cannot be built, cannot start, hands
 * back nothing from a hold long enough to have contained words, or the route says this deployment
 * wants device speech (503), the session switches to `SpeechRecognition` for good — see
 * `forcedEngine`. Still one engine at a time; just a different one from the next hold on.
 *
 * With neither engine, `listen` throws `SpeechUnavailableError`, which is the UI's signal to show
 * the typed box. The typed box is visible at all times anyway; this just moves focus to it.
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
   * Partial transcript as the user speaks. Fires on the browser-engine path only — an upload has
   * nothing to report until it comes back, which is what the bar's 「送緊…」 state is for.
   */
  onInterim?: (text: string) => void;
  /**
   * Capture is genuinely running — the recogniser started, or the recorder did.
   *
   * Fires at most once, and never after the hold ends. This is what lets the bar wait before it
   * claims to be listening: `getUserMedia` can outlast a whole hold on a cold page, and on a
   * phone the first one sits behind a permission prompt.
   */
  onOpen?: () => void;
  /** Release-to-send. Abort this to stop capture and transcribe what was recorded. */
  stop?: AbortSignal;
  /** Hard cancel. Abort this to discard the recording; `listen` then resolves with "". */
  cancel?: AbortSignal;
  /** Safety stop. Default 15 s: a question about a discharge sheet is short. */
  maxMs?: number;
  /** How long ONE upload attempt gets. Default 6 s, and there are at most two attempts. */
  cloudTimeoutMs?: number;
}

const DEFAULT_MAX_MS = 15_000;

/**
 * How long one `/api/stt` attempt gets.
 *
 * Measured against gpt-4o-mini-transcribe on 2026-09-04: a 3.05 s Cantonese clip came back in a
 * median of 913 ms, worst of eight 1433 ms. Six seconds is room for a bad venue network, and a
 * failed attempt is retried once rather than given up on — there is no browser transcript behind
 * it any more, so this is the only thing standing between the reader and typing it out.
 */
const DEFAULT_CLOUD_TIMEOUT_MS = 6_000;

/**
 * How long the browser engine gets to deliver its last words after the hold ends. iOS Safari can
 * take a few hundred milliseconds to end a session, and sometimes never ends it at all — hence a
 * race, not an await.
 */
const RECOGNITION_SETTLE_MS = 700;

/**
 * How long the recorder gets to hand back its clip after `stop()` before the track is pulled out
 * from under it and the chunks already collected are used instead.
 *
 * This is the ceiling that did not exist before. A `MediaRecorder` whose audio session was taken
 * away can sit in `recording` forever with no `onstop`, and one unbounded `await` in here latched
 * the bar's own guard for the rest of the session.
 */
const CLIP_SETTLE_MS = 1_500;

/**
 * Chunk interval passed to `recorder.start()`.
 *
 * Without a timeslice a recorder delivers everything in one `dataavailable` at `stop()` — so a
 * recorder that never stops cleanly delivers nothing at all. With one, the clip is already on
 * hand and the settle timeout above has something to fall back to.
 */
const RECORDER_TIMESLICE_MS = 250;

/** Recording formats to try, in order of what the `/api/stt` providers handle best. */
const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/**
 * How long after the hold ends the microphone still gets to finish opening.
 *
 * Short on purpose. A microphone that opens after the reader has stopped talking has recorded
 * nothing worth sending, so the only thing this buys is the case where it opened in the same
 * breath as the release — and past it the honest answer is "it was not open", not "I did not hear
 * you", which are different sentences and lead to different behaviour from the reader.
 */
const MIC_OPEN_GRACE_MS = 300;

/**
 * A hold shorter than this cannot have contained a question, so an empty clip from one is a slip
 * of the thumb rather than a broken recorder — and must not switch the session off the cloud
 * path. `ChatBar`'s own 220 ms threshold means every hold that gets here is at least that long.
 */
const MEANINGFUL_HOLD_MS = 700;

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

function now(): number {
  return Date.now();
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
 * `heard()` is synchronous and always safe to call: it reads what has been heard SO FAR without
 * waiting for the engine to end its session, because iOS Safari does not reliably end one.
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

/** The browser engine on its own: what this app does wherever it cannot record. */
async function listenWithBrowser(
  language: InputLanguage,
  opts: ListenOptions,
): Promise<{ text: string }> {
  const recognition = startRecognition(language, opts.onInterim);
  if (!recognition) {
    throw new SpeechUnavailableError("no_api", "This browser has no SpeechRecognition API.");
  }
  // `start()` has already returned, so this engine is listening now and the bar may say so. It is
  // synchronous here, which is why the browser path looks exactly as instant as it always did.
  opts.onOpen?.();

  let cancelled = false;
  let releaseHold: () => void = () => {};
  const heldUntilReleased = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });

  const endHold = () => {
    recognition.stop();
    releaseHold();
  };
  const timer = setTimeout(endHold, opts.maxMs ?? DEFAULT_MAX_MS);
  opts.stop?.addEventListener("abort", endHold, { once: true });
  opts.cancel?.addEventListener(
    "abort",
    () => {
      cancelled = true;
      recognition.abort();
      releaseHold();
    },
    { once: true },
  );

  /*
   * The hold may already be over — this path is also reached as a mid-hold fallback when the
   * recorder turns out to be unusable, and `addEventListener` on a signal that has already
   * aborted never fires. Without this the session would run to `maxMs` with nobody holding
   * anything, which is fifteen seconds of a bar that looks alive and is not.
   */
  if (opts.cancel?.aborted) {
    cancelled = true;
    recognition.abort();
    releaseHold();
  } else if (opts.stop?.aborted) {
    endHold();
  }

  /*
   * A race, never a bare await. iOS Safari sometimes ends a `SpeechRecognition` session late and
   * sometimes never ends one at all, and an await with no ceiling in here is what latched
   * `ChatBar`'s listening guard and killed every hold after it. The engine gets its settle window
   * after the hold ends; then whatever it heard is what it heard.
   */
  await Promise.race([
    recognition.ended,
    heldUntilReleased.then(() => sleep(RECOGNITION_SETTLE_MS)),
  ]);
  clearTimeout(timer);
  if (cancelled) return { text: "" };

  const text = recognition.heard();
  const failure = recognition.failure();
  if (failure && text.length === 0) throw failure;
  return { text };
}

/* --------------------------------------------------------- iOS audio session */

interface AudioSessionLike {
  type: string;
}

function audioSession(): AudioSessionLike | null {
  if (typeof navigator === "undefined") return null;
  const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
  return session ?? null;
}

/**
 * Tell iOS this page is about to RECORD, and give the session back afterwards.
 *
 * `lib/speech/unlock.ts` sets the session type to `playback` so the ring/silent switch cannot
 * mute the reading. That is correct while 明明 is talking and wrong the moment the microphone
 * opens: `playback` is the type for a page that does not capture. Safari 16.4+ only; everywhere
 * else `navigator.audioSession` is absent and both halves of this are no-ops.
 *
 * Returns the restore, which is idempotent and safe to call from a `finally`.
 */
function claimRecordingSession(): () => void {
  const session = audioSession();
  if (!session) return () => {};

  let previous: string;
  try {
    previous = session.type;
    if (previous === "play-and-record") return () => {};
    session.type = "play-and-record";
  } catch {
    // Not settable on this build. Capture may still work; nothing here is load-bearing.
    return () => {};
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    try {
      session.type = previous;
    } catch {
      // Same as above: the page keeps whatever the browser left it with.
    }
  };
}

/* ------------------------------------------------------------- audio capture */

function canRecord(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** A running capture. `clip` ALWAYS resolves — with an empty blob when nothing was captured. */
interface Recording {
  readonly clip: Promise<Blob>;
  /** Ask the recorder to finish and deliver. Safe to call more than once. */
  stop(): void;
  /**
   * Stop the microphone track and settle the clip with whatever has arrived, right now, whatever
   * state the recorder claims to be in. Idempotent, and called from every path out.
   */
  release(): void;
}

const EMPTY_CLIP = () => new Blob([], { type: "" });

/** Which `getUserMedia` failures mean "this reader said no" and which mean "not today". */
function micError(error: unknown): SpeechUnavailableError {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return new SpeechUnavailableError("denied", "Microphone permission was refused.");
  }
  // NotFoundError, NotReadableError (the mic is busy — another tab, or a call), AbortError,
  // OverconstrainedError. None of them is permanent and none of them should move the bar to the
  // keyboard for the rest of the session.
  return new SpeechUnavailableError("provider", "The microphone could not be opened.");
}

function stopTracks(stream: MediaStream): void {
  try {
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // Nothing to stop. The point is that the caller can always ask.
  }
}

/**
 * Open the microphone and start recording. Throws `SpeechUnavailableError`.
 *
 * `onOpen` fires once `recorder.start()` has returned, which is the first moment anything in this
 * app is genuinely capturing audio. Everything before it is the phone deciding.
 */
async function startRecording(onOpen?: () => void): Promise<Recording> {
  if (!canRecord()) {
    throw new SpeechUnavailableError("no_api", "This browser cannot record audio.");
  }

  const restoreSession = claimRecordingSession();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    restoreSession();
    throw micError(error);
  }

  const mimeType = pickRecorderMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    stopTracks(stream);
    restoreSession();
    throw new SpeechUnavailableError("no_api", "This browser cannot record audio.");
  }

  const chunks: Blob[] = [];
  let deliver: ((clip: Blob) => void) | null = null;
  const clip = new Promise<Blob>((resolve) => {
    deliver = resolve;
  });

  /** Hands the clip over exactly once, however many events or timeouts race to do it. */
  const settle = () => {
    const hand = deliver;
    if (!hand) return;
    deliver = null;
    hand(
      chunks.length > 0
        ? new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" })
        : EMPTY_CLIP(),
    );
  };

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      // Safari throws `InvalidStateError` on a recorder whose track already ended. The chunks it
      // did produce are still in hand, which is the entire point of the timeslice.
    }
    stopTracks(stream);
    restoreSession();
    settle();
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = release;
  // A recorder that errors mid-hold must not leave the caller waiting on `clip` forever.
  recorder.onerror = release;

  try {
    // With a timeslice rather than one blob at the end: a recorder that never stops cleanly has
    // still handed over most of the utterance by the time anything gives up on it.
    recorder.start(RECORDER_TIMESLICE_MS);
  } catch {
    stopTracks(stream);
    restoreSession();
    throw new SpeechUnavailableError("no_api", "Recording could not be started.");
  }
  onOpen?.();

  return {
    clip,
    stop: () => {
      if (recorder.state === "inactive") {
        release();
        return;
      }
      try {
        // Force the tail of the utterance out before ending: the last partial chunk is often the
        // second half of a short question.
        recorder.requestData();
      } catch {
        // Not implemented, or the wrong state. `stop()` below delivers what there is.
      }
      try {
        recorder.stop();
      } catch {
        release();
      }
    },
    release,
  };
}

/* ------------------------------------------------------------------- upload */

type UploadOutcome =
  /** The route answered with words. */
  | { kind: "text"; text: string }
  /** The route answered, and there was nothing in the clip to transcribe. */
  | { kind: "empty" }
  /** 503: this deployment is configured for device speech. Retrying cannot help. */
  | { kind: "unconfigured" }
  /** A timeout, a dropped connection, a 5xx. Worth exactly one more try. */
  | { kind: "failed" };

/**
 * Post the clip to `/api/stt` once.
 *
 * Never throws, and never logs: the transcript is the reader's question and the clip is their
 * voice. What comes back is a shape the caller can act on, because with no second engine behind
 * it the difference between "the network dropped" and "this build does not do cloud speech" is
 * the difference between retrying and switching engines for good.
 */
async function uploadClip(
  clip: Blob,
  language: InputLanguage,
  timeoutMs: number,
): Promise<UploadOutcome> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/stt?language=${encodeURIComponent(language)}`, {
      method: "POST",
      headers: { "Content-Type": clip.type || "application/octet-stream" },
      body: clip,
      signal: abort.signal,
    });
    if (response.status === 503) return { kind: "unconfigured" };
    if (!response.ok) return { kind: "failed" };
    const payload = (await response.json()) as { text?: string };
    const text = (payload.text ?? "").trim();
    return text.length > 0 ? { kind: "text", text } : { kind: "empty" };
  } catch {
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------ engine choice */

type Engine = "upload" | "browser";

/**
 * Set for the rest of the page's life when the recorder proves it cannot do the job on THIS
 * device — it would not build, would not start, handed back nothing from a hold long enough to
 * have held a question, or the route said this deployment wants device speech.
 *
 * A per-hold coin flip is what made the old build feel random. This is decided once, on evidence,
 * and then it stops changing.
 */
let forcedEngine: Engine | null = null;

/** Fall back for good, but only to an engine that is actually there. */
function downgradeToBrowser(): void {
  if (getSpeechRecognitionCtor() !== null) forcedEngine = "browser";
}

/** Test seam: forget what this session learned. Never called by the app. */
export function resetSttEngine(): void {
  forcedEngine = null;
}

function chooseEngine(): Engine {
  if (getSttMode() !== "cloud") return "browser";
  if (forcedEngine) return forcedEngine;
  return canRecord() ? "upload" : "browser";
}

/* --------------------------------------------------------------- upload path */

/**
 * Record the hold, upload it, return the transcript.
 *
 * The contract, in order of what matters:
 *
 *   · audio captured + a transcript          → the transcript
 *   · audio captured + no transcript at all  → THROWS, so the bar can say so out loud
 *   · nothing captured (a slip of the thumb) → `{ text: "" }`, so the bar can say "say it again"
 *   · cancelled                              → `{ text: "" }` and nothing leaves the phone
 *
 * There is no fourth outcome where the reader spoke and the app said nothing.
 */
async function listenWithUpload(
  language: InputLanguage,
  opts: ListenOptions,
): Promise<{ text: string }> {
  const pressedAt = now();
  let recording: Recording | null = null;
  let holdOver = false;
  let cancelled = false;
  let released: () => void = () => {};
  const heldUntilReleased = new Promise<void>((resolve) => {
    released = resolve;
  });

  const endHold = () => {
    if (holdOver) return;
    holdOver = true;
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

  /*
   * Opening the microphone is RACED against the hold, never simply awaited.
   *
   * Measured in real Chrome: on a cold page `getUserMedia` had not resolved by the end of a
   * 900 ms hold, and on a phone the first one is behind a permission prompt that can sit there
   * for as long as the reader takes to read it. A bare await here means `listen()` cannot resolve
   * until the phone feels like it — which is the latched-guard failure all over again — and it
   * means the reader spends the whole hold talking to a microphone that is not open.
   */
  let opened = false;
  const markOpen = () => {
    if (holdOver) return;
    opened = true;
    opts.onOpen?.();
  };

  const opening = startRecording(markOpen);
  // Settled below through `Promise.race`; this only stops Node calling the rejection unhandled in
  // the window before the race observes it.
  opening.catch(() => {});

  const started = await Promise.race([
    opening.then(
      (ready) => ({ kind: "ready" as const, ready }),
      (error: unknown) => ({ kind: "failed" as const, error }),
    ),
    heldUntilReleased
      .then(() => sleep(MIC_OPEN_GRACE_MS))
      .then(() => ({ kind: "too-slow" as const })),
  ]);

  if (started.kind === "too-slow") {
    clearTimeout(timer);
    // The hold is over and the microphone still is not open. Whatever it hands back arrives with
    // nobody holding anything, so it is closed the moment it appears — an open track nobody is
    // using is the leak that makes the NEXT hold fail.
    void opening.then(
      (ready) => ready.release(),
      () => {},
    );
    if (cancelled) return { text: "" };
    throw new SpeechUnavailableError("provider", "The microphone did not open in time.");
  }

  if (started.kind === "failed") {
    clearTimeout(timer);
    const failure =
      started.error instanceof SpeechUnavailableError
        ? started.error
        : new SpeechUnavailableError("provider", "The microphone could not be opened.");

    // A refusal is the reader's answer and is permanent for this session; anything else is this
    // device saying "not through the recorder", so the session switches engines and, if the
    // reader is still holding, this very hold is served by the other one.
    if (failure.reason !== "denied") {
      downgradeToBrowser();
      if (forcedEngine === "browser" && !cancelled) {
        return listenWithBrowser(language, opts);
      }
    }
    throw failure;
  }

  recording = started.ready;
  // The hold can end behind the permission prompt — on a first run that prompt IS the first hold.
  // Nothing may keep the microphone open past it.
  if (holdOver) recording.stop();

  await heldUntilReleased;
  clearTimeout(timer);

  const heldMs = now() - pressedAt;
  const capture = recording;

  // Whatever happens below, the microphone is closed before this function returns. `release()`
  // also settles the clip, which is what puts a ceiling on the await underneath it.
  const settleTimer = setTimeout(() => capture.release(), CLIP_SETTLE_MS);
  let clip: Blob;
  try {
    clip = await capture.clip;
  } finally {
    clearTimeout(settleTimer);
    capture.release();
  }

  if (cancelled) return { text: "" };

  if (clip.size === 0) {
    // Nothing came out of the recorder, and WHY decides which sentence the reader gets.
    //
    // The microphone finished opening after they had already let go — it won the race by a hair,
    // so there is a recorder here, but it was never listening while anybody was talking. That is
    // the same failure as the too-slow case above and it earns the same answer: "it was not
    // open", not "I did not hear you".
    if (!opened) {
      throw new SpeechUnavailableError("provider", "The microphone did not open in time.");
    }
    // It WAS open and still produced nothing. From a real hold that means the recorder does not
    // work on this device, so the session stops using it; from a flick of the thumb it means
    // exactly what it looks like.
    if (heldMs >= MEANINGFUL_HOLD_MS) downgradeToBrowser();
    return { text: "" };
  }

  const timeoutMs = opts.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS;
  let outcome = await uploadClip(clip, language, timeoutMs);
  // One retry, and only for the failures a retry can fix. A 503 means this build does not do
  // cloud speech at all, and an empty answer means the clip had no words in it.
  if (outcome.kind === "failed") outcome = await uploadClip(clip, language, timeoutMs);

  if (outcome.kind === "text") return { text: outcome.text };
  if (outcome.kind === "empty") return { text: "" };
  if (outcome.kind === "unconfigured") {
    downgradeToBrowser();
    throw new SpeechUnavailableError("network", "Speech is recognised on the device here.");
  }

  // Audio was captured and could not be turned into words. This is the case that used to end in
  // silence, and it is now the one thing this function is loudest about.
  throw new SpeechUnavailableError("network", "The recording could not be sent.");
}

/* ------------------------------------------------------------------- public */

/** True when some form of speech input exists on this device. */
export function isSttAvailable(): boolean {
  if (!isBrowser()) return false;
  const canRecognise = getSpeechRecognitionCtor() !== null;
  if (getSttMode() === "cloud") return canRecord() || canRecognise;
  return canRecognise;
}

/**
 * Capture one spoken question and return its transcript.
 *
 * Resolves `{ text: "" }` when the user cancels or nothing was captured, and throws
 * `SpeechUnavailableError` otherwise: `no_api` and `denied` are permanent for the session and are
 * the UI's cue to show the typed box for good, while `network`, `provider` and `no_speech` are
 * this hold only and must be SAID rather than swallowed.
 */
export async function listen(
  language: InputLanguage,
  opts: ListenOptions = {},
): Promise<{ text: string }> {
  if (!isBrowser()) {
    throw new SpeechUnavailableError("no_api", "Speech input needs a browser.");
  }
  if (chooseEngine() === "upload") return listenWithUpload(language, opts);
  return listenWithBrowser(language, opts);
}
