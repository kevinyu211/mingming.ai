/**
 * The browser marker provider. Server-side only, and it never talks to a network.
 *
 * When TTS_PROVIDER (or STT_PROVIDER) is "browser" - the default, and what runs until the
 * day-one listening test picks a cloud voice (research.md R5/R6) - the server has no work to
 * do: the phone speaks with `window.speechSynthesis` and listens with `SpeechRecognition`.
 *
 * This marker exists so `getTtsProvider()` always returns a provider and the route handler has
 * exactly one branch: catch `BrowserFallbackError` and answer 503, which is the signal
 * `lib/speech/tts.ts` reads as "do it on the device". It also means no request body is ever
 * sent anywhere in the default configuration.
 */

import type { SttProvider, TtsProvider } from "./types";

export const BROWSER_PROVIDER_ID = "browser";

/**
 * Not an error condition: the intended outcome when speech is configured to happen on the
 * device. `/api/tts` and `/api/stt` should map this to HTTP 503, which the client treats as
 * "use the browser API" rather than as a failure.
 */
export class BrowserFallbackError extends Error {
  readonly code = "browser_fallback";

  constructor(op: "synthesize" | "transcribe" = "synthesize") {
    super(
      `Speech is configured to run in the browser (provider "${BROWSER_PROVIDER_ID}"), so the server does not ${op}. Respond 503 and let the client use the Web Speech API.`,
    );
    this.name = "BrowserFallbackError";
  }
}

export function isBrowserFallbackError(error: unknown): error is BrowserFallbackError {
  return error instanceof BrowserFallbackError;
}

export const browserTtsProvider: TtsProvider = {
  id: BROWSER_PROVIDER_ID,
  synthesize() {
    return Promise.reject(new BrowserFallbackError("synthesize"));
  },
};

export const browserSttProvider: SttProvider = {
  id: BROWSER_PROVIDER_ID,
  transcribe() {
    return Promise.reject(new BrowserFallbackError("transcribe"));
  },
};
