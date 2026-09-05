/**
 * `POST /api/phrase` — contracts/api-phrase.md.
 *
 * Rewrites the spoken text of ONE card and nothing else. Used by `/api/read` internally through
 * `lib/server/reading-pipeline.ts`, and exposed so the client can offer "say it differently".
 * The facts are never changed: the model may only restate what it is handed, and whatever comes
 * back goes through the same deterministic banned-term filter as everything else (principle VI).
 * Two strikes and the answer is a fixed template.
 *
 * Privacy guard (principle V): `facts` are card facts, so a request carrying an `image`, `base64`,
 * `label` or `profile` key is refused rather than quietly forwarded to the model. A medicine's
 * `name` key is a fact off the page and is allowed — the profile's relationship label is not.
 */
import { z } from "zod";

import { CardTypeSchema, SourceReferenceSchema, type Speakable } from "@/lib/domain/schemas";
import { getModelProvider } from "@/lib/model/client";
import { checkSpeakableAgainstQuotes } from "@/lib/rules/banned-terms";
import { jsonError } from "@/lib/server/ndjson";
import { NO_SOURCE, safeTemplate } from "@/lib/server/reading-pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One card's worth of facts and one source line; orders of magnitude below this in practice. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Keys that would mean the caller is sending something other than card facts. Compared
 * case-insensitively against the trimmed key.
 */
const FORBIDDEN_FACT_KEYS: readonly string[] = ["image", "images", "base64", "label", "profile"];

const PhraseRequestSchema = z.strictObject({
  cardType: CardTypeSchema,
  facts: z.record(z.string(), z.union([z.string(), z.null()])),
  /** Absent for the two rule-generated card types, which quote nothing off the page. */
  source: SourceReferenceSchema.optional(),
  /** The terms the previous wording tripped over, so the prompt can name them. */
  avoid: z.array(z.string()).max(64).optional(),
  /** Which reading to lead with; "both" leaves the model to balance all three. */
  dialect: z.enum(["yue", "cmn", "en", "both"]).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  let logged = false;
  const log = (status: number, filtered: boolean | null): void => {
    if (logged) return;
    logged = true;
    console.info({ route: "phrase", status, ms: Date.now() - startedAt, filtered });
  };
  const fail = (status: number, body: { error: string; detail?: string }): Response => {
    log(status, null);
    return jsonError(status, body);
  };

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, { error: "too_large" });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail(400, { error: "bad_request", detail: "unreadable_body" });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return fail(413, { error: "too_large" });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, { error: "bad_request", detail: "invalid_json" });
  }

  const parsed = PhraseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, { error: "bad_request", detail: detailFor(parsed.error) });
  }

  const { cardType, facts } = parsed.data;
  if (hasForbiddenFactKey(facts)) {
    return fail(400, { error: "bad_request", detail: "forbidden_fact_key" });
  }

  let spoken: Speakable;
  try {
    const { result } = await getModelProvider().phrase({
      cardType,
      facts,
      source: parsed.data.source ?? NO_SOURCE,
      avoid: parsed.data.avoid ?? [],
      dialect: parsed.data.dialect ?? "both",
    });
    spoken = result.spoken;
  } catch {
    // Every model failure maps to one code: the client's recovery is the same either way — keep
    // the text it already has, or render the local template from lib/rules.
    return fail(502, { error: "model_unavailable" });
  }

  // Second strike: the fixed template, built only from the facts (contracts/api-phrase.md).
  // A number the source line itself prints is allowed through (lib/rules/banned-terms.ts).
  const quote = parsed.data.source?.quote ?? null;
  const filtered = !checkSpeakableAgainstQuotes(spoken, [quote]).ok;
  const answer = filtered ? safeTemplate(cardType, facts, quote) : spoken;

  log(200, filtered);
  return new Response(JSON.stringify({ spoken: answer, filtered }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function hasForbiddenFactKey(facts: Record<string, string | null>): boolean {
  return Object.keys(facts).some((key) =>
    FORBIDDEN_FACT_KEYS.includes(key.trim().toLowerCase()),
  );
}

/** Issue code plus field path, from this file's own schema. Never the submitted value. */
function detailFor(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "invalid";
  const path = issue.path.map((segment) => String(segment)).join(".");
  const detail = path.length > 0 ? `${issue.code}:${path}` : issue.code;
  return detail.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 48);
}
