/**
 * `GET|POST /api/warm` — keeps the answering path warm.
 *
 * The first question after the app has sat idle was measured at 75–80 s on the deployed build,
 * against under 10 s for every one after it (docs/demo-script.md). Whatever the exact cause — a
 * cold function instance, a cold connection to the Gateway, an expired prompt cache — the cure
 * is the same: make the same kind of call, on the same code path, before the reader does.
 *
 * Two callers: a Vercel cron (`vercel.json`) every few minutes, and the phone itself the moment
 * the app opens (`components/Warmer.tsx`). The call is a real `answer` with one fixed card and a
 * fixed greeting, so it exercises the model, the Gateway route and the cached system prompt —
 * nothing from any reader is involved (constitution V). It is rate-limited per instance so a
 * burst of callers cannot become a burst of model calls.
 */
import type { Card } from "@/lib/domain/schemas";
import { ModelError, getModelProvider } from "@/lib/model/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Two warm calls closer together than this are one call. */
const MIN_GAP_MS = 90_000;

/** A card that says nothing about anyone: the fixed no-warnings line. */
const STUB_CARD: Card = {
  id: "no-warnings",
  type: "noWarnings",
  body: {
    yue: "張紙冇寫危險訊號。",
    cmn: "纸上没有写危险讯号。",
    en: "The sheet lists no warning signs.",
  },
  source: null,
  aiGenerated: false,
};

let lastWarmAt = 0;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function warm(): Promise<Response> {
  const now = Date.now();
  if (now - lastWarmAt < MIN_GAP_MS) return json({ warmed: false, reason: "recent" });
  lastWarmAt = now;

  try {
    const { usage } = await getModelProvider().answer({
      cards: [STUB_CARD],
      question: "你好",
      inputLanguage: "yue",
      dialect: "yue",
    });
    console.info({ route: "warm", ms: usage.ms, cache_read: usage.cacheReadInputTokens });
    return json({ warmed: true, ms: usage.ms });
  } catch (error) {
    // Let the next caller try again straight away.
    lastWarmAt = 0;
    const code = error instanceof ModelError ? error.code : "unknown";
    console.info({ route: "warm", ms: Date.now() - now, code });
    return json({ warmed: false, reason: code }, 502);
  }
}

export async function GET(): Promise<Response> {
  return warm();
}

export async function POST(): Promise<Response> {
  return warm();
}
