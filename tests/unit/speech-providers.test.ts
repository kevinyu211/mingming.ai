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
    const calls = mockFetch(
      jsonResponse({
        base_resp: { status_code: 1004, status_msg: "auth failed" },
        data: {},
      }),
    );
    await expect(createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue")).rejects.toBeInstanceOf(
      SpeechProviderError,
    );
    // Auth is not going to pass on a second try: exactly one request.
    expect(calls).toHaveLength(1);
  });

  it("retries once when MiniMax refuses with a transient code, and speaks on the second try", async () => {
    // Production, 5 September: 5 of 11 Mandarin requests came back 200 with a non-zero
    // base_resp and no audio while every other language passed. One retry recovers the line.
    const fetchSpy = vi.fn();
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ base_resp: { status_code: 1002, status_msg: "rate limit" }, data: {} }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ base_resp: { status_code: 0 }, data: { audio: AUDIO_HEX } }),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const result = await createMinimaxTtsProvider().synthesize("纸上写着，每天一次。", "cmn");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry an insufficient-balance refusal: the account, not the request, is the problem", async () => {
    const calls = mockFetch(
      jsonResponse({ base_resp: { status_code: 1008, status_msg: "insufficient balance" }, data: {} }),
    );
    await expect(createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue")).rejects.toBeInstanceOf(
      SpeechProviderError,
    );
    expect(calls).toHaveLength(1);
  });

  it("gives up after the one retry when the refusal repeats", async () => {
    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValue(
      jsonResponse({ base_resp: { status_code: 1002, status_msg: "rate limit" }, data: {} }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await expect(createMinimaxTtsProvider().synthesize(YUE_TEXT, "yue")).rejects.toBeInstanceOf(
      SpeechProviderError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
 * One engine per hold, and a hold that never ends in silence.
 *
 * The build before this one ran the browser recogniser and `MediaRecorder` AT THE SAME TIME, for
 * instant on-screen words plus an accurate upload. On a laptop that is free; on Kevin's iPhone it
 * was two claims on one microphone and it worked about two holds in three. The report was exactly
 * what that produces: *"the transcription is still not working sometimes… I don't really
 * understand why."*
 *
 * So the rule under test here is a rule about determinism, not about accuracy:
 *
 *   · in cloud mode with a recorder, `listen` records and uploads and NEVER starts the recogniser;
 *   · a hold that captured audio ends in text or in a thrown error the bar can say out loud;
 *   · a hold that captured nothing resolves `{ text: "" }`, which is "say it again", not a lie;
 *   · the microphone track is stopped on every path out, including cancels, errors and timeouts;
 *   · nothing in here can wait forever, because one unbounded await latched the bar's own guard
 *     and killed every hold after it.
 *
 * The three-holds-in-a-row test is the one that matters most: "sometimes" almost always means
 * "not the second one".
 */
describe("cloud speech: one engine per hold, and never silence", () => {
  /** What the recorder produces. Non-empty is all `listen` asks for before it will upload. */
  const CLIP = Uint8Array.from([1, 2, 3]);
  /** What `/api/stt` returns. */
  const ACCURATE = "呢隻藥要唔要隨餐食？";

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  interface FakeTrack {
    stopped: number;
  }

  interface Recorders {
    /** Every recorder built in this session, in order. */
    readonly made: FakeRecorderLike[];
  }

  interface FakeRecorderLike {
    state: string;
    mimeType: string;
    timeslice: number | undefined;
    ondataavailable: ((event: { data: Blob }) => void) | null;
    onstop: (() => void) | null;
    onerror: (() => void) | null;
    start(timeslice?: number): void;
    requestData(): void;
    stop(): void;
  }

  interface WorldOptions {
    /** Take the recogniser away (Firefox, and some locked-down WebViews). */
    noRecognition?: boolean;
    /** Take the recorder away — the bar must be exactly the browser path it always was. */
    noRecorder?: boolean;
    /** What `getUserMedia` does. Defaults to handing over a working stream. */
    openMic?: () => Promise<unknown>;
    /** A recorder that goes quiet and never fires `onstop`, the way iOS Safari can. */
    deadOnStop?: boolean;
    /** A recorder that captures nothing at all: a flick of the thumb, or a broken capture. */
    silent?: boolean;
    /** What `/api/stt` does. Defaults to answering with `ACCURATE`. */
    upload?: (init: RequestInit, attempt: number) => Promise<Response>;
    /** Pretend this is an iPhone with the Safari 16.4 audio session API. */
    audioSession?: { type: string };
    /** How long `getUserMedia` takes. A cold page, or a permission prompt, is not instant. */
    micOpensAfterMs?: number;
  }

  interface World {
    listen: typeof import("@/lib/speech/stt").listen;
    uploads: { url: string; init: RequestInit }[];
    interims: string[];
    tracks: FakeTrack[];
    recorders: Recorders;
    /** How many times a recogniser was constructed. Must be 0 on the recorded path. */
    recognitions: () => number;
    /** One entry per `onOpen`: capture is genuinely running, and the bar may say so. */
    opens: number[];
  }

  /**
   * One page load: the globals a phone would have, and the module that reads them.
   *
   * Deliberately built ONCE per test rather than once per hold, because what this file is really
   * checking is what the second and third holds do — and `lib/speech/stt.ts` remembers, for the
   * life of the page, whether the recorder proved usable.
   */
  async function world(options: WorldOptions = {}): Promise<World> {
    vi.resetModules();
    const uploads: { url: string; init: RequestInit }[] = [];
    const interims: string[] = [];
    const tracks: FakeTrack[] = [];
    const made: FakeRecorderLike[] = [];
    const opens: number[] = [];
    let recognitions = 0;

    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        recognitions += 1;
      }
      start(): void {
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: false, 0: { transcript: "呢隻藥要唔要隨參食" } }],
        });
      }
      stop(): void {
        this.onend?.();
      }
      abort(): void {
        this.onend?.();
      }
    }

    class FakeRecorder implements FakeRecorderLike {
      static isTypeSupported = () => true;
      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      timeslice: number | undefined = undefined;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        made.push(this);
      }
      start(timeslice?: number): void {
        this.timeslice = timeslice;
        this.state = "recording";
      }
      requestData(): void {
        // A real recorder flushes the tail of the utterance here. This is what makes the clip
        // survive a recorder that then refuses to end cleanly.
        if (this.state !== "recording" || options.silent) return;
        this.ondataavailable?.({ data: new Blob([CLIP], { type: "audio/webm" }) });
      }
      stop(): void {
        this.state = "inactive";
        if (options.deadOnStop) return;
        this.onstop?.();
      }
    }

    const win: Record<string, unknown> = {};
    if (!options.noRecognition) win.webkitSpeechRecognition = FakeRecognition;
    vi.stubGlobal("window", win);

    const navigatorStub: Record<string, unknown> = {};
    if (options.audioSession) navigatorStub.audioSession = options.audioSession;
    if (options.noRecorder) {
      vi.stubGlobal("MediaRecorder", undefined);
    } else {
      vi.stubGlobal("MediaRecorder", FakeRecorder);
      navigatorStub.mediaDevices = {
        getUserMedia:
          options.openMic ??
          (async () => {
            // A cold page and a permission prompt both make this slow, and the hold can be over
            // before it answers — which is the first hold of every session on a phone.
            if (options.micOpensAfterMs) {
              await new Promise((resolve) => setTimeout(resolve, options.micOpensAfterMs));
            }
            const track: FakeTrack = { stopped: 0 };
            tracks.push(track);
            return { getTracks: () => [{ stop: () => (track.stopped += 1) }] };
          }),
      };
    }
    vi.stubGlobal("navigator", navigatorStub);

    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        uploads.push({ url, init });
        attempt += 1;
        return options.upload
          ? options.upload(init, attempt)
          : jsonResponse({ text: ACCURATE });
      }),
    );

    process.env.NEXT_PUBLIC_STT_MODE = "cloud";
    const { listen } = await import("@/lib/speech/stt");

    return {
      listen,
      uploads,
      interims,
      tracks,
      recorders: { made },
      recognitions: () => recognitions,
      opens,
    };
  }

  /**
   * Press the bar, speak, let go.
   *
   * The promise comes back wrapped in an object rather than returned directly: an `async` function
   * that returns a promise adopts it, so `await hold(...)` would await the hold ITSELF and a
   * rejection would escape before the assertion could catch it.
   */
  interface Held {
    result: Promise<{ text: string }>;
  }

  async function hold(
    w: World,
    options: { cancel?: boolean; heldMs?: number; cloudTimeoutMs?: number } = {},
  ): Promise<Held> {
    const stop = new AbortController();
    const cancel = new AbortController();
    const result = w.listen("yue", {
      stop: stop.signal,
      cancel: cancel.signal,
      cloudTimeoutMs: options.cloudTimeoutMs,
      onInterim: (text) => w.interims.push(text),
      onOpen: () => w.opens.push(Date.now()),
    });
    // `ChatBar` awaits `listen` inside a try/catch, so its handler is attached synchronously.
    // Here the wait below comes first, so a rejection would land unhandled and Vitest would report
    // it as an error even though the test goes on to assert it.
    result.catch(() => {});
    // The microphone opens behind an async permission prompt; a real hold outlives it.
    await tick();
    if (options.heldMs) await new Promise((resolve) => setTimeout(resolve, options.heldMs));
    if (options.cancel) cancel.abort();
    else stop.abort();
    return { result };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* ------------------------------------------------------------------ the rule */

  it("records and uploads, and never starts the browser engine beside it", async () => {
    const w = await world();
    const { result } = await hold(w);

    await expect(result).resolves.toEqual({ text: ACCURATE });
    expect(w.uploads).toHaveLength(1);
    expect(w.uploads[0].url).toBe("/api/stt?language=yue");
    expect(w.uploads[0].init.method).toBe("POST");
    // The whole diagnosis, as one assertion: two engines never share the microphone again.
    expect(w.recognitions()).toBe(0);
    expect(w.interims).toEqual([]);
  });

  it("records in chunks, so a recorder that goes quiet has still handed most of it over", async () => {
    const w = await world();
    await (await hold(w)).result;

    expect(w.recorders.made).toHaveLength(1);
    expect(w.recorders.made[0].timeslice).toBeGreaterThan(0);
  });

  /* --------------------------------------------------------- "not the second one" */

  it("sends all three of three holds in a row, and releases the microphone each time", async () => {
    // "Sometimes" almost always means "not the second one": a leaked track, a latched guard, a
    // recorder that was never released. Three holds on one page load is the shape of the bug.
    const w = await world();

    for (const attempt of [1, 2, 3]) {
      await expect((await hold(w)).result).resolves.toEqual({ text: ACCURATE });
      expect(w.uploads, `upload ${attempt}`).toHaveLength(attempt);
      expect(w.tracks, `track ${attempt}`).toHaveLength(attempt);
    }

    // Every microphone track opened is a microphone track stopped. A leaked one is the best
    // explanation there is for a second hold that does nothing.
    expect(w.tracks.map((track) => track.stopped)).toEqual([1, 1, 1]);
    expect(w.recognitions()).toBe(0);
  });

  /* ------------------------------------------------------ audio captured, no words */

  it("says so out loud when the recording could not be sent at all", async () => {
    // The bug, in one test. Audio was captured; the network ate it. Before this, the reader got
    // nothing on screen and no reason — which is indistinguishable from the app ignoring them.
    const w = await world({ upload: () => Promise.reject(new Error("network down")) });

    await expect((await hold(w)).result).rejects.toMatchObject({
      code: "speech_unavailable",
      reason: "network",
    });
  });

  it("tries the upload twice before giving up on it", async () => {
    const w = await world({
      upload: (_init, attempt) =>
        attempt === 1
          ? Promise.reject(new Error("network blip"))
          : Promise.resolve(jsonResponse({ text: ACCURATE })),
    });

    await expect((await hold(w)).result).resolves.toEqual({ text: ACCURATE });
    expect(w.uploads).toHaveLength(2);
  });

  it("does not retry a 502, and still says so rather than going quiet", async () => {
    const w = await world({
      upload: () => Promise.resolve(jsonResponse({ error: "stt_failed" }, 502)),
    });

    await expect((await hold(w)).result).rejects.toMatchObject({ reason: "network" });
    // A 502 is the provider answering; a second identical clip gets the same answer. One retry is
    // for a dropped connection, not for a route that already made up its mind.
    expect(w.uploads).toHaveLength(2);
  });

  it("says so when the upload times out rather than resolving with nothing", async () => {
    const w = await world({
      upload: (init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    });

    await expect((await hold(w, { cloudTimeoutMs: 20 })).result).rejects.toMatchObject({
      reason: "network",
    });
  });

  /* --------------------------------------------------------------- nothing captured */

  it("resolves empty when the hold captured nothing, so the bar can ask for it again", async () => {
    const w = await world({ silent: true });

    await expect((await hold(w)).result).resolves.toEqual({ text: "" });
    // Nothing was captured, so nothing may leave the phone.
    expect(w.uploads).toHaveLength(0);
  });

  it("answers empty when the route heard the clip and found no words in it", async () => {
    const w = await world({ upload: () => Promise.resolve(jsonResponse({ text: "   " })) });

    await expect((await hold(w)).result).resolves.toEqual({ text: "" });
  });

  /* ------------------------------------------------------------- nothing may hang */

  it("still delivers when the recorder never fires onstop", async () => {
    // iOS Safari can leave a recorder whose audio session was taken away sitting in `recording`
    // with no `onstop` ever. `await recording.clip` had no ceiling, so `listen` never resolved,
    // `ChatBar`'s `finally` never ran, and its listening guard stayed latched — every hold after
    // that returned at its first line. This is that phone.
    const w = await world({ deadOnStop: true });

    await expect((await hold(w)).result).resolves.toEqual({ text: ACCURATE });
    expect(w.tracks[0].stopped).toBeGreaterThan(0);
  }, 10_000);

  /* -------------------------------------------------------------------- the cancel */

  it("uploads nothing when the hold is cancelled, and still lets the microphone go", async () => {
    const w = await world();

    await expect((await hold(w, { cancel: true })).result).resolves.toEqual({ text: "" });
    expect(w.uploads).toHaveLength(0);
    expect(w.tracks[0].stopped).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------------------ the fallback */

  it("is exactly the old browser path when the device cannot record", async () => {
    const w = await world({ noRecorder: true });

    await expect((await hold(w)).result).resolves.toEqual({ text: "呢隻藥要唔要隨參食" });
    expect(w.uploads).toHaveLength(0);
    // With no upload to wait for, the words on screen are all there is — so they still appear.
    expect(w.interims).toContain("呢隻藥要唔要隨參食");
  });

  it("switches to the browser engine for good once the microphone will not open", async () => {
    // NotReadableError: the microphone is busy — a call, another tab, iOS still holding it from
    // the last session. Not a refusal, so the bar must not move to the keyboard for the day; and
    // not a coin flip either, so the session stops trying the recorder at all.
    const w = await world({
      openMic: () => Promise.reject(Object.assign(new Error("busy"), { name: "NotReadableError" })),
    });

    await expect((await hold(w)).result).resolves.toEqual({ text: "呢隻藥要唔要隨參食" });
    await expect((await hold(w)).result).resolves.toEqual({ text: "呢隻藥要唔要隨參食" });
    // Two holds, and the microphone was asked for exactly once. That is what "deterministic"
    // means here: the answer stops changing.
    expect(w.recorders.made).toHaveLength(0);
    expect(w.recognitions()).toBe(2);
  });

  it("switches to the browser engine when the route says speech is recognised on the device", async () => {
    const w = await world({
      upload: () => Promise.resolve(jsonResponse({ error: "browser_fallback" }, 503)),
    });

    // The clip that hit the 503 is gone, so this hold is an honest failure…
    await expect((await hold(w)).result).rejects.toMatchObject({ reason: "network" });
    // …and the next one does not repeat the mistake.
    await expect((await hold(w)).result).resolves.toEqual({ text: "呢隻藥要唔要隨參食" });
    expect(w.uploads).toHaveLength(1);
  });

  it("keeps a refusal permanent, and does not fall through to a second prompt", async () => {
    const w = await world({
      openMic: () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })),
    });

    // `ChatBar` turns this into the keyboard for the rest of the session. Falling back to the
    // recogniser here would put a SECOND permission prompt in front of somebody who just said no.
    await expect((await hold(w)).result).rejects.toMatchObject({ reason: "denied" });
    expect(w.recognitions()).toBe(0);
  });

  it("asks for the keyboard only when neither engine exists", async () => {
    const w = await world({ noRecognition: true, noRecorder: true });

    await expect((await hold(w)).result).rejects.toMatchObject({
      code: "speech_unavailable",
      reason: "no_api",
    });
  });

  /* ------------------------------------------------- the microphone is not open yet */

  it("only says it is listening once capture is genuinely running", async () => {
    // The bar goes jade at 220 ms and used to say 「聽住你講…」 there — before `getUserMedia` had
    // answered. `onOpen` is the moment that sentence becomes true, and it is after the recorder
    // starts, not after the press.
    const w = await world();
    await (await hold(w)).result;

    expect(w.opens).toHaveLength(1);
    expect(w.recorders.made).toHaveLength(1);
  });

  it("says the microphone was not open when the hold ends before it opens", async () => {
    // Measured in real Chrome on a cold page: `getUserMedia` had not resolved by the end of a
    // 900 ms hold, and nothing was recorded. On a phone that first call is behind a permission
    // prompt, so this is the FIRST hold of a session — the one that has to not lie.
    const w = await world({ micOpensAfterMs: 5_000 });
    const { result } = await hold(w);

    await expect(result).rejects.toMatchObject({
      code: "speech_unavailable",
      reason: "provider",
    });
    // Never "I didn't catch that": nothing was listening, so there was nothing to catch.
    expect(w.opens).toEqual([]);
  }, 10_000);

  it("closes a microphone that opens after nobody is holding the bar", async () => {
    // The late stream still arrives. An open track with no hold behind it is exactly the leak
    // that makes the NEXT press do nothing.
    const w = await world({ micOpensAfterMs: 600 });
    const { result } = await hold(w);
    await expect(result).rejects.toMatchObject({ reason: "provider" });

    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(w.tracks).toHaveLength(1);
    expect(w.tracks[0].stopped).toBeGreaterThan(0);
  }, 10_000);

  it("says the same thing when the microphone opens a hair AFTER the release", async () => {
    // It won the race by a whisker, so there is a recorder — but it was never listening while
    // anybody was talking, and the clip is empty. The reader is owed "it was not open", not
    // 「我冇聽到」: the first tells them to hold it longer, the second tells them to shout.
    const w = await world({ micOpensAfterMs: 150, silent: true });
    const { result } = await hold(w);

    await expect(result).rejects.toMatchObject({ reason: "provider" });
    expect(w.opens).toEqual([]);
    // And it is not mistaken for a broken recorder, so the session stays on the cloud path.
    expect(w.tracks[0].stopped).toBeGreaterThan(0);
  });

  it("is still instant on the browser engine, which is listening the moment it starts", async () => {
    const w = await world({ noRecorder: true });
    await (await hold(w)).result;

    // Synchronous there, so the bar never shows an opening state on a device with no recorder.
    expect(w.opens).toHaveLength(1);
  });

  /* --------------------------------------------------------------- the iOS session */

  it("claims the recording audio session for the hold and hands it straight back", async () => {
    // `lib/speech/unlock.ts` sets the session to "playback" so the ring/silent switch cannot mute
    // 明明. That is the type for a page that does NOT record, and it was still set when the
    // microphone opened. Safari 16.4+ only; everywhere else there is no such object.
    const session = { type: "playback" };
    const seen: string[] = [];
    const w = await world({
      audioSession: session,
      openMic: async () => {
        seen.push(session.type);
        return { getTracks: () => [{ stop: () => {} }] };
      },
    });

    await (await hold(w)).result;

    expect(seen).toEqual(["play-and-record"]);
    // And back, so the answer 明明 speaks next is not at the mercy of the mute switch.
    expect(session.type).toBe("playback");
  });
});
