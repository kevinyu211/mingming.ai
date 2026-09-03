/**
 * Azure Speech adapter: zh-HK / zh-CN neural text-to-speech and conversation speech-to-text.
 * Server-side only.
 *
 * Candidates T3 and S2 in `provider_shortlist.md`. research.md R5 calls Azure "the safe
 * fallback if 1 and 2 disappoint": reliable Cantonese, SSML control, slightly flat delivery.
 *
 * ┌── CONFIRM AGAINST THE DOCS BEFORE THE FIRST LIVE CALL ─────────────────────────────────┐
 * │ https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech        │
 * │ https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short  │
 * │ Not exercised against the live API. Confirm:                                            │
 * │   1. Host shape `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1` and    │
 * │      `https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/...`.   │
 * │      Some tenants require a token from the issueToken endpoint rather than the raw key. │
 * │   2. `X-Microsoft-OutputFormat` value (audio-24khz-48kbitrate-mono-mp3 here).           │
 * │   3. Voice names still shipping: zh-HK-HiuMaanNeural / zh-CN-XiaoxiaoNeural /           │
 * │      en-HK-YanNeural (HiuGaai and WanLung are the other zh-HK options, and en-HK-Sam    │
 * │      the other Hong Kong English one, that the listening test should hear).             │
 * │   4. STT `Content-Type` for the codec actually produced by MediaRecorder on the demo    │
 * │      phone - Azure's short-audio REST endpoint accepts wav/PCM and ogg-opus; iOS Safari │
 * │      records mp4/AAC, which may need a transcode or the ElevenLabs path instead.        │
 * │   5. Response field `DisplayText` and `RecognitionStatus` values.                       │
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

const PROVIDER_ID = "azure";

const DEFAULT_VOICE_YUE = "zh-HK-HiuMaanNeural";
const DEFAULT_VOICE_CMN = "zh-CN-XiaoxiaoNeural";
/** Hong Kong English, not en-US: the accent the sheet's own English is read in locally. */
const DEFAULT_VOICE_EN = "en-HK-YanNeural";
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/** Azure requires a User-Agent on the TTS endpoint. It says nothing about the user. */
const USER_AGENT = "discharge-sheet-agent";

function voiceName(dialect: Dialect): string {
  switch (dialect) {
    case "yue":
      return readEnvOr("AZURE_VOICE_YUE", DEFAULT_VOICE_YUE);
    case "cmn":
      return readEnvOr("AZURE_VOICE_CMN", DEFAULT_VOICE_CMN);
    case "en":
      return readEnvOr("AZURE_VOICE_EN", DEFAULT_VOICE_EN);
  }
}

/** `xml:lang` for the SSML `<speak>` element. Must match the voice's own locale. */
function ssmlLang(dialect: Dialect): string {
  switch (dialect) {
    case "yue":
      return "zh-HK";
    case "cmn":
      return "zh-CN";
    case "en":
      return "en-HK";
  }
}

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

/**
 * Escape the five XML entities. Card text is quoted verbatim from the sheet and can contain
 * `&` (e.g. "Panadol & Co") or `<` (e.g. "< 2 weeks"), which would otherwise break the SSML
 * document or, worse, be interpreted as markup.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface AzureCredentials {
  key: string;
  region: string;
  outputFormat: string;
}

export function readAzureCredentials(): AzureCredentials {
  const key = readEnv("AZURE_SPEECH_KEY");
  const region = readEnv("AZURE_SPEECH_REGION");
  const missing: string[] = [];
  if (!key) missing.push("AZURE_SPEECH_KEY");
  if (!region) missing.push("AZURE_SPEECH_REGION");
  if (missing.length > 0) throw new SpeechConfigError(PROVIDER_ID, missing);
  return {
    key: key as string,
    region: region as string,
    outputFormat: readEnvOr("AZURE_SPEECH_OUTPUT_FORMAT", DEFAULT_OUTPUT_FORMAT),
  };
}

/** Build the SSML document for one card. */
export function buildAzureSsml(text: string, dialect: Dialect): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${ssmlLang(dialect)}">` +
    `<voice name="${voiceName(dialect)}">${escapeXml(text)}</voice>` +
    `</speak>`
  );
}

/** THE TTS request shape. */
export function buildAzureTtsRequest(
  text: string,
  dialect: Dialect,
  creds: AzureCredentials,
): { url: string; init: RequestInit } {
  return {
    url: `https://${creds.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    init: {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": creds.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": creds.outputFormat,
        "User-Agent": USER_AGENT,
      },
      body: buildAzureSsml(text, dialect),
    },
  };
}

/**
 * Azure's short-audio REST endpoint wants the codec spelled out. WAV needs the PCM
 * parameters; everything else is passed through unchanged (see confirm-note 4 above).
 */
export function azureAudioContentType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/wav" || base === "audio/x-wav" || base === "audio/wave") {
    return "audio/wav; codecs=audio/pcm; samplerate=16000";
  }
  return mimeType;
}

/** THE STT request shape. */
export function buildAzureSttRequest(
  audio: Uint8Array,
  mimeType: string,
  language: InputLanguage,
  creds: AzureCredentials,
): { url: string; init: RequestInit } {
  const url =
    `https://${creds.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
    `?language=${encodeURIComponent(recognitionLocale(language))}&format=simple`;
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": creds.key,
        "Content-Type": azureAudioContentType(mimeType),
        Accept: "application/json",
      },
      body: toArrayBuffer(audio),
    },
  };
}

export function createAzureTtsProvider(): TtsProvider {
  const creds = readAzureCredentials();
  return {
    id: PROVIDER_ID,
    async synthesize(text, dialect) {
      const { url, init } = buildAzureTtsRequest(text, dialect, creds);
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

interface AzureRecognitionResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
}

export function createAzureSttProvider(): SttProvider {
  const creds = readAzureCredentials();
  return {
    id: PROVIDER_ID,
    async transcribe(audio, mimeType, language) {
      const { url, init } = buildAzureSttRequest(audio, mimeType, language, creds);
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
      const payload = (await response.json()) as AzureRecognitionResponse;
      // NoMatch / InitialSilenceTimeout are not failures: the caller shows the typed box.
      return { text: (payload.DisplayText ?? "").trim() };
    },
  };
}
