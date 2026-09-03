/**
 * `POST /api/tts` — one card or answer spoken by the configured voice provider (T023).
 *
 * Request: `{ "text": "...", "dialect": "yue" | "cmn" | "en" }`, at most 2 kB of body.
 * Response: the provider's audio bytes with the provider's own media type.
 *
 * 503 is not a failure: it is the signal `lib/speech/tts.ts` reads as "speak on the device". It is
 * returned both for the browser marker provider (the default until the listening test picks a
 * cloud voice) and for a cloud provider that is selected but unconfigured — in both cases the
 * phone can still speak, so the client must not be told the feature is broken.
 *
 * Logging (constitution V, research.md R5): this route never logs the text. The adapters emit
 * their own provider/status/duration line through `logSpeechEvent`; nothing is added here.
 */
import {
  BrowserFallbackError,
  SpeechConfigError,
  SpeechProviderError,
  UnknownSpeechProviderError,
  getTtsProvider,
} from "@/lib/speech/providers";
import { toArrayBuffer } from "@/lib/speech/providers/types";
import { z } from "zod";

/** The adapters read API keys from `process.env`. */
export const runtime = "nodejs";

/** One card's worth of speech. Longer than any sentence the rules can produce. */
const MAX_TEXT_CHARS = 2000;

/** A 2000-character Chinese sentence is well under this once JSON-encoded. */
const MAX_BODY_BYTES = 2048;

const TtsRequestSchema = z.strictObject({
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  // The three spoken forms of a card — the same keys as `Speakable` in the reading schema.
  dialect: z.enum(["yue", "cmn", "en"]),
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // Cheap rejection first, so an oversized body is not read into memory when the sender declared
  // its length. The measured check below is the one that actually holds.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let raw: ArrayBuffer;
  try {
    raw = await request.arrayBuffer();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (raw.byteLength > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const parsed = TtsRequestSchema.safeParse(payload);
  if (!parsed.success) return json({ error: "bad_request" }, 400);

  try {
    const { audio, mimeType } = await getTtsProvider().synthesize(
      parsed.data.text,
      parsed.data.dialect,
    );
    return new Response(toArrayBuffer(audio), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        // Per device only: the same sentence is replayed while a card is on screen, and the audio
        // is a spoken line from someone's discharge sheet, so no shared cache may hold it.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof BrowserFallbackError) return json({ error: "browser_fallback" }, 503);
    if (error instanceof SpeechConfigError || error instanceof UnknownSpeechProviderError) {
      return json({ error: "speech_unavailable" }, 503);
    }
    if (error instanceof SpeechProviderError) return json({ error: "tts_failed" }, 502);
    // Anything else is still an upstream failure from the client's point of view, and its message
    // may quote the request text, so it is not passed on.
    return json({ error: "tts_failed" }, 502);
  }
}
