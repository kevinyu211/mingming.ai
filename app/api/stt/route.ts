/**
 * `POST /api/stt?language=yue|cmn|en` — one recorded question turned into text (T023).
 *
 * Request: the raw clip as the body, `Content-Type` set to the recorder's own mime type
 * (`lib/speech/stt.ts` sends `clip.type`, e.g. `audio/webm;codecs=opus`). It is passed through
 * untouched — each adapter decides what its API needs.
 * Response: `{ "text": "..." }`, or 503 meaning "recognise on the device".
 *
 * Logging (constitution V): neither the audio nor the transcript is ever logged here. The clip is
 * the one thing that leaves the phone besides the question text, and it is not stored.
 */
import {
  BrowserFallbackError,
  SpeechConfigError,
  SpeechProviderError,
  UnknownSpeechProviderError,
  getSttProvider,
} from "@/lib/speech/providers";
import { z } from "zod";

/** The adapters read API keys from `process.env`. */
export const runtime = "nodejs";

/** A push-to-talk question is a few seconds; 5 MB is a generous ceiling for any codec. */
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const LanguageSchema = z.enum(["yue", "cmn", "en"]);

/** Used when the recorder sent no `Content-Type`; the adapters treat it as an opaque clip. */
const DEFAULT_MIME_TYPE = "application/octet-stream";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // Required, and never defaulted: transcribing Cantonese as Mandarin (or the reverse) produces
  // confident nonsense, which is worse than asking the user to type.
  const language = LanguageSchema.safeParse(
    new URL(request.url).searchParams.get("language"),
  );
  if (!language.success) return json({ error: "bad_request" }, 400);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let raw: ArrayBuffer;
  try {
    raw = await request.arrayBuffer();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (raw.byteLength > MAX_AUDIO_BYTES) return json({ error: "payload_too_large" }, 413);
  if (raw.byteLength === 0) return json({ error: "bad_request" }, 400);

  const mimeType = request.headers.get("content-type")?.trim() || DEFAULT_MIME_TYPE;

  try {
    const { text } = await getSttProvider().transcribe(
      new Uint8Array(raw),
      mimeType,
      language.data,
    );
    return json({ text }, 200);
  } catch (error) {
    if (error instanceof BrowserFallbackError) return json({ error: "browser_fallback" }, 503);
    if (error instanceof SpeechConfigError || error instanceof UnknownSpeechProviderError) {
      return json({ error: "speech_unavailable" }, 503);
    }
    if (error instanceof SpeechProviderError) return json({ error: "stt_failed" }, 502);
    // Provider messages can quote the transcript back, so no detail is forwarded.
    return json({ error: "stt_failed" }, 502);
  }
}
