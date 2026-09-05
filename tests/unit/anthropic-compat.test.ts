/**
 * The Anthropic path through the Gateway sends the pre-Gateway request shape — strict
 * `output_config.format` from the Zod schema and `effort: "medium"` — because the generic path
 * returned readings with required fields missing on photographed sheets (4 September).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicCompatProvider,
  GATEWAY_ANTHROPIC_BASE_URL,
  READ_EFFORT,
  isAnthropicSlug,
} from "@/lib/model/anthropic-compat";
import { GatewayProvider, ModelOutputError, ModelUnavailableError, getModelProvider } from "@/lib/model/client";
import { RateLimitError } from "@anthropic-ai/sdk";

const IMAGES = [{ mediaType: "image/jpeg" as const, base64: "aGk=" }];

function fakeClient(message: unknown, reject?: unknown) {
  const create = vi.fn(async () => {
    if (reject) throw reject;
    return message;
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const READING = {
  sheetType: "hk_en",
  warningSigns: [],
  medicines: [],
  followUp: [],
  dietLine: null,
  activityLine: null,
  hospitalContact: null,
  unreadable: [],
};

function message(text: string, extra: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    model: "anthropic/claude-sonnet-5",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 },
    ...extra,
  };
}

describe("the request", () => {
  it("is the pre-Gateway shape: strict format, medium effort, cached system block, images first", async () => {
    const { client, create } = fakeClient(message(JSON.stringify(READING)));
    const provider = new AnthropicCompatProvider({ client, modelRead: "anthropic/claude-sonnet-5", modelAsk: "anthropic/claude-sonnet-5" });
    await provider.readSheet(IMAGES);
    const [params, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, { timeout: number; maxRetries: number }];
    expect(params.model).toBe("anthropic/claude-sonnet-5");
    const output = params.output_config as { effort: string; format: { type: string } };
    expect(output.effort).toBe(READ_EFFORT);
    expect(READ_EFFORT).toBe("medium");
    expect(output.format.type).toBe("json_schema");
    const system = params.system as { cache_control: { type: string } }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    const content = (params.messages as { content: { type: string }[] }[])[0].content;
    expect(content[0].type).toBe("image");
    expect(content[content.length - 1].type).toBe("text");
    expect(options.timeout).toBe(280_000);
    expect(options.maxRetries).toBe(0);
    expect(params.max_tokens).toBe(64_000);
    expect(GATEWAY_ANTHROPIC_BASE_URL).toBe("https://ai-gateway.vercel.sh");
  });

  it("rejects a reading that fails the schema with issue paths only", async () => {
    const { client } = fakeClient(message(JSON.stringify({ ...READING, unreadable: [{ section: "x" }] })));
    const provider = new AnthropicCompatProvider({ client, modelRead: "anthropic/claude-sonnet-5", modelAsk: "anthropic/claude-sonnet-5" });
    await expect(provider.readSheet(IMAGES)).rejects.toMatchObject({
      code: "invalid_output:schema",
      issues: expect.arrayContaining([expect.objectContaining({ path: "unreadable.0.source" })]),
    });
  });

  it("maps a 429 to model_unavailable", async () => {
    const { client } = fakeClient(null, new RateLimitError(429, { type: "error" }, "slow down", new Headers()));
    const provider = new AnthropicCompatProvider({ client, modelRead: "anthropic/claude-sonnet-5", modelAsk: "anthropic/claude-sonnet-5" });
    await expect(provider.readSheet(IMAGES)).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("surfaces the usage from the message", async () => {
    const { client } = fakeClient(message(JSON.stringify(READING)));
    const provider = new AnthropicCompatProvider({ client, modelRead: "anthropic/claude-sonnet-5", modelAsk: "anthropic/claude-sonnet-5" });
    const { usage } = await provider.readSheet(IMAGES);
    expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 7, model: "anthropic/claude-sonnet-5" });
    expect(ModelOutputError).toBeDefined();
  });
});

describe("getModelProvider picks the path by slug and key", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.MODEL_READ = "anthropic/claude-sonnet-5";
    process.env.MODEL_ASK = "anthropic/claude-sonnet-5";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("uses the Anthropic-compatible path for anthropic/* when a Gateway key is set", () => {
    process.env.AI_GATEWAY_API_KEY = "vck_test";
    expect(getModelProvider()).toBeInstanceOf(AnthropicCompatProvider);
  });

  it("falls back to the AI SDK path without a key", () => {
    delete process.env.AI_GATEWAY_API_KEY;
    expect(getModelProvider()).toBeInstanceOf(GatewayProvider);
  });

  it("uses the AI SDK path for other vendors even with a key", () => {
    process.env.AI_GATEWAY_API_KEY = "vck_test";
    process.env.MODEL_READ = "google/gemini-3.8-flash";
    process.env.MODEL_ASK = "google/gemini-3.8-flash";
    expect(getModelProvider()).toBeInstanceOf(GatewayProvider);
    expect(isAnthropicSlug("google/gemini-3.8-flash")).toBe(false);
  });
});
