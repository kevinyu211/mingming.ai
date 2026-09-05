/**
 * SERVER ONLY. The Anthropic path through the Vercel AI Gateway.
 *
 * The Gateway's generic (AI SDK) path asks a model for JSON of a shape but does not make the
 * provider enforce it, and it carries no effort setting. On photographed sheets that combination
 * failed every time on 4 September: Sonnet 5 thought at its default effort for two to three minutes
 * and then returned a reading with required fields missing (`unreadable[i].source`), which the
 * schema rightly rejected. The request the reading baselines were measured with — Anthropic's beta
 * `output_config.format` built from the same Zod schema, `effort: "medium"`, one cached system
 * block — read the same photos cleanly, so that request is what this module sends, to the Gateway's
 * Anthropic-compatible endpoint. The Gateway still does the routing, billing and rate limiting;
 * the model id is still a Gateway slug (`anthropic/claude-sonnet-5`).
 *
 * `getModelProvider` in ./client picks this provider for `anthropic/*` slugs when
 * AI_GATEWAY_API_KEY is set, and the AI SDK provider for everything else.
 *
 * Same logging discipline as ./client: errors carry a code, a status and Zod issue paths only.
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
  ASK_TIMEOUT_MS,
  MAX_TOKENS,
  ModelError,
  ModelOutputError,
  ModelRefusalError,
  ModelRequestError,
  ModelUnavailableError,
  READ_TIMEOUT_MS,
  type AnswerInput,
  type ModelProvider,
  type UsageSummary,
} from "@/lib/model/client";
import {
  ASK_SYSTEM,
  PHRASE_SYSTEM,
  READ_SYSTEM,
  buildAskUserContent,
  buildPhraseUserContent,
  buildReadUserContent,
  type ImageInput,
  type PhraseInput,
} from "@/lib/model/prompts";
import {
  AskResultSchema,
  PhraseResultSchema,
  SheetReadingSchema,
  type SheetReading,
} from "@/lib/model/schemas";

if (typeof window !== "undefined") {
  throw new Error("lib/model/anthropic-compat is server-only and must not be bundled for the browser");
}

/** The Gateway's Anthropic-compatible endpoint; the SDK appends `/v1/messages`. */
export const GATEWAY_ANTHROPIC_BASE_URL = "https://ai-gateway.vercel.sh";

type Effort = NonNullable<NonNullable<MessageCreateParamsNonStreaming["output_config"]>["effort"]>;

/**
 * Effort per route, as measured for the baselines (tests/eval/results.md, 2026-09-03): `medium`
 * reads identically to `high` and cuts roughly a third off the wait. Overridable for the eval.
 */
export const READ_EFFORT: Effort = (process.env.READ_EFFORT as Effort) || "medium";
export const ASK_EFFORT: Effort = "medium";
export const PHRASE_EFFORT: Effort = "medium";

/** Built once so the schema bytes are identical on every request. */
export const READ_OUTPUT_FORMAT = betaZodOutputFormat(SheetReadingSchema);
export const ASK_OUTPUT_FORMAT = betaZodOutputFormat(AskResultSchema);
export const PHRASE_OUTPUT_FORMAT = betaZodOutputFormat(PhraseResultSchema);

/** True when `model` should take this path. */
export function isAnthropicSlug(model: string): boolean {
  return model.startsWith("anthropic/");
}

interface CallSpec<T> {
  model: string;
  system: string;
  content: BetaContentBlockParam[];
  effort: Effort;
  format: BetaJSONOutputFormat;
  schema: z.ZodType<T>;
  timeoutMs: number;
}

export interface AnthropicCompatProviderOptions {
  /** Test seam. Defaults to an SDK client pointed at the Gateway with the Gateway key. */
  client?: Anthropic;
  modelRead: string;
  modelAsk: string;
}

export class AnthropicCompatProvider implements ModelProvider {
  private readonly client: Anthropic;
  readonly modelRead: string;
  readonly modelAsk: string;

  constructor(options: AnthropicCompatProviderOptions) {
    this.client =
      options.client ??
      new Anthropic({
        baseURL: GATEWAY_ANTHROPIC_BASE_URL,
        // The Gateway key travels as a bearer token; `apiKey: null` keeps the SDK from also sending
        // ANTHROPIC_API_KEY from the environment.
        authToken: process.env.AI_GATEWAY_API_KEY,
        apiKey: null,
        maxRetries: 2,
      });
    this.modelRead = options.modelRead;
    this.modelAsk = options.modelAsk;
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
      timeoutMs: ASK_TIMEOUT_MS,
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
      timeoutMs: ASK_TIMEOUT_MS,
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
      timeoutMs: READ_TIMEOUT_MS,
    };
  }

  /** The exact pre-Gateway request minus the Opus-only refusal fallback. */
  params<T>(spec: CallSpec<T>) {
    return {
      model: spec.model,
      max_tokens: MAX_TOKENS,
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

  private async send<T>(spec: CallSpec<T>): Promise<{ value: T; usage: UsageSummary }> {
    const startedAt = Date.now();
    let message: BetaMessage;
    try {
      message = await this.client.beta.messages.create(this.params(spec), {
        timeout: spec.timeoutMs,
      });
    } catch (error) {
      throw toAnthropicModelError(error);
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
      const stream = this.client.beta.messages.stream(this.params(spec), {
        timeout: spec.timeoutMs,
      });
      if (onPartialText) stream.on("text", (delta: string) => onPartialText(delta));
      message = await stream.finalMessage();
    } catch (error) {
      throw toAnthropicModelError(error);
    }
    return finish(message, spec, startedAt);
  }
}

/** Anthropic SDK errors to codes. Messages are dropped: they can embed response text. */
export function toAnthropicModelError(error: unknown): ModelError {
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
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    );
  }

  const usage = message.usage;
  const summary: UsageSummary = {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    model: message.model ?? spec.model,
    ms: Date.now() - startedAt,
  };
  console.info({ model_call: "anthropic-compat", ms: summary.ms, model: summary.model, out: summary.outputTokens, cache_read: summary.cacheReadInputTokens });
  return { value: parsed.data, usage: summary };
}
