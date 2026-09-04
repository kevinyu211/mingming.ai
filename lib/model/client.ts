/**
 * SERVER ONLY. This module talks to the model and must never be imported into a client component
 * or bundled for the browser. The `server-only` package is not a dependency here, so the guard
 * below is the enforcement.
 *
 * The provider adapter (research.md R1) is the single place the model is called from. Three jobs
 * only, per constitution principle III: read the sheet, answer from cards, re-phrase one card.
 * Nothing here decides whether a card is shown.
 *
 * Every call goes through the Vercel AI Gateway (AI SDK 6, `ai`). A model is a plain
 * `"provider/model"` string — `google/gemini-3.8-flash`, `anthropic/claude-sonnet-5`,
 * `openai/gpt-5.6-terra` — read from `MODEL_READ` / `MODEL_ASK`, so switching models or vendors is
 * an environment change and nothing else. Authentication is the deployment's OIDC token on
 * Vercel (`VERCEL_OIDC_TOKEN` locally, from `vercel env pull`) or `AI_GATEWAY_API_KEY`; no
 * provider key is held here.
 *
 * - Structured output: `Output.object()` from the same Zod schema that validates the reply, so
 *   the provider is asked for JSON of that shape and the final text is still parsed and checked
 *   here. A schema failure becomes `ModelOutputError` with issue paths only.
 * - The system prompt is the first message, carrying Anthropic's cache breakpoint as a provider
 *   option; other providers ignore it. Images and the question follow in the user turn.
 * - `finishReason` is checked before the text is read.
 *
 * Logging discipline (constitution principle V, contracts/api-read.md § Server guarantees): no
 * error thrown from this module carries request or response bodies, image bytes, sheet text or
 * question text. Errors carry a code, an HTTP status, and Zod issue paths only.
 */
import {
  APICallError,
  NoObjectGeneratedError,
  Output,
  RetryError,
  generateText,
  streamText,
  type ModelMessage,
  type UserContent,
} from "ai";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
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

/** Default when `MODEL_READ` / `MODEL_ASK` are unset. A Gateway slug: `provider/model`. */
export const DEFAULT_MODEL = "google/gemini-3.8-flash";

/**
 * Generous: on models with thinking the cap covers reasoning plus the reply, and a truncated
 * reading is unusable JSON.
 */
export const MAX_TOKENS = 16000;

/**
 * Wall-clock budget per call, kept under each route's `maxDuration` (read 300 s, ask/phrase 60 s)
 * so a stalled provider surfaces as `model_unavailable` instead of a stream that just stops.
 */
export const READ_TIMEOUT_MS = 240_000;
export const ASK_TIMEOUT_MS = 50_000;

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
   * final text only.
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

/** The provider declined the request (`finishReason: "content-filter"`). Maps to 502. */
export class ModelRefusalError extends ModelError {
  /** A category when the provider supplied one; never the explanation text. */
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

/**
 * Collapses any SDK or transport error to a code. `RetryError` wraps the last attempt; an
 * `APICallError` carries the upstream status; anything else is treated as unreachable. Messages
 * from the SDK are dropped here because they can embed response text.
 */
export function toModelError(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  if (RetryError.isInstance(error)) return toModelError(error.lastError);
  describeFailure(error);
  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === "length") return new ModelOutputError("truncated");
    return new ModelOutputError("invalid_json");
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? null;
    if (status === null) return new ModelUnavailableError(null);
    if (status === 429 || status >= 500) return new ModelUnavailableError(status);
    return new ModelRequestError(status);
  }
  return new ModelUnavailableError(null);
}

/**
 * One log line naming the failure class and upstream status, so an outage can be told apart from
 * a rejected credential in the function logs. Never the message: SDK messages can embed response
 * text.
 */
function describeFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  const type =
    error && typeof error === "object" && "type" in error
      ? (error as { type?: unknown }).type
      : undefined;
  console.info({ model_failure: name, status: status ?? null, type: type ?? null });
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

type Route = "read" | "ask" | "phrase";

interface CallSpec<T> {
  route: Route;
  model: string;
  system: string;
  content: BetaContentBlockParam[];
  schema: z.ZodType<T>;
  timeoutMs: number;
}

/**
 * The prompt builders in `lib/model/prompts.ts` emit Anthropic-shaped blocks; the SDK wants its own
 * parts. Only text and base64 images exist in this app, so anything else is a programming error.
 */
export function toUserContent(blocks: readonly BetaContentBlockParam[]): UserContent {
  return blocks.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    if (block.type === "image" && block.source.type === "base64") {
      return {
        type: "image" as const,
        image: block.source.data,
        mediaType: block.source.media_type,
      };
    }
    throw new ModelRequestError(null);
  });
}

export interface GatewayProviderOptions {
  modelRead?: string;
  modelAsk?: string;
  /** Test seam: the SDK entry points. */
  generate?: typeof generateText;
  stream?: typeof streamText;
}

export class GatewayProvider implements ModelProvider {
  readonly modelRead: string;
  readonly modelAsk: string;
  private readonly generate: typeof generateText;
  private readonly stream: typeof streamText;

  constructor(options: GatewayProviderOptions = {}) {
    this.modelRead = options.modelRead ?? envModel("MODEL_READ");
    this.modelAsk = options.modelAsk ?? envModel("MODEL_ASK");
    this.generate = options.generate ?? generateText;
    this.stream = options.stream ?? streamText;
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
      route: "ask",
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
      schema: AskResultSchema,
      timeoutMs: ASK_TIMEOUT_MS,
    });
    return { result: value, usage };
  }

  async phrase(input: PhraseInput) {
    const { value, usage } = await this.send({
      route: "phrase",
      model: this.modelAsk,
      system: PHRASE_SYSTEM,
      content: buildPhraseUserContent(input),
      schema: PhraseResultSchema,
      timeoutMs: ASK_TIMEOUT_MS,
    });
    return { result: value, usage };
  }

  private readSpec(images: ImageInput[]): CallSpec<SheetReading> {
    return {
      route: "read",
      model: this.modelRead,
      system: READ_SYSTEM,
      content: buildReadUserContent(images),
      schema: SheetReadingSchema,
      timeoutMs: READ_TIMEOUT_MS,
    };
  }

  /** The request, identical for the streamed and unstreamed paths. */
  params<T>(spec: CallSpec<T>) {
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: spec.system,
        // Single frozen block, cached on Anthropic. Volatile bytes (images, question) follow.
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      { role: "user", content: toUserContent(spec.content) },
    ];
    return {
      model: spec.model,
      messages,
      // The system prompt is a message so it can carry the cache breakpoint; this is deliberate.
      allowSystemInMessages: true,
      output: Output.object({ schema: spec.schema }),
      maxOutputTokens: MAX_TOKENS,
      maxRetries: 2,
      timeout: { totalMs: spec.timeoutMs },
      providerOptions: { gateway: { tags: [`route:${spec.route}`] } },
    };
  }

  private async send<T>(spec: CallSpec<T>): Promise<{ value: T; usage: UsageSummary }> {
    const startedAt = Date.now();
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await this.generate(this.params(spec));
    } catch (error) {
      throw toModelError(error);
    }
    return finish(
      {
        text: result.text,
        finishReason: result.finishReason,
        usage: result.usage,
        modelId: result.response?.modelId,
      },
      spec,
      startedAt,
    );
  }

  private async sendStreaming<T>(
    spec: CallSpec<T>,
    onPartialText?: (delta: string) => void,
  ): Promise<{ value: T; usage: UsageSummary }> {
    const startedAt = Date.now();
    let failure: unknown = null;
    let text = "";
    let finishReason: Awaited<ReturnType<typeof generateText>>["finishReason"];
    let usage: Awaited<ReturnType<typeof generateText>>["usage"];
    let modelId: string | undefined;
    try {
      const result = this.stream({
        ...this.params(spec),
        // streamText reports transport errors here and ends the stream, rather than throwing.
        onError: ({ error }) => {
          failure = error;
        },
      });
      for await (const delta of result.textStream) {
        text += delta;
        onPartialText?.(delta);
      }
      finishReason = await result.finishReason;
      usage = await result.usage;
      modelId = (await result.response)?.modelId;
    } catch (error) {
      // The recorded transport error carries the upstream status; a rejection that follows it
      // would not.
      throw toModelError(failure ?? error);
    }
    if (failure !== null) throw toModelError(failure);
    return finish({ text, finishReason, usage, modelId }, spec, startedAt);
  }
}

interface Completed {
  text: string;
  finishReason: Awaited<ReturnType<typeof generateText>>["finishReason"];
  usage: Awaited<ReturnType<typeof generateText>>["usage"];
  modelId: string | undefined;
}

/** Check the finish reason, then read the text — never the other way round. */
function finish<T>(
  completed: Completed,
  spec: CallSpec<T>,
  startedAt: number,
): { value: T; usage: UsageSummary } {
  if (completed.finishReason === "content-filter") {
    throw new ModelRefusalError(null);
  }
  if (completed.finishReason === "length") {
    throw new ModelOutputError("truncated");
  }
  if (completed.finishReason === "error") {
    throw new ModelUnavailableError(null);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(completed.text);
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
    usage: summariseUsage(completed, spec.model, startedAt),
  };
}

function summariseUsage(completed: Completed, requestedModel: string, startedAt: number): UsageSummary {
  const usage = completed.usage;
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheCreationInputTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    // The id that actually served the turn, when the Gateway reports it.
    model: completed.modelId || requestedModel,
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

let cached: { key: string; provider: GatewayProvider } | null = null;

/**
 * The process-wide provider. Cached on the resolved model ids so a route never rebuilds it per
 * request.
 */
export function getModelProvider(): ModelProvider {
  const key = `${envModel("MODEL_READ")}|${envModel("MODEL_ASK")}`;
  if (!cached || cached.key !== key) {
    cached = { key, provider: new GatewayProvider() };
  }
  return cached.provider;
}
