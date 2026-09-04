/**
 * Speech provider selection. Server-side only - importing this from a client component would
 * pull API keys into the browser bundle.
 *
 * `TTS_PROVIDER` and `STT_PROVIDER` default to "browser" and stay there until the day-one
 * listening and transcription tests pick a cloud provider (research.md R5/R6, recorded in
 * `tests/eval/voices.md` and `tests/eval/stt.md`, then written into `.env.example` by T020).
 *
 * Providers are constructed per call rather than cached, so configuration is validated against
 * the current environment every time and a key added at runtime takes effect immediately. The
 * cost is a few string reads.
 */

import { createAzureSttProvider, createAzureTtsProvider } from "./azure";
import { browserSttProvider, browserTtsProvider } from "./browser";
import { createElevenLabsSttProvider, createElevenLabsTtsProvider } from "./elevenlabs";
import { createMinimaxTtsProvider } from "./minimax";
import { createOpenAiSttProvider } from "./openai";
import { readEnvOr, type SttProvider, type TtsProvider } from "./types";

export const TTS_PROVIDER_IDS = ["minimax", "elevenlabs", "azure", "browser"] as const;
export const STT_PROVIDER_IDS = ["openai", "elevenlabs", "azure", "browser"] as const;

export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];

export class UnknownSpeechProviderError extends Error {
  readonly code = "unknown_speech_provider";

  constructor(envVar: string, value: string, allowed: readonly string[]) {
    super(
      `${envVar}="${value}" is not a known provider. Use one of: ${allowed.join(", ")}.`,
    );
    this.name = "UnknownSpeechProviderError";
  }
}

/** The configured TTS provider id, without constructing the provider. */
export function ttsProviderId(): TtsProviderId {
  const value = readEnvOr("TTS_PROVIDER", "browser").toLowerCase();
  if (!(TTS_PROVIDER_IDS as readonly string[]).includes(value)) {
    throw new UnknownSpeechProviderError("TTS_PROVIDER", value, TTS_PROVIDER_IDS);
  }
  return value as TtsProviderId;
}

/** The configured STT provider id, without constructing the provider. */
export function sttProviderId(): SttProviderId {
  const value = readEnvOr("STT_PROVIDER", "browser").toLowerCase();
  if (!(STT_PROVIDER_IDS as readonly string[]).includes(value)) {
    throw new UnknownSpeechProviderError("STT_PROVIDER", value, STT_PROVIDER_IDS);
  }
  return value as SttProviderId;
}

/**
 * Resolve the text-to-speech provider.
 *
 * Throws `SpeechConfigError` (naming the missing environment variables) when the selected
 * provider has no keys, and `UnknownSpeechProviderError` for an unrecognised value. Returns
 * the browser marker by default; its `synthesize` rejects with `BrowserFallbackError`.
 */
export function getTtsProvider(): TtsProvider {
  switch (ttsProviderId()) {
    case "minimax":
      return createMinimaxTtsProvider();
    case "elevenlabs":
      return createElevenLabsTtsProvider();
    case "azure":
      return createAzureTtsProvider();
    case "browser":
      return browserTtsProvider;
  }
}

/**
 * Resolve the speech-to-text provider. Same error contract as `getTtsProvider`. MiniMax is not
 * an STT candidate (`provider_shortlist.md` section 2). OpenAI is STT only - the voice is
 * MiniMax's, and `openai.ts` exports no `TtsProvider` so that cannot drift.
 */
export function getSttProvider(): SttProvider {
  switch (sttProviderId()) {
    case "openai":
      return createOpenAiSttProvider();
    case "elevenlabs":
      return createElevenLabsSttProvider();
    case "azure":
      return createAzureSttProvider();
    case "browser":
      return browserSttProvider;
  }
}

export {
  BROWSER_PROVIDER_ID,
  BrowserFallbackError,
  isBrowserFallbackError,
} from "./browser";
export {
  SpeechConfigError,
  SpeechProviderError,
  type Dialect,
  type InputLanguage,
  type SttProvider,
  type SynthesisResult,
  type TranscriptionResult,
  type TtsProvider,
} from "./types";
