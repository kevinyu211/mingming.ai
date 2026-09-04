/**
 * MiniMax Speech (T2A v2) text-to-speech adapter. Server-side only.
 *
 * Candidate T1 in `provider_shortlist.md` section 1 and the first choice in research.md R5:
 * MiniMax documents native Cantonese voices and accepts Jyutping tone overrides in
 * parentheses, which is what makes an English drug name and a number survive a Cantonese
 * reading.
 *
 * ┌── CONFIRMED AGAINST THE LIVE API ON 2026-09-03 ────────────────────────────────────────┐
 * │ https://platform.minimax.io/docs/api-reference/speech-t2a-http                          │
 * │ All three dialects were exercised end to end and returned audio. The whole request      │
 * │ shape lives in ONE function, `buildMinimaxTtsRequest`, so a correction is a single      │
 * │ edit. What was checked, and what is still worth re-checking:                            │
 * │   1. Host and path: `https://api.minimax.io/v1/t2a_v2`; `GroupId` is a query parameter  │
 * │      and is optional on this host (the mainland host is `api.minimaxi.com`; set         │
 * │      MINIMAX_BASE_URL for it). CONFIRMED.                                               │
 * │   2. `model`: "speech-02-hd" accepted. Newer ids may exist - re-check before a demo.    │
 * │   3. `voice_setting.voice_id`: the Chinese defaults below are safe system voices that   │
 * │      the listening test (R5) replaces via MINIMAX_VOICE_YUE / _CMN. The English default │
 * │      `English_Graceful_Lady` was CONFIRMED working; MINIMAX_VOICE_EN overrides it.      │
 * │   4. `language_boost`: "Chinese,Yue" / "Chinese" / "English". CONFIRMED - and note that │
 * │      "Cantonese" is REJECTED outright (see `languageBoost` below).                      │
 * │   5. `audio_setting` field names (format / sample_rate / bitrate / channel). CONFIRMED. │
 * │   6. Response shape: audio comes back as a HEX string at `data.audio`, with the         │
 * │      outcome at `base_resp.status_code` (0 = success). Some responses are HTTP 200 with │
 * │      a non-zero `base_resp.status_code`, which is why that is checked explicitly.       │
 * └────────────────────────────────────────────────────────────────────────────────────────┘
 */

import {
  logSpeechEvent,
  readEnv,
  readEnvOr,
  SpeechConfigError,
  SpeechProviderError,
  type Dialect,
  type TtsProvider,
} from "./types";

const PROVIDER_ID = "minimax";

/**
 * Default T2A model. Override with MINIMAX_TTS_MODEL.
 *
 * `speech-2.8-hd` is MiniMax's current top model and the only family that supports the
 * interjection tags; more importantly it is the one the delivery was actually tuned against.
 */
const DEFAULT_MODEL = "speech-2.8-hd";

/**
 * Default voice ids. These are MiniMax system voices used as a safe starting point; the
 * listening test in `tests/eval/voices.md` replaces them via MINIMAX_VOICE_YUE and
 * MINIMAX_VOICE_CMN. For Cantonese, also try MiniMax's native Cantonese library voices
 * (ids of the shape "Cantonese_ProfessionalHost(F)") - `language_boost: "Chinese,Yue"` is what
 * drives the phonology when a general voice is used.
 *
 * `English_Graceful_Lady` is an English library voice, verified against the live endpoint on
 * 2026-09-03. English matters here as much as the two Chinese readings: a Hong Kong discharge
 * sheet is often printed in English, and the carer reading it aloud may not be the patient.
 */
const DEFAULT_VOICE_YUE = "Cantonese_GentleLady";
const DEFAULT_VOICE_CMN = "Chinese_wenrounvxing";
const DEFAULT_VOICE_EN = "English_CalmWoman";

const DEFAULT_BASE_URL = "https://api.minimax.io";

/**
 * MiniMax `language_boost` tag per output dialect.
 *
 * Confirmed against the live endpoint on 2026-09-03: the tag for Cantonese is `Chinese,Yue`,
 * for Mandarin `Chinese`, and for English `English`. `Cantonese` is rejected outright — the
 * whole request comes back `2013 invalid params: language_boost` and no audio is produced — so
 * these values are load-bearing, not decorative.
 *
 * Written as an exhaustive switch rather than a ternary: `Dialect` now comes from the reading
 * schema, so a fourth language would fail the build here instead of silently reading English as
 * Mandarin.
 */
function languageBoost(dialect: Dialect): string {
  switch (dialect) {
    case "yue":
      return "Chinese,Yue";
    case "cmn":
      return "Chinese";
    case "en":
      return "English";
  }
}

function voiceId(dialect: Dialect): string {
  switch (dialect) {
    case "yue":
      return readEnvOr("MINIMAX_VOICE_YUE", DEFAULT_VOICE_YUE);
    case "cmn":
      return readEnvOr("MINIMAX_VOICE_CMN", DEFAULT_VOICE_CMN);
    case "en":
      return readEnvOr("MINIMAX_VOICE_EN", DEFAULT_VOICE_EN);
  }
}

export interface MinimaxCredentials {
  apiKey: string;
  groupId: string;
  baseUrl: string;
  model: string;
}

/**
 * Read and validate MiniMax configuration. Throws `SpeechConfigError` naming what is missing.
 *
 * `MINIMAX_GROUP_ID` is optional, confirmed against the live endpoint on 2026-09-03: the
 * international host authenticates on the bearer key alone and returns audio with no `GroupId`
 * at all. It is still sent when present, because the mainland host does want it, and requiring
 * it would have blocked the voice for a value that is not on the console's key page.
 */
export function readMinimaxCredentials(): MinimaxCredentials {
  const apiKey = readEnv("MINIMAX_API_KEY");
  const groupId = readEnv("MINIMAX_GROUP_ID") ?? "";
  if (!apiKey) throw new SpeechConfigError(PROVIDER_ID, ["MINIMAX_API_KEY"]);
  return {
    apiKey,
    groupId,
    baseUrl: readEnvOr("MINIMAX_BASE_URL", DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: readEnvOr("MINIMAX_TTS_MODEL", DEFAULT_MODEL),
  };
}

/**
 * THE request shape. Everything MiniMax-specific about the outgoing call is here, so the
 * "confirm against the docs" list at the top of this file maps to one function body.
 */
export function buildMinimaxTtsRequest(
  text: string,
  dialect: Dialect,
  creds: MinimaxCredentials,
): { url: string; init: RequestInit } {
  const url = creds.groupId
    ? `${creds.baseUrl}/v1/t2a_v2?GroupId=${encodeURIComponent(creds.groupId)}`
    : `${creds.baseUrl}/v1/t2a_v2`;
  const body = {
    model: creds.model,
    text,
    stream: false,
    // The voice: chosen by ear, one id per dialect.
    voice_setting: {
      voice_id: voiceId(dialect),
      // Slightly under natural pace. The listener is often in their seventies and hearing a
      // medicine name for the first time; 1.0 raced through the doses.
      speed: 0.95,
      vol: 1,
      pitch: 0,
      /**
       * Left unset for a long time, which meant "automatic" — the delivery drifted between
       * sentences and read as a newsreader on a warning line. `calm` is the register this
       * product wants everywhere: it never dramatises a red flag, and it never chirps.
       */
      emotion: "calm",
      /**
       * The single most valuable flag on this endpoint for THIS app, and it was off.
       *
       * Without it the engine reads a dose as characters — "25mg" and 「每日兩次」 come out
       * wrong, which is unusable for a product whose entire job is saying doses out loud.
       */
      text_normalization: true,
    },
    // Forces Cantonese phonology instead of a Mandarin reading of traditional characters -
    // the exact failure research.md R5 calls out.
    language_boost: languageBoost(dialect),
    // mp3 at 32 kHz: small enough for venue Wi-Fi, plays natively in an HTMLAudioElement.
    audio_setting: {
      format: "mp3",
      sample_rate: 32000,
      bitrate: 128000,
      channel: 1,
    },
  };
  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

/** Decode the hex string MiniMax returns at `data.audio` into raw mp3 bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length === 0) {
    throw new SpeechProviderError(PROVIDER_ID, 200, "empty audio payload");
  }
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    // Deliberately does not include the payload in the message.
    throw new SpeechProviderError(PROVIDER_ID, 200, "audio payload was not valid hex");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

interface MinimaxT2aResponse {
  data?: { audio?: string; status?: number };
  base_resp?: { status_code?: number; status_msg?: string };
}

export function createMinimaxTtsProvider(): TtsProvider {
  const creds = readMinimaxCredentials();
  return {
    id: PROVIDER_ID,
    async synthesize(text, dialect) {
      const { url, init } = buildMinimaxTtsRequest(text, dialect, creds);
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
      const payload = (await response.json()) as MinimaxT2aResponse;
      const statusCode = payload.base_resp?.status_code ?? 0;
      if (statusCode !== 0) {
        logSpeechEvent({
          provider: PROVIDER_ID,
          op: "synthesize",
          tag: dialect,
          status: response.status,
          ms: Date.now() - startedAt,
        });
        // status_msg may echo the submitted text, so only the numeric code is surfaced.
        throw new SpeechProviderError(PROVIDER_ID, response.status, `base_resp ${statusCode}`);
      }
      const audio = hexToBytes(payload.data?.audio ?? "");
      logSpeechEvent({
        provider: PROVIDER_ID,
        op: "synthesize",
        tag: dialect,
        status: response.status,
        ms: Date.now() - startedAt,
        bytes: audio.byteLength,
      });
      return { audio, mimeType: "audio/mpeg" };
    },
  };
}
