/**
 * SERVER ONLY. This module holds the Anthropic API key and must never be imported into a client
 * component or bundled for the browser. The `server-only` package is not a dependency here, so the
 * guard below is the enforcement.
 *
 * The provider adapter (research.md R1) is the single place the model is called from. Three jobs
 * only, per constitution principle III: read the sheet, answer from cards, re-phrase one card.
 * Nothing here decides whether a card is shown.
 *
 * SDK usage follows the bundled claude-api skill:
 * - `client.beta.messages.create` — the beta path is required because `fallbacks` lives there
 *   (model-migration.md § Migrating to Claude Opus 5 → New API features).
 * - `output_config.format` built by `betaZodOutputFormat()` from the same Zod schema that validates
 *   the reply (typescript README § Structured Outputs; research.md R3). The helper normalises the
 *   schema for the structured-outputs endpoint (`lib/transform-json-schema`), which a hand-derived
 *   draft-2020-12 document does not, so it is the safer wire format. The README documents passing
 *   the format object to `.create()` and parsing the reply yourself, which is what happens below —
 *   `.parse()` would swallow a schema failure into an untyped SDK error whose message can embed
 *   response text, and this module must throw codes only. `sheetReadingJsonSchema()` and friends
 *   stay the published contract; the test asserts the two describe the same shape.
 * - `output_config.effort` set per route; `thinking` omitted so adaptive thinking stays on, which is
 *   the Claude Opus 5 default (README § Extended Thinking).
 * - One system text block carrying `cache_control: {type: "ephemeral"}`; images and question come
 *   after it in the user turn (shared/prompt-caching.md § Placement patterns).
 * - `stop_reason` is checked before `content` is read (model-migration.md, Opus 5 checklist).
 *
 * Logging discipline (constitution principle V, contracts/api-read.md § Server guarantees): no
 * error thrown from this module carries request or response bodies, image bytes, sheet text or
 * question text. Errors carry a code, an HTTP status, and Zod issue paths only.
 */
import Anthropic, {
  APIConnectionError,
  APIError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaContentBlockParam,
  BetaJSONOutputFormat,
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";

import {
  ASK_SYSTEM,
  PHRASE_SYSTEM,
  READ_SYSTEM,
  buildAskUserContent,
  buildPhraseUserContent,
  buildReadUserContent,
  type ImageInput,
  type PhraseDialect,
  type PhraseInput,
} from "@/lib/model/prompts";
import {
  AskResultSchema,
  PhraseResultSchema,
  SheetReadingSchema,
  type AskResult,
  type Card,
  type Dialect,
  type InputLanguage,
  type PhraseResult,
  type SheetReading,
} from "@/lib/model/schemas";

if (typeof window !== "undefined") {
  throw new Error("lib/model/client is server-only and must not be bundled for the browser");
}

export type { ImageInput, PhraseDialect, PhraseInput };

/** Default when `MODEL_READ` / `MODEL_ASK` are unset. */
export const DEFAULT_MODEL = "claude-opus-5";

/** Gates the scalar `fallbacks: "default"` form (model-migration.md § New API features). */
export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Models observed to reject the refusal-fallback parameter with a 400. Learned at runtime by
 * `AnthropicProvider.attempt` rather than hardcoded, so a model that gains support later needs no
 * code change. Process-lifetime only: a restart re-probes once per model.
 */
const NO_FALLBACK_MODELS = new Set<string>();

/**
 * Generous, per the skill's guidance: on Claude Opus 5 `max_tokens` caps adaptive thinking plus the
 * response text together, and a truncated reading is unusable JSON.
 */
export const MAX_TOKENS = 16000;

type Effort = NonNullable<NonNullable<MessageCreateParamsNonStreaming["output_config"]>["effort"]>;

/**
 * Effort per route. Overridable so the reading eval can sweep it without a code change.
 *
 * `medium` for the read, measured rather than assumed (tests/eval/results.md, 2026-09-03, Opus 5
 * over the three fixtures, two runs each):
 *
 *   high    29.6–34.4 s, misses SC-001's 30 s
 *   medium  20.2–25.7 s, and identical on everything scored — medicines verbatim, no invented or
 *           missing items, warning coverage 100%, unreadable regions caught, zero banned terms
 *
 * The one thing `high` did unaided was split a printed line that carries both a food and an
 * activity instruction; `medium` needed that spelled out in READ_SYSTEM, which it now is. So the
 * trade is a more explicit prompt for roughly a third off the wait — the right way round, since
 * the wait is what the family feels.
 */
export const READ_EFFORT: Effort = (process.env.READ_EFFORT as Effort) || "medium";
export const ASK_EFFORT: Effort = "medium";
export const PHRASE_EFFORT: Effort = "medium";

/**
 * Built once at module load so the schema bytes are identical on every request (a schema that was
 * re-derived per call would still be deterministic, but this keeps the cost off the hot path).
 */
export const READ_OUTPUT_FORMAT = betaZodOutputFormat(SheetReadingSchema);
export const ASK_OUTPUT_FORMAT = betaZodOutputFormat(AskResultSchema);
export const PHRASE_OUTPUT_FORMAT = betaZodOutputFormat(PhraseResultSchema);

/** Recorded for the eval log; never contains any request or response text. */
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  model: string;
  ms: number;
}

export interface AnswerInput {
  cards: Card[];
  question: string;
  inputLanguage: InputLanguage;
  dialect: Dialect;
  /**
   * The on-device memory brief (`lib/memory/context.ts`), when the phone has one. Background for
   * the ask call only: it is never passed to `readSheet` or `phrase`, it is capped and carries no
   * label, name or identifier, and the grounding check in `lib/server/ask-pipeline.ts` still
   * accepts only a card id built from the current reading.
   */
  memory?: string;
  /**
   * The last few turns of this conversation, for resolving what a follow-up refers back to
   * ("是唔是仲有？" means nothing without the turn before it). Same discipline as `memory`: the ask
   * call only, and never a source of facts — grounding still accepts only ids from this reading.
   */
  context?: readonly { role: "user" | "agent"; text: string }[];
}

export interface ModelProvider {
  readSheet(images: ImageInput[]): Promise<{ reading: SheetReading; usage: UsageSummary }>;
  /**
   * Same call, streamed, so the read route can start speaking before the whole reading lands.
   * `onPartialText` receives raw text deltas of the JSON body; full validation happens on the
   * final message only.
   */
  readSheetStream(
    images: ImageInput[],
    onPartialText?: (delta: string) => void,
  ): Promise<{ reading: SheetReading; usage: UsageSummary }>;
  answer(input: AnswerInput): Promise<{ result: AskResult; usage: UsageSummary }>;
  phrase(input: PhraseInput): Promise<{ result: PhraseResult; usage: UsageSummary }>;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class ModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** `stop_reason: "refusal"` — the whole fallback chain declined. Maps to 502 for the client. */
export class ModelRefusalError extends ModelError {
  /** `stop_details.category` when the API supplied one; never the explanation text. */
  readonly category: string | null;
  constructor(category: string | null = null) {
    super("refusal", "the model declined this request");
    this.category = category;
  }
}

/** Connection failure, 429, or 5xx after the SDK's own retries. Maps to 502. */
export class ModelUnavailableError extends ModelError {
  readonly status: number | null;
  constructor(status: number | null = null) {
    super("model_unavailable", "the model could not be reached");
    this.status = status;
  }
}

/** A non-retryable 4xx: a bug in how the request was built, not a transient failure. */
export class ModelRequestError extends ModelError {
  readonly status: number | null;
  constructor(status: number | null = null) {
    super("bad_request", "the model rejected the request");
    this.status = status;
  }
}

/** One Zod problem, reduced to what is safe to log: where it was and what kind it was. */
export interface ModelOutputIssue {
  path: string;
  code: string;
}

/** The reply was not valid JSON, was truncated, or failed the schema. Maps to 422. */
export class ModelOutputError extends ModelError {
  readonly issues: ModelOutputIssue[];
  constructor(reason: "invalid_json" | "truncated" | "schema", issues: ModelOutputIssue[] = []) {
    super(`invalid_output:${reason}`, `the model output was not usable (${reason})`);
    this.issues = issues;
  }
}

function toModelError(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof APIConnectionError) return new ModelUnavailableError(null);
  if (error instanceof RateLimitError) return new ModelUnavailableError(error.status ?? 429);
  if (error instanceof InternalServerError) return new ModelUnavailableError(error.status ?? 500);
  if (error instanceof APIError) {
    const status = error.status ?? null;
    return status !== null && status >= 500
      ? new ModelUnavailableError(status)
      : new ModelRequestError(status);
  }
  return new ModelUnavailableError(null);
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

interface CallSpec<T> {
  model: string;
  system: string;
  content: BetaContentBlockParam[];
  effort: Effort;
  format: BetaJSONOutputFormat;
  schema: z.ZodType<T>;
}

export interface AnthropicProviderOptions {
  client?: Anthropic;
  modelRead?: string;
  modelAsk?: string;
}

export class AnthropicProvider implements ModelProvider {
  private readonly client: Anthropic;
  readonly modelRead: string;
  readonly modelAsk: string;

  constructor(options: AnthropicProviderOptions = {}) {
    // No apiKey argument: the SDK resolves ANTHROPIC_API_KEY from the environment.
    this.client = options.client ?? new Anthropic();
    this.modelRead = options.modelRead ?? envModel("MODEL_READ");
    this.modelAsk = options.modelAsk ?? envModel("MODEL_ASK");
  }

  async readSheet(images: ImageInput[]) {
    const { value, usage } = await this.send(this.readSpec(images));
    return { reading: value, usage };
  }

  async readSheetStream(images: ImageInput[], onPartialText?: (delta: string) => void) {
    const { value, usage } = await this.sendStreaming(this.readSpec(images), onPartialText);
    return { reading: value, usage };
  }

  async answer(input: AnswerInput) {
    const { value, usage } = await this.send({
      model: this.modelAsk,
      system: ASK_SYSTEM,
      content: buildAskUserContent(
        input.cards,
        input.question,
        input.inputLanguage,
        input.dialect,
        input.memory,
        input.context,
      ),
      effort: ASK_EFFORT,
      format: ASK_OUTPUT_FORMAT,
      schema: AskResultSchema,
    });
    return { result: value, usage };
  }

  async phrase(input: PhraseInput) {
    const { value, usage } = await this.send({
      model: this.modelAsk,
      system: PHRASE_SYSTEM,
      content: buildPhraseUserContent(input),
      effort: PHRASE_EFFORT,
      format: PHRASE_OUTPUT_FORMAT,
      schema: PhraseResultSchema,
    });
    return { result: value, usage };
  }

  private readSpec(images: ImageInput[]): CallSpec<SheetReading> {
    return {
      model: this.modelRead,
      system: READ_SYSTEM,
      content: buildReadUserContent(images),
      effort: READ_EFFORT,
      format: READ_OUTPUT_FORMAT,
      schema: SheetReadingSchema,
    };
  }

  private params<T>(spec: CallSpec<T>, withFallbacks: boolean) {
    return {
      model: spec.model,
      max_tokens: MAX_TOKENS,
      // Server-side refusal fallback: on a policy decline the API re-runs the request on
      // Anthropic's recommended substitute inside the same call, rather than returning a refusal.
      // Not every model accepts it, so it is dropped and remembered on a 400 — see `attempt`.
      ...(withFallbacks
        ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: "default" as const }
        : {}),
      // Single frozen block, cached. Volatile bytes (images, question) follow in `messages`.
      system: [
        {
          type: "text" as const,
          text: spec.system,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: spec.content }],
      output_config: { effort: spec.effort, format: spec.format },
    };
  }

  /**
   * Runs one call, dropping the refusal-fallback parameter if this model will not take it.
   *
   * `fallbacks` is documented for the Opus and Fable tiers; a model that does not support it
   * rejects the whole request with a 400, which would otherwise make every other model
   * unusable — and the point of `MODEL_READ` is that the model IS swappable (research.md R1).
   * Rather than hardcode a list of model ids that will rot, the first 400 for a given model
   * demotes it to the plain shape and the answer is remembered for the life of the process.
   */
  private async attempt<T>(
    spec: CallSpec<T>,
    run: (params: ReturnType<AnthropicProvider["params"]>) => Promise<BetaMessage>,
  ): Promise<BetaMessage> {
    const supported = !NO_FALLBACK_MODELS.has(spec.model);
    try {
      return await run(this.params(spec, supported));
    } catch (error) {
      const status = error instanceof APIError ? error.status : undefined;
      if (!supported || status !== 400) throw toModelError(error);
      NO_FALLBACK_MODELS.add(spec.model);
      return await run(this.params(spec, false));
    }
  }

  private async send<T>(spec: CallSpec<T>): Promise<{ value: T; usage: UsageSummary }> {
    const startedAt = Date.now();
    let message: BetaMessage;
    try {
      message = await this.attempt(spec, (params) => this.client.beta.messages.create(params));
    } catch (error) {
      throw toModelError(error);
    }
    return finish(message, spec, startedAt);
  }

  private async sendStreaming<T>(
    spec: CallSpec<T>,
    onPartialText?: (delta: string) => void,
  ): Promise<{ value: T; usage: UsageSummary }> {
    const startedAt = Date.now();
    let message: BetaMessage;
    try {
      message = await this.attempt(spec, async (params) => {
        const stream = this.client.beta.messages.stream(params);
        if (onPartialText) stream.on("text", (delta: string) => onPartialText(delta));
        return await stream.finalMessage();
      });
    } catch (error) {
      throw toModelError(error);
    }
    return finish(message, spec, startedAt);
  }
}

/** Check `stop_reason`, then read `content` — never the other way round. */
function finish<T>(
  message: BetaMessage,
  spec: CallSpec<T>,
  startedAt: number,
): { value: T; usage: UsageSummary } {
  if (message.stop_reason === "refusal") {
    throw new ModelRefusalError(message.stop_details?.category ?? null);
  }
  if (message.stop_reason === "max_tokens") {
    throw new ModelOutputError("truncated");
  }

  const text = (message.content ?? [])
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ModelOutputError("invalid_json");
  }

  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    throw new ModelOutputError(
      "schema",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    );
  }

  return {
    value: parsed.data,
    usage: summariseUsage(message, spec.model, startedAt),
  };
}

function summariseUsage(message: BetaMessage, requestedModel: string, startedAt: number): UsageSummary {
  const usage = message.usage;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    // `message.model` is what actually served the turn, which differs from the requested id
    // whenever the server-side fallback ran.
    model: message.model ?? requestedModel,
    ms: Date.now() - startedAt,
  };
}

function envModel(name: "MODEL_READ" | "MODEL_ASK"): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : DEFAULT_MODEL;
}

/* -------------------------------------------------------------------------- */
/* Singleton                                                                  */
/* -------------------------------------------------------------------------- */

let cached: { key: string; provider: AnthropicProvider } | null = null;

/**
 * The process-wide provider. Cached on the resolved model ids so a route never rebuilds the client
 * per request (and so the prompt cache stays on one model per route).
 */
export function getModelProvider(): ModelProvider {
  const key = `${envModel("MODEL_READ")} ${envModel("MODEL_ASK")}`;
  if (!cached || cached.key !== key) {
    cached = { key, provider: new AnthropicProvider() };
  }
  return cached.provider;
}
