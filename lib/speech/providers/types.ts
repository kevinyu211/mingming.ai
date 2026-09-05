/**
 * Shared types for the speech provider adapters.
 *
 * Server-side only. Nothing in `lib/speech/providers/` may be imported by a client
 * component: these modules read API keys from `process.env`. The client layer
 * (`lib/speech/tts.ts`, `lib/speech/stt.ts`) may only `import type` from here, which the
 * compiler erases, so no runtime code crosses the boundary.
 *
 * Constitution principle V ("nothing leaves the phone except the question") applies to every
 * adapter: only the text of a card or an answer is sent to a voice provider, and only the
 * recorded question is sent to a transcription provider. Never the profile, never the image,
 * never an identifier. And nothing in this directory may log the text or the audio - see
 * `logSpeechEvent` below for the only shape of logging that is allowed.
 */

import type { Dialect } from "@/lib/domain/schemas";

/**
 * Output dialect for spoken cards: the domain type, re-exported rather than restated.
 *
 * There is exactly ONE definition, in `lib/domain/schemas.ts`, and it is the same set of keys as
 * `Speakable`. This file used to declare its own two-value copy, which is how the speech layer
 * fell a language behind the reading layer when English was added; a re-export cannot drift.
 */
export type { Dialect };

/**
 * Language the user asks a question in. The same three values as `Dialect` today, kept separate
 * because it answers a different question — what was spoken INTO the phone, not what the phone
 * speaks back — and the two need not move together.
 */
export type InputLanguage = "yue" | "cmn" | "en";

/** Audio returned by a text-to-speech adapter. */
export interface SynthesisResult {
  audio: Uint8Array;
  mimeType: string;
}

/** Text returned by a speech-to-text adapter. */
export interface TranscriptionResult {
  text: string;
}

export interface TtsProvider {
  /** Stable id used in logs, eval output and the data statement. */
  id: string;
  synthesize(text: string, dialect: Dialect): Promise<SynthesisResult>;
}

export interface SttProvider {
  /** Stable id used in logs, eval output and the data statement. */
  id: string;
  transcribe(
    audio: Uint8Array,
    mimeType: string,
    language: InputLanguage,
  ): Promise<TranscriptionResult>;
}

/**
 * Thrown when a provider is selected but its configuration is incomplete (missing key,
 * missing region, missing group id). The message names the environment variables to set and
 * never contains a key value.
 */
export class SpeechConfigError extends Error {
  readonly code = "speech_config";
  readonly provider: string;
  readonly missing: readonly string[];

  constructor(provider: string, missing: readonly string[]) {
    super(
      `Speech provider "${provider}" is selected but not configured. Set ${missing.join(
        ", ",
      )} in the environment (see .env.example), or set TTS_PROVIDER/STT_PROVIDER to "browser".`,
    );
    this.name = "SpeechConfigError";
    this.provider = provider;
    this.missing = missing;
  }
}

/**
 * Thrown when a provider's HTTP call fails. Carries the status code and the provider id only;
 * the response body is deliberately not attached, because provider errors can echo the request
 * text back and this error may be logged.
 */
export class SpeechProviderError extends Error {
  readonly code = "speech_provider";
  readonly provider: string;
  readonly status: number;

  constructor(provider: string, status: number, detail?: string) {
    super(
      `Speech provider "${provider}" failed with status ${status}${detail ? ` (${detail})` : ""}.`,
    );
    this.name = "SpeechProviderError";
    this.provider = provider;
    this.status = status;
  }
}

/** Read an environment variable, treating "" and whitespace as unset. */
export function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Read an environment variable with a fallback default. */
export function readEnvOr(name: string, fallback: string): string {
  return readEnv(name) ?? fallback;
}

/**
 * Copy audio bytes into a plain `ArrayBuffer` for use as a `BodyInit` or a `BlobPart`.
 *
 * Since TypeScript 5.7 those types require an `ArrayBuffer`-backed view, and a bare
 * `Uint8Array` is `Uint8Array<ArrayBufferLike>`, which could in principle be backed by a
 * `SharedArrayBuffer`. `fetch` accepts it at runtime, but the compiler is right that the
 * general type is wider than the API allows, so this copies rather than casting. A question
 * clip is tens of kilobytes; the copy does not matter.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * The ONLY logging allowed in this directory.
 *
 * Provider id, operation, dialect/language tag, HTTP status and duration are safe: they say
 * nothing about the patient or the sheet. Text, audio bytes, request bodies, response bodies
 * and API keys must never be passed here or logged anywhere else (constitution principle V,
 * research.md R5: "the route returns audio bytes and never logs the text").
 */
export function logSpeechEvent(event: {
  provider: string;
  op: "synthesize" | "transcribe";
  tag: Dialect | InputLanguage;
  status: number;
  ms: number;
  bytes?: number;
  /** The provider's own numeric failure code (MiniMax `base_resp.status_code`); never its text. */
  code?: number;
  /** This attempt failed and one more is about to be made. */
  retried?: boolean;
}): void {
  const { provider, op, tag, status, ms, bytes, code, retried } = event;
  console.info(
    `[speech] provider=${provider} op=${op} lang=${tag} status=${status} ms=${Math.round(ms)}${
      typeof bytes === "number" ? ` bytes=${bytes}` : ""
    }${typeof code === "number" ? ` code=${code}` : ""}${retried ? " retry=1" : ""}`,
  );
}
