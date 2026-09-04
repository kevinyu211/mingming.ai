/**
 * Contract tests for the server-side speech adapters (T015).
 *
 * No keys exist in CI or on the dev machine, so every provider is exercised against a mocked
 * `globalThis.fetch`. What is checked is exactly what cannot be checked later without a live
 * account: the URL, the auth header, the body shape, and the response parsing.
 *
 * The last block is the one that matters for the constitution: no adapter may put the card text
 * or the audio into a log line (principle V, research.md R5).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAzureSsml,
  buildAzureSttRequest,
  createAzureSttProvider,
  createAzureTtsProvider,
  escapeXml,
} from "../../lib/speech/providers/azure";
import { BrowserFallbackError } from "../../lib/speech/providers/browser";
import {
  createElevenLabsSttProvider,
  createElevenLabsTtsProvider,
} from "../../lib/speech/providers/elevenlabs";
import {
  getSttProvider,
  getTtsProvider,
  UnknownSpeechProviderError,
} from "../../lib/speech/providers/index";
import {
  createMinimaxTtsProvider,
  hexToBytes,
} from "../../lib/speech/providers/minimax";
import {
  createOpenAiSttProvider,
  fileNameFor,
} from "../../lib/speech/providers/openai";
import {
  SpeechConfigError,
  SpeechProviderError,
} from "../../lib/speech/providers/types";

/* ------------------------------------------------------------------ fixtures */

/** A Cantonese medicine line: the sentence that must never appear in a log. */
const YUE_TEXT = "Amlodipine 5mg，一粒，每日一次。";
const CMN_TEXT = "氨氯地平片 5mg，一片，每天一次。";
/** The third form of the same line. English is a spoken language here, not a fallback. */
const EN_TEXT = "Amlodipine 5mg, one tablet, once a day.";

/** "ID3" - the first bytes of an mp3, enough to prove a passthrough or a hex decode. */
const AUDIO_BYTES = Uint8Array.from([0x49, 0x44, 0x33, 0x04]);
const AUDIO_HEX = "49443304";

const ENV_KEYS = [
  "TTS_PROVIDER",
  "STT_PROVIDER",
  "MINIMAX_API_KEY",
  "MINIMAX_GROUP_ID",
  "MINIMAX_BASE_URL",
  "MINIMAX_TTS_MODEL",
  "MINIMAX_VOICE_YUE",
  "MINIMAX_VOICE_CMN",
  "MINIMAX_VOICE_EN",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_BASE_URL",
  "ELEVENLABS_MODEL",
  "ELEVENLABS_STT_MODEL",
  "ELEVENLABS_VOICE_YUE",
  "ELEVENLABS_VOICE_CMN",
  "ELEVENLABS_VOICE_EN",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_OUTPUT_FORMAT",
  "AZURE_VOICE_YUE",
  "AZURE_VOICE_CMN",
  "AZURE_VOICE_EN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_STT_MODEL",
  "NEXT_PUBLIC_STT_MODE",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------- helpers */

interface Capture {
  url: string;
  init: RequestInit;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function bytesResponse(bytes: Uint8Array, contentType = "audio/mpeg", status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    json: async () => ({}),
    arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as Response;
}

/** Install a fetch mock and return the array it records calls into. */
function mockFetch(response: Response | (() => Response)): Capture[] {
  const calls: Capture[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return typeof response === "function" ? response() : response;
    }),
  );
  return calls;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

function jsonBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

/* ------------------------------------------------------------------- MiniMax */

describe("minimax tts adapter", () => {
  beforeEach(() => {
    process.env.MINIMAX_API_KEY = "test-minimax-key";
    process.env.MINIMAX_GROUP_ID = "group-123";
    process.env.MINIMAX_VOICE_YUE = "voice-yue-id";
    process.env.MINIMAX_VOICE_CMN = "voice-cmn-id";
  });

  it("omits GroupId entirely when none is configured, and still authenticates", async () => {
    // Confirmed live on 2026-09-03: the international host takes the bearer key alone and
    // returns audio with no GroupId. Requiring it would have blocked the voice for a value that
    // is not printed on the console's API-key page.
    delete process.env.MINIMAX_GROUP_ID;
    const calls = mockFetch(
      jsonResponse({ base_resp: { status_code: 0 }, data: { audio: AUDIO_HEX } }),
    );

    await createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.minimax.io/v1/t2a_v2");
    expect(String(calls[0].url)).not.toContain("GroupId");
  });

  it("posts to t2a_v2 with the group id, bearer key and Cantonese boost", async () => {
    const calls = mockFetch(
      jsonResponse({ base_resp: { status_code: 0 }, data: { audio: AUDIO_HEX } }),
    );

    const result = await createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.minimax.io/v1/t2a_v2?GroupId=group-123");
    expect(calls[0].init.method).toBe("POST");
    expect(headerOf(calls[0].init, "Authorization")).toBe("Bearer test-minimax-key");
    expect(headerOf(calls[0].init, "Content-Type")).toBe("application/json");

    const body = jsonBody(calls[0].init);
    expect(body.model).toBe("speech-2.8-hd");
    expect(body.text).toBe(YUE_TEXT);
    // Confirmed against the live endpoint: "Cantonese" is rejected (2013 invalid params).
    expect(body.language_boost).toBe("Chinese,Yue");
    expect(body.voice_setting).toMatchObject({ voice_id: "voice-yue-id" });
    expect(body.audio_setting).toMatchObject({ format: "mp3", sample_rate: 32000 });

    // Hex decode, not base64, not passthrough.
    expect(Array.from(result.audio)).toEqual(Array.from(AUDIO_BYTES));
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("uses the Mandarin voice id and boost for cmn", async () => {
    const calls = mockFetch(
      jsonResponse({ base_resp: { status_code: 0 }, data: { audio: AUDIO_HEX } }),
    );
    await createMinimaxTtsProvider().synthesize(CMN_TEXT, "cmn");

    const body = jsonBody(calls[0].init);
    expect(body.language_boost).toBe("Chinese");
    expect(body.voice_setting).toMatchObject({ voice_id: "voice-cmn-id" });
  });

  it("uses the English boost and the English voice for en", async () => {
    // No MINIMAX_VOICE_EN is set here, so this also pins the default that was verified live.
    const calls = mockFetch(
      jsonResponse({ base_resp: { status_code: 0 }, data: { audio: AUDIO_HEX } }),
    );
    await createMinimaxTtsProvider().synthesize(EN_TEXT, "en");

    const body = jsonBody(calls[0].init);
    expect(body.language_boost).toBe("English");
    expect(body.voice_setting).toMatchObject({ voice_id: "English_CalmWoman" });
  });

  it("lets MINIMAX_VOICE_EN override the English default", async () => {
    process.env.MINIMAX_VOICE_EN = "English_Trustworth_Man";
    const calls = mockFetch(
      jsonResponse({ base_resp: { status_code: 0 }, data: { audio: AUDIO_HEX } }),
    );
    await createMinimaxTtsProvider().synthesize(EN_TEXT, "en");

    expect(jsonBody(calls[0].init).voice_setting).toMatchObject({
      voice_id: "English_Trustworth_Man",
    });
  });

  it("honours MINIMAX_TTS_MODEL and MINIMAX_BASE_URL", async () => {
    process.env.MINIMAX_TTS_MODEL = "speech-02-turbo";
    process.env.MINIMAX_BASE_URL = "https://api.minimaxi.com/";
    const calls = mockFetch(
      jsonResponse({ base_resp: { status_code: 0 }, data: { audio: AUDIO_HEX } }),
    );

    await createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue");

    expect(calls[0].url).toBe("https://api.minimaxi.com/v1/t2a_v2?GroupId=group-123");
    expect(jsonBody(calls[0].init).model).toBe("speech-02-turbo");
  });

  it("treats a non-zero base_resp.status_code as a failure even on HTTP 200", async () => {
    mockFetch(
      jsonResponse({
        base_resp: { status_code: 1004, status_msg: "auth failed" },
        data: {},
      }),
    );
    await expect(createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue")).rejects.toBeInstanceOf(
      SpeechProviderError,
    );
  });

  it("rejects a payload that is not hex instead of returning noise", async () => {
    mockFetch(jsonResponse({ base_resp: { status_code: 0 }, data: { audio: "not-hex!" } }));
    await expect(createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue")).rejects.toThrow(
      /hex/i,
    );
  });

  it("decodes hex to bytes", () => {
    expect(Array.from(hexToBytes("00ff10"))).toEqual([0, 255, 16]);
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("")).toThrow();
  });
});

/* ---------------------------------------------------------------- ElevenLabs */

describe("elevenlabs tts adapter", () => {
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
    process.env.ELEVENLABS_VOICE_YUE = "voice-yue";
    process.env.ELEVENLABS_VOICE_CMN = "voice-cmn";
  });

  it("posts to the voice endpoint with xi-api-key and the yue language code", async () => {
    const calls = mockFetch(bytesResponse(AUDIO_BYTES));

    const result = await createElevenLabsTtsProvider().synthesize(YUE_TEXT, "yue");

    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-yue");
    expect(headerOf(calls[0].init, "xi-api-key")).toBe("test-eleven-key");
    expect(headerOf(calls[0].init, "Accept")).toBe("audio/mpeg");
    expect(jsonBody(calls[0].init)).toEqual({
      text: YUE_TEXT,
      model_id: "eleven_v3",
      language_code: "yue",
    });

    // Body bytes pass straight through; no decoding step.
    expect(Array.from(result.audio)).toEqual(Array.from(AUDIO_BYTES));
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("maps cmn to zh and honours ELEVENLABS_MODEL", async () => {
    process.env.ELEVENLABS_MODEL = "eleven_multilingual_v2";
    const calls = mockFetch(bytesResponse(AUDIO_BYTES));

    await createElevenLabsTtsProvider().synthesize(CMN_TEXT, "cmn");

    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-cmn");
    expect(jsonBody(calls[0].init)).toMatchObject({
      model_id: "eleven_multilingual_v2",
      language_code: "zh",
    });
  });

  it("maps en to the en language code and its own voice", async () => {
    process.env.ELEVENLABS_VOICE_EN = "voice-en";
    const calls = mockFetch(bytesResponse(AUDIO_BYTES));

    await createElevenLabsTtsProvider().synthesize(EN_TEXT, "en");

    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-en");
    expect(jsonBody(calls[0].init)).toMatchObject({ language_code: "en" });
  });

  it("raises SpeechProviderError with the status and no body detail", async () => {
    mockFetch(bytesResponse(AUDIO_BYTES, "audio/mpeg", 429));
    await expect(
      createElevenLabsTtsProvider().synthesize(YUE_TEXT, "yue"),
    ).rejects.toMatchObject({ status: 429, provider: "elevenlabs" });
  });
});

describe("elevenlabs stt adapter", () => {
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
  });

  it("posts multipart scribe_v1 with the ISO-639-3 language code and trims the text", async () => {
    const calls = mockFetch(jsonResponse({ text: "  呢隻藥係咪一日食三次？  " }));

    const result = await createElevenLabsSttProvider().transcribe(
      AUDIO_BYTES,
      "audio/mp4",
      "yue",
    );

    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(headerOf(calls[0].init, "xi-api-key")).toBe("test-eleven-key");
    // fetch must set the multipart boundary itself.
    expect(headerOf(calls[0].init, "Content-Type")).toBeUndefined();

    const form = calls[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model_id")).toBe("scribe_v1");
    expect(form.get("language_code")).toBe("yue");
    expect(form.get("file")).toBeInstanceOf(Blob);

    expect(result).toEqual({ text: "呢隻藥係咪一日食三次？" });
  });

  it("maps cmn to zho and en to eng", async () => {
    const calls = mockFetch(jsonResponse({ text: "ok" }));
    const provider = createElevenLabsSttProvider();

    await provider.transcribe(AUDIO_BYTES, "audio/mp4", "cmn");
    await provider.transcribe(AUDIO_BYTES, "audio/mp4", "en");

    expect((calls[0].init.body as FormData).get("language_code")).toBe("zho");
    expect((calls[1].init.body as FormData).get("language_code")).toBe("eng");
  });
});

/* -------------------------------------------------------------------- OpenAI */

describe("openai stt adapter", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
  });

  it("posts multipart gpt-4o-mini-transcribe with a zh hint and trims the text", async () => {
    const calls = mockFetch(jsonResponse({ text: "  覆診要帶咩？  " }));

    const result = await createOpenAiSttProvider().transcribe(AUDIO_BYTES, "audio/mp4", "yue");

    expect(calls[0].url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(headerOf(calls[0].init, "Authorization")).toBe("Bearer test-openai-key");
    // fetch must set the multipart boundary itself.
    expect(headerOf(calls[0].init, "Content-Type")).toBeUndefined();

    const form = calls[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    // There is no ISO-639-1 code for Cantonese; the audio decides which Chinese it is.
    expect(form.get("language")).toBe("zh");
    // "verbose_json" is rejected by the gpt-4o transcribe models.
    expect(form.get("response_format")).toBe("json");
    expect(form.get("file")).toBeInstanceOf(Blob);

    expect(result).toEqual({ text: "覆診要帶咩？" });
  });

  it("names the file by its container, because OpenAI reads the format off the extension", () => {
    // Confirmed live on 2026-09-04: "question.audio", the constant the other adapters use, is
    // rejected with 400 "Unsupported file format audio".
    expect(fileNameFor("audio/mp4")).toBe("question.mp4");
    expect(fileNameFor("audio/webm;codecs=opus")).toBe("question.webm");
    expect(fileNameFor("audio/ogg;codecs=opus")).toBe("question.ogg");
    expect(fileNameFor("audio/wav")).toBe("question.wav");
    expect(fileNameFor("audio/mpeg")).toBe("question.mp3");
    // Unknown or unlabelled: webm is what Chrome and Android record.
    expect(fileNameFor("application/octet-stream")).toBe("question.webm");
    // And it never carries anything about the user or the question.
    for (const mime of ["audio/mp4", "audio/webm", "audio/wav"]) {
      expect(fileNameFor(mime)).toMatch(/^question\.[a-z0-9]+$/);
    }
  });

  it("steers Cantonese with a fixed prompt, and sends no prompt otherwise", async () => {
    const calls = mockFetch(jsonResponse({ text: "ok" }));
    const provider = createOpenAiSttProvider();

    await provider.transcribe(AUDIO_BYTES, "audio/mp4", "yue");
    await provider.transcribe(AUDIO_BYTES, "audio/mp4", "cmn");
    await provider.transcribe(AUDIO_BYTES, "audio/mp4", "en");

    // Without it "覆診" comes back as "複產" or "復診" (measured 2026-09-04). The prompt is a
    // constant about clinics and medicine - never a word about the patient or the sheet.
    const prompt = (calls[0].init.body as FormData).get("prompt");
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("廣東話");
    expect((calls[1].init.body as FormData).get("prompt")).toBeNull();
    expect((calls[1].init.body as FormData).get("language")).toBe("zh");
    expect((calls[2].init.body as FormData).get("prompt")).toBeNull();
    expect((calls[2].init.body as FormData).get("language")).toBe("en");
  });

  it("takes the model from OPENAI_STT_MODEL", async () => {
    process.env.OPENAI_STT_MODEL = "gpt-4o-transcribe";
    const calls = mockFetch(jsonResponse({ text: "ok" }));

    await createOpenAiSttProvider().transcribe(AUDIO_BYTES, "audio/mp4", "yue");

    expect((calls[0].init.body as FormData).get("model")).toBe("gpt-4o-transcribe");
  });

  it("throws a SpeechProviderError carrying only the status", async () => {
    mockFetch(jsonResponse({ error: { message: "unsupported" } }, 400));

    await expect(
      createOpenAiSttProvider().transcribe(AUDIO_BYTES, "audio/mp4", "yue"),
    ).rejects.toBeInstanceOf(SpeechProviderError);
  });

  it("throws a clear error when STT_PROVIDER=openai without a key", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.STT_PROVIDER = "openai";
    expect(() => getSttProvider()).toThrow(SpeechConfigError);
    expect(() => getSttProvider()).toThrow(/OPENAI_API_KEY/);
  });

  it("is selectable as the stt provider", () => {
    process.env.STT_PROVIDER = "openai";
    expect(getSttProvider().id).toBe("openai");
  });
});

/* --------------------------------------------------------------------- Azure */

describe("azure tts adapter", () => {
  beforeEach(() => {
    process.env.AZURE_SPEECH_KEY = "test-azure-key";
    process.env.AZURE_SPEECH_REGION = "eastasia";
  });

  it("posts SSML to the regional endpoint with the zh-HK voice", async () => {
    const calls = mockFetch(bytesResponse(AUDIO_BYTES));

    const result = await createAzureTtsProvider().synthesize(YUE_TEXT, "yue");

    expect(calls[0].url).toBe("https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(headerOf(calls[0].init, "Ocp-Apim-Subscription-Key")).toBe("test-azure-key");
    expect(headerOf(calls[0].init, "Content-Type")).toBe("application/ssml+xml");
    expect(headerOf(calls[0].init, "X-Microsoft-OutputFormat")).toBe(
      "audio-24khz-48kbitrate-mono-mp3",
    );

    const ssml = calls[0].init.body as string;
    expect(ssml).toContain('xml:lang="zh-HK"');
    expect(ssml).toContain('<voice name="zh-HK-HiuMaanNeural">');
    expect(ssml).toContain(YUE_TEXT);
    expect(Array.from(result.audio)).toEqual(Array.from(AUDIO_BYTES));
  });

  it("uses the zh-CN voice for cmn and honours the voice env vars", async () => {
    process.env.AZURE_VOICE_CMN = "zh-CN-YunxiNeural";
    const calls = mockFetch(bytesResponse(AUDIO_BYTES));

    await createAzureTtsProvider().synthesize(CMN_TEXT, "cmn");

    const ssml = calls[0].init.body as string;
    expect(ssml).toContain('xml:lang="zh-CN"');
    expect(ssml).toContain('<voice name="zh-CN-YunxiNeural">');
  });

  it("uses the Hong Kong English voice and locale for en", async () => {
    const calls = mockFetch(bytesResponse(AUDIO_BYTES));

    await createAzureTtsProvider().synthesize(EN_TEXT, "en");

    const ssml = calls[0].init.body as string;
    // en-HK, not en-US: the accent the sheet's own English is read in locally.
    expect(ssml).toContain('xml:lang="en-HK"');
    expect(ssml).toContain('<voice name="en-HK-YanNeural">');
  });

  it("escapes XML so a sheet quote cannot break or inject into the SSML", () => {
    expect(escapeXml(`A & B < C > D " E ' F`)).toBe(
      "A &amp; B &lt; C &gt; D &quot; E &apos; F",
    );

    const ssml = buildAzureSsml('Panadol & Co <2 weeks> "PRN"', "yue");
    expect(ssml).toContain("Panadol &amp; Co &lt;2 weeks&gt; &quot;PRN&quot;");
    // The raw markup characters survive nowhere inside the voice element.
    expect(ssml.split('<voice name="zh-HK-HiuMaanNeural">')[1]).not.toMatch(/[&<>]"/);
    // Still a single well-formed voice element.
    expect(ssml.match(/<voice /g)).toHaveLength(1);
  });
});

describe("azure stt adapter", () => {
  beforeEach(() => {
    process.env.AZURE_SPEECH_KEY = "test-azure-key";
    process.env.AZURE_SPEECH_REGION = "eastasia";
  });

  it("posts the audio body to the conversation endpoint and reads DisplayText", async () => {
    const calls = mockFetch(
      jsonResponse({ RecognitionStatus: "Success", DisplayText: "幾時要返去覆診？" }),
    );

    const result = await createAzureSttProvider().transcribe(AUDIO_BYTES, "audio/wav", "yue");

    expect(calls[0].url).toBe(
      "https://eastasia.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1" +
        "?language=zh-HK&format=simple",
    );
    expect(headerOf(calls[0].init, "Ocp-Apim-Subscription-Key")).toBe("test-azure-key");
    // WAV needs the PCM parameters spelled out.
    expect(headerOf(calls[0].init, "Content-Type")).toBe(
      "audio/wav; codecs=audio/pcm; samplerate=16000",
    );
    expect(Array.from(new Uint8Array(calls[0].init.body as ArrayBuffer))).toEqual(
      Array.from(AUDIO_BYTES),
    );
    expect(result).toEqual({ text: "幾時要返去覆診？" });
  });

  it("maps cmn to zh-CN and en to en-HK, and passes other codecs through", () => {
    const creds = { key: "k", region: "eastasia", outputFormat: "fmt" };
    expect(buildAzureSttRequest(AUDIO_BYTES, "audio/mp4", "cmn", creds).url).toContain(
      "language=zh-CN",
    );
    const en = buildAzureSttRequest(AUDIO_BYTES, "audio/mp4", "en", creds);
    expect(en.url).toContain("language=en-HK");
    expect(headerOf(en.init, "Content-Type")).toBe("audio/mp4");
  });

  it("returns an empty transcript rather than throwing on NoMatch", async () => {
    mockFetch(jsonResponse({ RecognitionStatus: "NoMatch" }));
    const result = await createAzureSttProvider().transcribe(AUDIO_BYTES, "audio/wav", "yue");
    expect(result).toEqual({ text: "" });
  });
});

/* ------------------------------------------------------------------ selection */

describe("provider selection", () => {
  it("returns the browser marker by default", async () => {
    const tts = getTtsProvider();
    const stt = getSttProvider();
    expect(tts.id).toBe("browser");
    expect(stt.id).toBe("browser");

    // The marker never makes a network call; it signals "do it on the device".
    await expect(tts.synthesize(YUE_TEXT, "yue")).rejects.toBeInstanceOf(BrowserFallbackError);
    await expect(
      stt.transcribe(AUDIO_BYTES, "audio/mp4", "yue"),
    ).rejects.toBeInstanceOf(BrowserFallbackError);
  });

  it("throws a clear error when TTS_PROVIDER=minimax and MINIMAX_API_KEY is unset", () => {
    process.env.TTS_PROVIDER = "minimax";
    process.env.MINIMAX_GROUP_ID = "group-123";

    expect(() => getTtsProvider()).toThrow(SpeechConfigError);
    expect(() => getTtsProvider()).toThrow(/MINIMAX_API_KEY/);
    expect(() => getTtsProvider()).toThrow(/minimax/);
  });

  it("names every missing variable at once", () => {
    process.env.TTS_PROVIDER = "azure";
    try {
      getTtsProvider();
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SpeechConfigError);
      expect((error as SpeechConfigError).missing).toEqual([
        "AZURE_SPEECH_KEY",
        "AZURE_SPEECH_REGION",
      ]);
    }
  });

  it("throws when STT_PROVIDER=elevenlabs without a key", () => {
    process.env.STT_PROVIDER = "elevenlabs";
    expect(() => getSttProvider()).toThrow(/ELEVENLABS_API_KEY/);
  });

  it("rejects an unknown provider name", () => {
    process.env.TTS_PROVIDER = "cantonese-ai";
    expect(() => getTtsProvider()).toThrow(UnknownSpeechProviderError);
    process.env.STT_PROVIDER = "minimax";
    expect(() => getSttProvider()).toThrow(/not a known provider/);
  });

  it("selects a configured cloud provider", () => {
    process.env.TTS_PROVIDER = "MiniMax";
    process.env.MINIMAX_API_KEY = "k";
    process.env.MINIMAX_GROUP_ID = "g";
    expect(getTtsProvider().id).toBe("minimax");
  });
});

/* ------------------------------------------- constitution V: never log the text */

describe("no adapter logs the text, the audio or the key", () => {
  const methods = ["log", "info", "warn", "error", "debug"] as const;

  function spyOnConsole() {
    return methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  }

  function everythingWritten(spies: ReturnType<typeof spyOnConsole>): string {
    return spies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
  }

  it("keeps the card text and the key out of a successful minimax synthesis", async () => {
    process.env.MINIMAX_API_KEY = "super-secret-key";
    process.env.MINIMAX_GROUP_ID = "group-123";
    mockFetch(jsonResponse({ base_resp: { status_code: 0 }, data: { audio: AUDIO_HEX } }));
    const spies = spyOnConsole();

    await createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue");

    const written = everythingWritten(spies);
    expect(written).not.toContain(YUE_TEXT);
    expect(written).not.toContain("Amlodipine");
    expect(written).not.toContain("super-secret-key");
    expect(written).not.toContain(AUDIO_HEX);
    // The safe fields are still there, which is what makes the route debuggable.
    expect(written).toContain("provider=minimax");
    expect(written).toContain("status=200");
  });

  it("keeps the text out of a failing azure synthesis and out of the error", async () => {
    process.env.AZURE_SPEECH_KEY = "super-secret-key";
    process.env.AZURE_SPEECH_REGION = "eastasia";
    mockFetch(bytesResponse(AUDIO_BYTES, "audio/mpeg", 401));
    const spies = spyOnConsole();

    let error: Error | null = null;
    try {
      await createAzureTtsProvider().synthesize(YUE_TEXT, "yue");
    } catch (caught) {
      error = caught as Error;
    }

    const written = everythingWritten(spies);
    expect(written).not.toContain(YUE_TEXT);
    expect(written).not.toContain("super-secret-key");
    expect(error).toBeInstanceOf(SpeechProviderError);
    expect(error?.message).not.toContain(YUE_TEXT);
    expect(error?.message).not.toContain("super-secret-key");
    expect(error?.message).toContain("401");
  });

  it("keeps the transcript out of an elevenlabs transcription log", async () => {
    process.env.ELEVENLABS_API_KEY = "super-secret-key";
    const transcript = "如果佢覺得頭暈，係咪要即刻返醫院？";
    mockFetch(jsonResponse({ text: transcript }));
    const spies = spyOnConsole();

    await createElevenLabsSttProvider().transcribe(AUDIO_BYTES, "audio/mp4", "yue");

    const written = everythingWritten(spies);
    expect(written).not.toContain(transcript);
    expect(written).not.toContain("super-secret-key");
    expect(written).toContain("provider=elevenlabs");
  });

  it("keeps the transcript out of an openai transcription log", async () => {
    process.env.OPENAI_API_KEY = "super-secret-key";
    const transcript = "如果佢覺得頭暈，係咪要即刻返醫院？";
    mockFetch(jsonResponse({ text: transcript }));
    const spies = spyOnConsole();

    await createOpenAiSttProvider().transcribe(AUDIO_BYTES, "audio/mp4", "yue");

    const written = everythingWritten(spies);
    expect(written).not.toContain(transcript);
    expect(written).not.toContain("super-secret-key");
    expect(written).toContain("provider=openai");
    expect(written).toContain("status=200");
  });
});

/**
 * The reader said it, let go, and nothing was sent.
 *
 * `stop()` ends the session, and on iOS Safari a short utterance frequently ends WITHOUT the
 * engine ever promoting its interim guess to `isFinal`. The code kept only final results, so
 * `finalText` was empty and the transcript the reader had just watched appear in the bubble was
 * dropped on the floor. They then had to say it again, which for the person this app is built for
 * is the moment they give up and hand the phone to someone else.
 */
describe("a released hold sends what was heard, final or not", () => {
  interface FakeResult {
    isFinal: boolean;
    0: { transcript: string };
  }

  /** Drives the browser recogniser through one hold: some interim text, then `stop()`. */
  function runHold(results: FakeResult[], promoteToFinal: boolean) {
    let onresult: ((e: { resultIndex: number; results: FakeResult[] }) => void) | null = null;
    let onend: (() => void) | null = null;

    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      set onresult(fn: typeof onresult) {
        onresult = fn;
      }
      set onerror(_fn: unknown) {}
      set onend(fn: typeof onend) {
        onend = fn;
      }
      start() {
        // The engine emits its guess as interim…
        onresult?.({ resultIndex: 0, results });
        // …and only sometimes promotes it before the session ends.
        if (promoteToFinal) {
          onresult?.({
            resultIndex: 0,
            results: results.map((r) => ({ ...r, isFinal: true })),
          });
        }
      }
      stop() {
        onend?.();
      }
      abort() {
        onend?.();
      }
    }
    return FakeRecognition;
  }

  const said = [{ isFinal: false, 0: { transcript: "覆診要帶咩" } }];

  it("sends the interim text when the session ends before anything is final", async () => {
    vi.resetModules();
    vi.stubGlobal("window", { webkitSpeechRecognition: runHold(said, false) });
    const { listen } = await import("@/lib/speech/stt");
    const stop = new AbortController();
    const result = listen("yue", { stop: stop.signal });
    await Promise.resolve();
    stop.abort();
    await expect(result).resolves.toEqual({ text: "覆診要帶咩" });
    vi.unstubAllGlobals();
  });

  it("prefers the final transcript when the engine does produce one", async () => {
    vi.resetModules();
    vi.stubGlobal("window", { webkitSpeechRecognition: runHold(said, true) });
    const { listen } = await import("@/lib/speech/stt");
    const stop = new AbortController();
    const result = listen("yue", { stop: stop.signal });
    await Promise.resolve();
    stop.abort();
    await expect(result).resolves.toEqual({ text: "覆診要帶咩" });
    vi.unstubAllGlobals();
  });
});

/**
 * The hybrid, which is the other half of the same bug.
 *
 * Keeping the last interim stopped the transcript vanishing, but the browser engine itself is the
 * weak link: it fails silently, it differs on every iOS point release, it is poor at Cantonese,
 * and on Chrome it uploads the audio to Google anyway. So `listen` now runs BOTH — the engine for
 * what the reader watches appear, `MediaRecorder` for what is actually sent — and the rule that
 * matters at a conference is that a bad network degrades to yesterday's behaviour, never to
 * silence. Every one of these cases must end with the reader's words going somewhere.
 */
describe("the hybrid: instant on screen, accurate on the wire", () => {
  /** A non-empty clip is all `transcribeClip` asks for before it will upload. */
  const CLIP = Uint8Array.from([1, 2, 3]);
  /** What OpenAI would return: the engine's guess, corrected. */
  const ACCURATE = "呢隻藥要唔要隨餐食？";
  /** What the browser engine put on the screen while the reader was still speaking. */
  const HEARD = "呢隻藥要唔要隨參食";

  function fakeRecognition(said: string) {
    return class {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start(): void {
        if (said.length === 0) return;
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: false, 0: { transcript: said } }],
        });
      }
      stop(): void {
        this.onend?.();
      }
      abort(): void {
        this.onend?.();
      }
    };
  }

  function fakeRecorder() {
    return class {
      static isTypeSupported = () => true;
      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start(): void {
        this.state = "recording";
      }
      stop(): void {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([CLIP], { type: "audio/webm" }) });
        this.onstop?.();
      }
    };
  }

  interface HoldOptions {
    /** What the engine hears. "" is the iOS case where it silently produces nothing. */
    heard?: string;
    /** Take the engine away entirely (Firefox, and some locked-down WebViews). */
    noRecognition?: boolean;
    /** Take the recorder away entirely — the bar must be exactly what it was before. */
    noRecorder?: boolean;
    /** What `/api/stt` does. Defaults to answering with `ACCURATE`. */
    upload?: (init: RequestInit) => Promise<Response>;
    cloudTimeoutMs?: number;
    cancel?: boolean;
  }

  interface Hold {
    result: Promise<{ text: string }>;
    uploads: { url: string; init: RequestInit }[];
    interims: string[];
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Press the bar, speak, release it — with the world the options describe. */
  async function hold(options: HoldOptions = {}): Promise<Hold> {
    vi.resetModules();
    const uploads: { url: string; init: RequestInit }[] = [];
    const interims: string[] = [];

    const win: Record<string, unknown> = {};
    if (!options.noRecognition) {
      win.webkitSpeechRecognition = fakeRecognition(options.heard ?? HEARD);
    }
    vi.stubGlobal("window", win);

    if (options.noRecorder) {
      vi.stubGlobal("MediaRecorder", undefined);
      vi.stubGlobal("navigator", {});
    } else {
      vi.stubGlobal("MediaRecorder", fakeRecorder());
      vi.stubGlobal("navigator", {
        mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
      });
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        uploads.push({ url, init });
        return options.upload ? options.upload(init) : jsonResponse({ text: ACCURATE });
      }),
    );

    process.env.NEXT_PUBLIC_STT_MODE = "cloud";
    const { listen } = await import("@/lib/speech/stt");

    const stop = new AbortController();
    const cancel = new AbortController();
    const result = listen("yue", {
      stop: stop.signal,
      cancel: cancel.signal,
      cloudTimeoutMs: options.cloudTimeoutMs,
      onInterim: (text) => interims.push(text),
    });
    // `ChatBar` awaits `listen` inside a try/catch, so its handler is attached synchronously.
    // Here the tick below comes first, so a rejection would land unhandled and Vitest would
    // report it as an error even though the test goes on to assert it.
    result.catch(() => {});
    // The microphone opens behind an async permission prompt; a real hold outlives it.
    await tick();
    if (options.cancel) cancel.abort();
    else stop.abort();

    return { result, uploads, interims };
  }

  it("shows the browser's guess while speaking and sends the upload's transcript", async () => {
    const { result, uploads, interims } = await hold();

    await expect(result).resolves.toEqual({ text: ACCURATE });
    // The instant feedback is the point of keeping the browser engine at all.
    expect(interims).toContain(HEARD);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].url).toBe("/api/stt?language=yue");
    expect(uploads[0].init.method).toBe("POST");
  });

  it("sends what was heard when the upload cannot go through at all", async () => {
    const { result } = await hold({
      upload: () => Promise.reject(new Error("network down")),
    });

    await expect(result).resolves.toEqual({ text: HEARD });
  });

  it("sends what was heard when the upload times out", async () => {
    const { result } = await hold({
      cloudTimeoutMs: 20,
      upload: (init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    });

    await expect(result).resolves.toEqual({ text: HEARD });
  });

  it("sends what was heard when the route answers 503, 502 or nothing usable", async () => {
    for (const upload of [
      () => Promise.resolve(jsonResponse({ error: "browser_fallback" }, 503)),
      () => Promise.resolve(jsonResponse({ error: "stt_failed" }, 502)),
      () => Promise.resolve(jsonResponse({ text: "   " })),
    ]) {
      const { result } = await hold({ upload });
      await expect(result).resolves.toEqual({ text: HEARD });
    }
  });

  it("sends the upload's transcript when the engine silently heard nothing", async () => {
    // The iOS case Kevin hit: he said it, he let go, and the engine produced no result at all.
    const { result } = await hold({ heard: "" });

    await expect(result).resolves.toEqual({ text: ACCURATE });
  });

  it("is exactly the old browser path when the device cannot record", async () => {
    const { result, uploads, interims } = await hold({ noRecorder: true });

    await expect(result).resolves.toEqual({ text: HEARD });
    expect(uploads).toHaveLength(0);
    expect(interims).toContain(HEARD);
  });

  it("does not confuse a missing recorder with a missing microphone", async () => {
    // The bar switches to the keyboard FOR GOOD on a fatal error, so "this browser cannot record
    // audio" must never be raised on a device whose engine is working and simply heard silence.
    const { result } = await hold({ noRecorder: true, heard: "" });

    await expect(result).resolves.toEqual({ text: "" });
  });

  it("still works, silently, when the device has no recognition engine", async () => {
    const { result, interims } = await hold({ noRecognition: true });

    await expect(result).resolves.toEqual({ text: ACCURATE });
    expect(interims).toEqual([]);
  });

  it("asks for the keyboard only when neither engine exists", async () => {
    const { result } = await hold({ noRecognition: true, noRecorder: true });

    await expect(result).rejects.toMatchObject({ code: "speech_unavailable" });
  });

  it("uploads nothing when the hold is cancelled", async () => {
    const { result, uploads } = await hold({ cancel: true });

    await expect(result).resolves.toEqual({ text: "" });
    expect(uploads).toHaveLength(0);
  });
});
