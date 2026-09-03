/**
 * Route tests for `POST /api/tts` and `POST /api/stt` (T023).
 *
 * No keys exist here, so provider selection is mocked and the adapters themselves are covered by
 * `tests/unit/speech-providers.test.ts`. What is asserted is only what the routes own: the body
 * and query contracts, the size limits, the audio passthrough with its media type and cache
 * header, and the mapping of the three provider error classes to 503 / 503 / 502.
 *
 * 503 is the "speak on the device" signal, not a failure — `lib/speech/tts.ts` and
 * `lib/speech/stt.ts` both branch on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserFallbackError } from "../../lib/speech/providers/browser";
import {
  SpeechConfigError,
  SpeechProviderError,
  toArrayBuffer,
} from "../../lib/speech/providers/types";

const { synthesizeMock, transcribeMock } = vi.hoisted(() => ({
  synthesizeMock: vi.fn(),
  transcribeMock: vi.fn(),
}));

vi.mock("@/lib/speech/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/speech/providers")>();
  return {
    ...actual,
    getTtsProvider: () => ({ id: "mock", synthesize: synthesizeMock }),
    getSttProvider: () => ({ id: "mock", transcribe: transcribeMock }),
  };
});

const { POST: ttsPost } = await import("@/app/api/tts/route");
const { POST: sttPost } = await import("@/app/api/stt/route");

/* ------------------------------------------------------------------ fixtures */

/** "ID3" plus a version byte: enough to prove the bytes came through untouched. */
const AUDIO = Uint8Array.from([0x49, 0x44, 0x33, 0x04]);

/** A Cantonese medicine line: the string that must never appear in a log. */
const YUE_TEXT = "Amlodipine 5mg，一粒，每日一次。";

function ttsRequest(body: unknown): Request {
  return new Request("http://localhost/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sttRequest(query: string, bytes: Uint8Array = AUDIO, mimeType = "audio/webm"): Request {
  return new Request(`http://localhost/api/stt${query}`, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    // `BodyInit` needs an ArrayBuffer-backed value since TS 5.7; the helper copies rather than casts.
    body: toArrayBuffer(bytes),
  });
}

let logs: unknown[][];

beforeEach(() => {
  vi.clearAllMocks();
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------- /api/tts */

describe("POST /api/tts", () => {
  it("returns the provider's bytes with its media type and a private cache header", async () => {
    synthesizeMock.mockResolvedValue({ audio: AUDIO, mimeType: "audio/mpeg" });

    const response = await ttsPost(ttsRequest({ text: YUE_TEXT, dialect: "yue" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(AUDIO);
    expect(synthesizeMock).toHaveBeenCalledWith(YUE_TEXT, "yue");
  });

  it("passes the provider's own mime type through rather than assuming mp3", async () => {
    synthesizeMock.mockResolvedValue({ audio: AUDIO, mimeType: "audio/wav" });

    const response = await ttsPost(ttsRequest({ text: "測試。", dialect: "cmn" }));

    expect(response.headers.get("content-type")).toBe("audio/wav");
  });

  it("never logs the text", async () => {
    synthesizeMock.mockResolvedValue({ audio: AUDIO, mimeType: "audio/mpeg" });

    await ttsPost(ttsRequest({ text: YUE_TEXT, dialect: "yue" }));

    expect(JSON.stringify(logs)).not.toContain("Amlodipine");
  });

  it("answers 503 browser_fallback when speech is configured to run on the device", async () => {
    synthesizeMock.mockRejectedValue(new BrowserFallbackError("synthesize"));

    const response = await ttsPost(ttsRequest({ text: YUE_TEXT, dialect: "yue" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "browser_fallback" });
  });

  it("answers 503 when the selected provider has no keys", async () => {
    synthesizeMock.mockRejectedValue(new SpeechConfigError("minimax", ["MINIMAX_API_KEY"]));

    const response = await ttsPost(ttsRequest({ text: YUE_TEXT, dialect: "yue" }));

    expect(response.status).toBe(503);
    // The error message names environment variables; it is not forwarded to the phone.
    expect(await response.json()).toEqual({ error: "speech_unavailable" });
  });

  it("answers 502 tts_failed when the provider's call fails", async () => {
    synthesizeMock.mockRejectedValue(new SpeechProviderError("minimax", 500));

    const response = await ttsPost(ttsRequest({ text: YUE_TEXT, dialect: "yue" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "tts_failed" });
  });

  it("answers 413 for a body over 2 kB and never calls the provider", async () => {
    const response = await ttsPost(ttsRequest({ text: "字".repeat(1500), dialect: "yue" }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expect(synthesizeMock).not.toHaveBeenCalled();
  });

  it("accepts English, the third form of every card", async () => {
    synthesizeMock.mockResolvedValue({ audio: AUDIO, mimeType: "audio/mpeg" });

    const response = await ttsPost(
      ttsRequest({ text: "Amlodipine 5mg, one tablet, once a day.", dialect: "en" }),
    );

    expect(response.status).toBe(200);
    expect(synthesizeMock).toHaveBeenCalledWith(
      "Amlodipine 5mg, one tablet, once a day.",
      "en",
    );
  });

  it("rejects a missing dialect, an unknown dialect, empty text and extra keys", async () => {
    expect((await ttsPost(ttsRequest({ text: YUE_TEXT }))).status).toBe(400);
    // "wuu" (Shanghainese) is a real language tag and still not one this app speaks.
    expect((await ttsPost(ttsRequest({ text: YUE_TEXT, dialect: "wuu" }))).status).toBe(400);
    expect((await ttsPost(ttsRequest({ text: "", dialect: "yue" }))).status).toBe(400);
    expect(
      (await ttsPost(ttsRequest({ text: "測試。", dialect: "yue", label: "阿媽" }))).status,
    ).toBe(400);
    expect(synthesizeMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------- /api/stt */

describe("POST /api/stt", () => {
  it("requires a language and never guesses one", async () => {
    const missing = await sttPost(sttRequest(""));
    const unknown = await sttPost(sttRequest("?language=fr"));

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "bad_request" });
    expect(unknown.status).toBe(400);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("returns the transcript and forwards the clip's own mime type", async () => {
    transcribeMock.mockResolvedValue({ text: "白色嗰粒係朝早定夜晚食？" });

    const response = await sttPost(
      sttRequest("?language=yue", AUDIO, "audio/webm;codecs=opus"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "白色嗰粒係朝早定夜晚食？" });
    expect(transcribeMock).toHaveBeenCalledWith(AUDIO, "audio/webm;codecs=opus", "yue");
  });

  it("accepts every input language", async () => {
    transcribeMock.mockResolvedValue({ text: "ok" });

    for (const language of ["yue", "cmn", "en"] as const) {
      const response = await sttPost(sttRequest(`?language=${language}`));
      expect(response.status).toBe(200);
      expect(transcribeMock).toHaveBeenLastCalledWith(AUDIO, "audio/webm", language);
    }
  });

  it("never logs the audio or the transcript", async () => {
    transcribeMock.mockResolvedValue({ text: "白色嗰粒係朝早定夜晚食？" });

    await sttPost(sttRequest("?language=yue"));

    expect(JSON.stringify(logs)).not.toContain("白色");
  });

  it("answers 503 when recognition is configured to run on the device", async () => {
    transcribeMock.mockRejectedValue(new BrowserFallbackError("transcribe"));

    const response = await sttPost(sttRequest("?language=yue"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "browser_fallback" });
  });

  it("answers 503 when the selected provider has no keys", async () => {
    transcribeMock.mockRejectedValue(new SpeechConfigError("azure", ["AZURE_SPEECH_KEY"]));

    expect((await sttPost(sttRequest("?language=yue"))).status).toBe(503);
  });

  it("answers 502 stt_failed when the provider's call fails", async () => {
    transcribeMock.mockRejectedValue(new SpeechProviderError("elevenlabs", 500));

    const response = await sttPost(sttRequest("?language=yue"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "stt_failed" });
  });

  it("rejects an empty clip and one over 5 MB", async () => {
    const empty = await sttPost(sttRequest("?language=yue", new Uint8Array(0)));
    const huge = await sttPost(sttRequest("?language=yue", new Uint8Array(5 * 1024 * 1024 + 1)));

    expect(empty.status).toBe(400);
    expect(huge.status).toBe(413);
    expect(transcribeMock).not.toHaveBeenCalled();
  });
});
