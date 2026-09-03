/**
 * ElevenLabs adapter: Eleven v3 text-to-speech and Scribe speech-to-text. Server-side only.
 *
 * Candidates T2 and S1 in `provider_shortlist.md`. research.md R5 is explicit that ElevenLabs
 * is included for TTS only if its Cantonese passes the blind listening test - several 2026
 * comparisons report multilingual voices reading traditional characters with Mandarin tones.
 * Scribe (STT) documents Cantonese and is the first STT candidate (R6).
 *
 * ┌── CONFIRM AGAINST THE DOCS BEFORE THE FIRST LIVE CALL ─────────────────────────────────┐
 * │ https://elevenlabs.io/docs/api-reference/text-to-speech/convert                         │
 * │ https://elevenlabs.io/docs/api-reference/speech-to-text/convert                         │
 * │ Not exercised against the live API. Confirm:                                            │
 * │   1. `model_id` for TTS - default "eleven_v3" here; check whether the HTTP convert       │
 * │      endpoint accepts v3 or requires "eleven_multilingual_v2".                          │
 * │   2. Whether `language_code` is accepted alongside the chosen model, and that "yue" is  │
 * │      the Cantonese tag (vs "zh" for Mandarin and "en" for English).                     │
 * │   3. The default voice ids below are placeholders - the listening test writes the real  │
 * │      ones into ELEVENLABS_VOICE_YUE / ELEVENLABS_VOICE_CMN / ELEVENLABS_VOICE_EN.       │
 * │   4. STT multipart field names (`file`, `model_id`, `language_code`) and the Scribe     │
 * │      model id ("scribe_v1").                                                            │
 * │   5. STT language codes: ISO-639-3 is assumed (yue / zho / eng).                        │
 * └────────────────────────────────────────────────────────────────────────────────────────┘
 */

import {
  logSpeechEvent,
  readEnv,
  readEnvOr,
  SpeechConfigError,
  SpeechProviderError,
  toArrayBuffer,
  type Dialect,
  type InputLanguage,
  type SttProvider,
  type TtsProvider,
} from "./types";

const PROVIDER_ID = "elevenlabs";

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_TTS_MODEL = "eleven_v3";
const DEFAULT_STT_MODEL = "scribe_v1";

/**
 * Placeholder voice ids (ElevenLabs' long-standing public library voices). They exist on every
 * account, so a first run will not 404, but they are NOT a Cantonese pick - the day-one
 * listening test replaces them via ELEVENLABS_VOICE_YUE / ELEVENLABS_VOICE_CMN. The same id is
 * the English default too, where it is at least a native English voice rather than a stand-in,
 * and ELEVENLABS_VOICE_EN overrides it.
 */
const DEFAULT_VOICE_YUE = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_VOICE_CMN = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_VOICE_EN = "21m00Tcm4TlvDq8ikWAM";

/** BCP-47-ish tag the TTS endpoint expects per output dialect. */
function ttsLanguageCode(dialect: Dialect): string {
  switch (dialect) {
    case "yue":
      return "yue";
    case "cmn":
      return "zh";
    case "en":
      return "en";
  }
}

/** ISO-639-3 tag Scribe expects per input language. */
function sttLanguageCode(language: InputLanguage): string {
  switch (language) {
    case "yue":
      return "yue";
    case "cmn":
      return "zho";
    case "en":
      return "eng";
  }
}

function voiceId(dialect: Dialect): string {
  switch (dialect) {
    case "yue":
      return readEnvOr("ELEVENLABS_VOICE_YUE", DEFAULT_VOICE_YUE);
    case "cmn":
      return readEnvOr("ELEVENLABS_VOICE_CMN", DEFAULT_VOICE_CMN);
    case "en":
      return readEnvOr("ELEVENLABS_VOICE_EN", DEFAULT_VOICE_EN);
  }
}

export interface ElevenLabsCredentials {
  apiKey: string;
  baseUrl: string;
  ttsModel: string;
  sttModel: string;
}

export function readElevenLabsCredentials(): ElevenLabsCredentials {
  const apiKey = readEnv("ELEVENLABS_API_KEY");
  if (!apiKey) throw new SpeechConfigError(PROVIDER_ID, ["ELEVENLABS_API_KEY"]);
  return {
    apiKey,
    baseUrl: readEnvOr("ELEVENLABS_BASE_URL", DEFAULT_BASE_URL).replace(/\/+$/, ""),
    ttsModel: readEnvOr("ELEVENLABS_MODEL", DEFAULT_TTS_MODEL),
    sttModel: readEnvOr("ELEVENLABS_STT_MODEL", DEFAULT_STT_MODEL),
  };
}

/** THE TTS request shape. */
export function buildElevenLabsTtsRequest(
  text: string,
  dialect: Dialect,
  creds: ElevenLabsCredentials,
): { url: string; init: RequestInit } {
  const url = `${creds.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId(dialect))}`;
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "xi-api-key": creds.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: creds.ttsModel,
        language_code: ttsLanguageCode(dialect),
      }),
    },
  };
}

/** THE STT request shape (multipart). */
export function buildElevenLabsSttRequest(
  audio: Uint8Array,
  mimeType: string,
  language: InputLanguage,
  creds: ElevenLabsCredentials,
): { url: string; init: RequestInit } {
  const form = new FormData();
  // Filename is a constant: it must never carry anything about the user or the question.
  form.append("file", new Blob([toArrayBuffer(audio)], { type: mimeType }), "question.audio");
  form.append("model_id", creds.sttModel);
  form.append("language_code", sttLanguageCode(language));
  return {
    url: `${creds.baseUrl}/v1/speech-to-text`,
    init: {
      method: "POST",
      // No Content-Type header: fetch sets the multipart boundary itself.
      headers: { "xi-api-key": creds.apiKey, Accept: "application/json" },
      body: form,
    },
  };
}

export function createElevenLabsTtsProvider(): TtsProvider {
  const creds = readElevenLabsCredentials();
  return {
    id: PROVIDER_ID,
    async synthesize(text, dialect) {
      const { url, init } = buildElevenLabsTtsRequest(text, dialect, creds);
      const startedAt = Date.now();
      const response = await fetch(url, init);
      if (!response.ok) {
        logSpeechEvent({
          provider: PROVIDER_ID,
          op: "synthesize",
          tag: dialect,
          status: response.status,
          ms: Date.now() - startedAt,
        });
        throw new SpeechProviderError(PROVIDER_ID, response.status);
      }
      // The body is the mp3 itself, not JSON.
      const audio = new Uint8Array(await response.arrayBuffer());
      logSpeechEvent({
        provider: PROVIDER_ID,
        op: "synthesize",
        tag: dialect,
        status: response.status,
        ms: Date.now() - startedAt,
        bytes: audio.byteLength,
      });
      return {
        audio,
        mimeType: response.headers.get("content-type") ?? "audio/mpeg",
      };
    },
  };
}

interface ScribeResponse {
  text?: string;
}

export function createElevenLabsSttProvider(): SttProvider {
  const creds = readElevenLabsCredentials();
  return {
    id: PROVIDER_ID,
    async transcribe(audio, mimeType, language) {
      const { url, init } = buildElevenLabsSttRequest(audio, mimeType, language, creds);
      const startedAt = Date.now();
      const response = await fetch(url, init);
      logSpeechEvent({
        provider: PROVIDER_ID,
        op: "transcribe",
        tag: language,
        status: response.status,
        ms: Date.now() - startedAt,
        bytes: audio.byteLength,
      });
      if (!response.ok) throw new SpeechProviderError(PROVIDER_ID, response.status);
      const payload = (await response.json()) as ScribeResponse;
      return { text: (payload.text ?? "").trim() };
    },
  };
}
