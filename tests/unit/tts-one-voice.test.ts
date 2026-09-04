/**
 * A companion has ONE voice.
 *
 * `lib/speech/tts.ts` used to fall through to `window.speechSynthesis` whenever a cloud clip
 * failed to fetch OR failed to play. On iOS the commonest reason for the second is the autoplay
 * policy, and 明仔 speaks without being tapped — so on a real iPhone most lines came out in the
 * chosen Cantonese voice and occasional lines came out in iOS's own robot, mid-conversation, with
 * nothing on screen to explain it. It reads as a broken product, and it was heard within a minute
 * of opening the app on a real phone.
 *
 * The device voice now speaks ONLY where it is the configured provider (`TTS_PROVIDER=browser`,
 * which the route signals with a 503). Everywhere else a failure is silence with the words on
 * screen, which the interface already designs for (`fallback.noVoice`).
 *
 * This repo's vitest runs in `node` with no jsdom, so the browser surface `tts.ts` touches is
 * stubbed here by hand — which is also why the stub is deliberately GENEROUS: a device voice that
 * would gladly speak, so a passing test proves it was never asked rather than that it could not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Utterance {
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function stubBrowser(): { deviceSpeak: ReturnType<typeof vi.fn> } {
  const deviceSpeak = vi.fn((utterance: Utterance) => utterance.onend?.());

  vi.stubGlobal("window", {
    speechSynthesis: {
      speak: deviceSpeak,
      cancel: vi.fn(),
      getVoices: () => [{ lang: "zh-HK", name: "Sinji", default: true }],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    SpeechSynthesisUtterance: class {
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      lang = "";
      rate = 1;
      constructor(public text: string) {}
    },
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      lang = "";
      rate = 1;
      constructor(public text: string) {}
    },
  );
  return { deviceSpeak };
}

describe("the device voice is never a silent substitute", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stays silent rather than switching voice when the cloud clip cannot be fetched", async () => {
    const { deviceSpeak } = stubBrowser();
    // The network is gone. Before the fix this fell straight through to the device voice.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    const { speak } = await import("@/lib/speech/tts");
    const result = await speak("心臟藥每日兩次。", "yue");

    expect(result.mode).toBe("text-only");
    expect(deviceSpeak).not.toHaveBeenCalled();
  });

  /**
   * The one case where the device voice is legitimate: the deployment chose it. The route says so
   * with a 503, and then it is the product's voice rather than an unannounced stand-in.
   */
  it("does speak on the device when the server says device speech is configured", async () => {
    const { deviceSpeak } = stubBrowser();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
    );

    const { speak } = await import("@/lib/speech/tts");
    const result = await speak("心臟藥每日兩次。", "yue");

    expect(result.mode).toBe("browser");
    expect(deviceSpeak).toHaveBeenCalledTimes(1);
  });
});
