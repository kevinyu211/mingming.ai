/**
 * OpenAI audio transcription adapter. Server-side only.
 *
 * Speech-to-text ONLY: the voice stays MiniMax (`provider_shortlist.md` section 1), and this
 * file deliberately exports no `TtsProvider` so nothing can quietly switch it.
 *
 * Why this became the transcription provider: the browser's own `SpeechRecognition` fails
 * silently, behaves differently on every iOS point release, is weak on Cantonese, and on Chrome
 * uploads the audio to Google regardless — so "on-device" was never true anyway. `gpt-4o-mini-
 * transcribe` returns a usable Cantonese transcript of a three-second clip in well under a
 * second, which is fast enough to sit on the release of the talk bar.
 *
 * ┌── CONFIRMED AGAINST THE LIVE API ON 2026-09-04 ────────────────────────────────────────┐
 * │ https://platform.openai.com/docs/api-reference/audio/createTranscription                │
 * │ Cantonese clips synthesised with MiniMax were transcribed end to end. What was checked: │
 * │   1. Host and path: `https://api.openai.com/v1/audio/transcriptions`, bearer auth,      │
 * │      multipart body. CONFIRMED.                                                         │
 * │   2. `model`: "gpt-4o-mini-transcribe" (default), "gpt-4o-transcribe" and "whisper-1"   │
 * │      all accepted. OPENAI_STT_MODEL overrides.                                          │
 * │   3. `response_format`: the gpt-4o transcribe models accept only "json" and "text" -    │
 * │      "verbose_json" is rejected - so "json" is sent and `text` is read off it.          │
 * │   4. `language`: ISO-639-1. There is NO Cantonese code; "zh" is sent for both Chinese   │
 * │      input languages and the audio itself decides the reading. CONFIRMED to return      │
 * │      Cantonese wording rather than a Mandarin paraphrase.                               │
 * │   5. The filename extension is load-bearing: OpenAI infers the container from it and    │
 * │      rejects an unknown one. `fileNameFor` maps the recorder's mime type - iOS Safari    │
 * │      records `audio/mp4`, Chrome `audio/webm;codecs=opus`. CONFIRMED.                   │
 * └────────────────────────────────────────────────────────────────────────────────────────┘
 */

import {
  logSpeechEvent,
  readEnv,
  readEnvOr,
  SpeechConfigError,
  SpeechProviderError,
  toArrayBuffer,
  type InputLanguage,
  type SttProvider,
} from "./types";

const PROVIDER_ID = "openai";

const DEFAULT_BASE_URL = "https://api.openai.com";

/**
 * Default transcription model. Override with OPENAI_STT_MODEL.
 *
 * `gpt-4o-mini-transcribe` is the fast one, and speed is the whole point here: the reader has
 * let go of the bar and is watching a spinner. `gpt-4o-transcribe` is the same family and about
 * twice the wait; `whisper-1` is the older model and the only one that returns segments.
 */
const DEFAULT_STT_MODEL = "gpt-4o-mini-transcribe";

/**
 * ISO-639-1 hint. OpenAI has no Cantonese code — the ISO-639-1 set predates it and only ISO-639-3
 * has `yue` — so both Chinese input languages send `zh` and the audio decides which one it is.
 * Sending nothing at all was measurably worse: short clips get guessed as Japanese or Korean.
 */
function sttLanguageCode(language: InputLanguage): string {
  switch (language) {
    case "yue":
      return "zh";
    case "cmn":
      return "zh";
    case "en":
      return "en";
  }
}

/**
 * A written hint in the language we expect, used only for Cantonese.
 *
 * `zh` alone tends to come back in simplified characters with Mandarin word choice — 「什麼」
 * where a Hong Kong speaker said 「咩」. The prompt is a fixed sentence about clinic visits and
 * medicine, so it steers the decoder towards Cantonese particles and traditional characters
 * without carrying one word about the actual patient, the sheet or the question.
 */
const YUE_PROMPT = "以下係香港人用廣東話問嘅問題，關於出院紙、覆診同食藥。請用繁體中文書面粵語寫出嚟。";

function sttPrompt(language: InputLanguage): string | undefined {
  return language === "yue" ? YUE_PROMPT : undefined;
}

/**
 * Filename for the multipart part. OpenAI reads the container off the EXTENSION, not off the
 * part's `Content-Type`, and rejects anything it does not recognise — so the constant name the
 * other adapters use ("question.audio") gets a 400 here.
 *
 * The stem is still a constant: it must never carry anything about the user or the question.
 */
export function fileNameFor(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (base) {
    case "audio/mp4":
    case "video/mp4":
    case "audio/x-m4a":
      // iOS Safari's MediaRecorder output.
      return "question.mp4";
    case "audio/ogg":
    case "audio/opus":
      return "question.ogg";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return "question.wav";
    case "audio/mpeg":
    case "audio/mp3":
      return "question.mp3";
    case "audio/flac":
      return "question.flac";
    default:
      // Chrome and Android record webm/opus, and an unlabelled clip is far likelier to be that
      // than anything else. A wrong guess costs one 400, not a wrong transcript.
      return "question.webm";
  }
}

export interface OpenAiCredentials {
  apiKey: string;
  baseUrl: string;
  sttModel: string;
}

export function readOpenAiCredentials(): OpenAiCredentials {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) throw new SpeechConfigError(PROVIDER_ID, ["OPENAI_API_KEY"]);
  return {
    apiKey,
    baseUrl: readEnvOr("OPENAI_BASE_URL", DEFAULT_BASE_URL).replace(/\/+$/, ""),
    sttModel: readEnvOr("OPENAI_STT_MODEL", DEFAULT_STT_MODEL),
  };
}

/** THE request shape (multipart). One function, so the confirm-list above maps to one body. */
export function buildOpenAiSttRequest(
  audio: Uint8Array,
  mimeType: string,
  language: InputLanguage,
  creds: OpenAiCredentials,
): { url: string; init: RequestInit } {
  const form = new FormData();
  form.append(
    "file",
    new Blob([toArrayBuffer(audio)], { type: mimeType }),
    fileNameFor(mimeType),
  );
  form.append("model", creds.sttModel);
  form.append("language", sttLanguageCode(language));
  // "verbose_json" is rejected by the gpt-4o transcribe models; "json" works on all three.
  form.append("response_format", "json");
  const prompt = sttPrompt(language);
  if (prompt) form.append("prompt", prompt);
  return {
    url: `${creds.baseUrl}/v1/audio/transcriptions`,
    init: {
      method: "POST",
      // No Content-Type header: fetch sets the multipart boundary itself.
      headers: { Authorization: `Bearer ${creds.apiKey}`, Accept: "application/json" },
      body: form,
    },
  };
}

interface OpenAiTranscriptionResponse {
  text?: string;
}

export function createOpenAiSttProvider(): SttProvider {
  const creds = readOpenAiCredentials();
  return {
    id: PROVIDER_ID,
    async transcribe(audio, mimeType, language) {
      const { url, init } = buildOpenAiSttRequest(audio, mimeType, language, creds);
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
      const payload = (await response.json()) as OpenAiTranscriptionResponse;
      return { text: (payload.text ?? "").trim() };
    },
  };
}
