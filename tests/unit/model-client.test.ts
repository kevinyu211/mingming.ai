/**
 * Unit tests for the model provider adapter. The Anthropic SDK is mocked, so nothing here reaches
 * the network and no API key is needed: `messages.create` / `messages.stream` return canned
 * responses and the tests assert on the request that was built and on how each response is handled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASK_SYSTEM,
  BANNED_WORDS_LINE_PREFIX,
  PHRASE_SYSTEM,
  READ_SYSTEM,
} from "@/lib/model/prompts";
import {
  askResultJsonSchema,
  phraseResultJsonSchema,
  sheetReadingJsonSchema,
  type Card,
  type SheetReading,
} from "@/lib/model/schemas";

const { createMock, streamMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  streamMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class MockAnthropic {
    beta = { messages: { create: createMock, stream: streamMock } };
  }
  // Keep the real error classes so `instanceof` narrowing in client.ts is exercised for real.
  return { ...actual, default: MockAnthropic };
});

const {
  ASK_OUTPUT_FORMAT,
  AnthropicProvider,
  MAX_TOKENS,
  ModelOutputError,
  ModelRefusalError,
  ModelRequestError,
  ModelUnavailableError,
  PHRASE_OUTPUT_FORMAT,
  READ_EFFORT,
  READ_OUTPUT_FORMAT,
  REFUSAL_FALLBACK_BETA,
  getModelProvider,
} = await import("@/lib/model/client");
const { APIConnectionError, BadRequestError, InternalServerError, RateLimitError } = await import(
  "@anthropic-ai/sdk"
);

/* -------------------------------------------------------------------------- */
/* Canned data                                                                */
/* -------------------------------------------------------------------------- */

const SPEAKABLE = {
  yue: "呢隻藥叫 Amlodipine，5mg，每次一粒，每日一次。",
  cmn: "这个药叫 Amlodipine，5mg，每次一片，每天一次。",
  en: "This one is Amlodipine, 5mg. One tablet, once a day.",
};

const SOURCE = {
  section: "Discharge Medication(s) & Follow-up Plan",
  lineIndex: 0,
  quote: "Amlodipine 5mg 1 tab daily",
};

const READING: SheetReading = {
  sheetType: "hk_en",
  warningSigns: [{ symptom: SPEAKABLE, action: SPEAKABLE, source: SOURCE }],
  medicines: [
    {
      name: "Amlodipine",
      strength: "5mg",
      amount: "1 tab",
      frequency: "daily",
      duration: null,
      status: "current",
      spoken: SPEAKABLE,
      source: SOURCE,
    },
  ],
  followUp: [],
  dietLine: null,
  activityLine: null,
  hospitalContact: null,
  unreadable: [],
};

const IMAGES = [
  { mediaType: "image/jpeg" as const, base64: "AAAAJPEGBYTES" },
  { mediaType: "image/png" as const, base64: "AAAAPNGBYTES" },
];

const CARDS: Card[] = [
  {
    id: "medicine-1",
    type: "medicine",
    body: SPEAKABLE,
    source: SOURCE,
    aiGenerated: true,
    // Present on the card but must not be forwarded to the model.
    facts: { name: "Amlodipine", strength: "5mg" },
  },
];

const USAGE = {
  input_tokens: 412,
  output_tokens: 1180,
  cache_read_input_tokens: 2048,
  cache_creation_input_tokens: 96,
};

interface CannedMessage {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason: string;
  stop_sequence: null;
  stop_details?: { category: string; explanation: string };
  usage: typeof USAGE;
}

function canned(overrides: Partial<CannedMessage> = {}): CannedMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: JSON.stringify(READING) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { ...USAGE },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Request inspection helpers                                                 */
/* -------------------------------------------------------------------------- */

interface ContentBlock {
  type: string;
  text?: string;
  source?: { type: string; media_type: string; data: string };
}

interface RecordedRequest {
  model: string;
  max_tokens: number;
  betas: string[];
  fallbacks: unknown;
  system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
  messages: Array<{ role: string; content: ContentBlock[] }>;
  output_config: {
    effort: string;
    format: { type: string; schema: Record<string, unknown> };
  };
}

function lastRequest(mock: typeof createMock): RecordedRequest {
  const { calls } = mock.mock;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as RecordedRequest;
}

function fakeStream(message: CannedMessage, deltas: string[] = []) {
  const handlers = new Map<string, Array<(value: string) => void>>();
  return {
    on(event: string, cb: (value: string) => void) {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
      return this;
    },
    async finalMessage() {
      for (const cb of handlers.get("text") ?? []) {
        for (const delta of deltas) cb(delta);
      }
      return message;
    },
  };
}

beforeEach(() => {
  createMock.mockReset();
  streamMock.mockReset();
  delete process.env.MODEL_READ;
  delete process.env.MODEL_ASK;
});

afterEach(() => {
  delete process.env.MODEL_READ;
  delete process.env.MODEL_ASK;
});

/* -------------------------------------------------------------------------- */

describe("AnthropicProvider.readSheet request", () => {
  it("uses MODEL_READ from the environment, defaulting to claude-opus-5", async () => {
    createMock.mockResolvedValue(canned());

    await new AnthropicProvider().readSheet(IMAGES);
    expect(lastRequest(createMock).model).toBe("claude-opus-5");

    process.env.MODEL_READ = "claude-sonnet-5";
    await new AnthropicProvider().readSheet(IMAGES);
    expect(lastRequest(createMock).model).toBe("claude-sonnet-5");
  });

  it("sends one frozen system block carrying the cache breakpoint", async () => {
    createMock.mockResolvedValue(canned());
    await new AnthropicProvider().readSheet(IMAGES);

    const { system } = lastRequest(createMock);
    expect(system).toHaveLength(1);
    expect(system[0].type).toBe("text");
    expect(system[0].text).toBe(READ_SYSTEM);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("keeps the system prefix byte-identical across calls", async () => {
    createMock.mockResolvedValue(canned());
    const provider = new AnthropicProvider();
    await provider.readSheet(IMAGES);
    const first = lastRequest(createMock).system[0].text;
    await provider.readSheet([IMAGES[0]]);
    expect(lastRequest(createMock).system[0].text).toBe(first);
  });

  // `medium`, chosen by measurement rather than instinct: it read the three fixtures exactly as
  // `high` did and cut roughly a third off the wait (tests/eval/results.md, 2026-09-03).
  it("sets the read effort and passes the sheet schema in output_config.format", async () => {
    createMock.mockResolvedValue(canned());
    await new AnthropicProvider().readSheet(IMAGES);

    const { output_config } = lastRequest(createMock);
    expect(output_config.effort).toBe(READ_EFFORT);
    expect(output_config.format.type).toBe("json_schema");
    expect(output_config.format.schema).toEqual(READ_OUTPUT_FORMAT.schema);
  });

  it("sends a schema describing the same shape as the published contract", () => {
    // The wire schema comes from the SDK's own zod helper (it normalises the document for the
    // structured-outputs endpoint). It must still describe what contracts/sheet-reading.schema.json
    // and lib/domain's sheetReadingJsonSchema() describe.
    const published = sheetReadingJsonSchema() as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
    const wire = READ_OUTPUT_FORMAT.schema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
    expect(wire.required).toEqual(published.required);
    expect(Object.keys(wire.properties).sort()).toEqual(Object.keys(published.properties).sort());
    expect(wire.additionalProperties).toBe(false);
    // Nothing volatile is baked into the schema bytes.
    expect(JSON.stringify(wire)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("opts into the server-side refusal fallback with the matching beta header", async () => {
    createMock.mockResolvedValue(canned());
    await new AnthropicProvider().readSheet(IMAGES);

    const request = lastRequest(createMock);
    expect(request.betas).toEqual([REFUSAL_FALLBACK_BETA]);
    expect(REFUSAL_FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(request.fallbacks).toBe("default");
    expect(request.max_tokens).toBe(MAX_TOKENS);
    expect(MAX_TOKENS).toBe(16000);
  });

  it("leaves thinking at the adaptive default", async () => {
    createMock.mockResolvedValue(canned());
    await new AnthropicProvider().readSheet(IMAGES);
    expect(lastRequest(createMock)).not.toHaveProperty("thinking");
  });

  it("puts every image block before the text instruction", async () => {
    createMock.mockResolvedValue(canned());
    await new AnthropicProvider().readSheet(IMAGES);

    const [{ role, content }] = lastRequest(createMock).messages;
    expect(role).toBe("user");
    expect(content.map((block) => block.type)).toEqual(["image", "image", "text"]);
    expect(content[0].source).toEqual({
      type: "base64",
      media_type: "image/jpeg",
      data: "AAAAJPEGBYTES",
    });
    expect(content[1].source?.media_type).toBe("image/png");
    expect(content[2].text).toContain("page 1");
  });
});

describe("no profile-like data ever leaves the server", () => {
  const FORBIDDEN = [
    "readAt",
    "profile",
    "label",
    "relationship",
    "plan",
    "confirmedAt",
    "followUpDate",
    "chewing",
    "recognisedType",
    "aiGenerated",
    "facts",
  ];

  // `messages` is the only part of the request built from caller data: `system` is asserted
  // byte-equal to the frozen constant elsewhere, and `output_config.format` is the derived schema.
  it("omits them from the read request", async () => {
    createMock.mockResolvedValue(canned());
    await new AnthropicProvider().readSheet(IMAGES);
    const body = JSON.stringify(lastRequest(createMock).messages);
    for (const field of FORBIDDEN) expect(body).not.toContain(field);
  });

  it("omits them from the ask request, including the cards' own facts", async () => {
    createMock.mockResolvedValue(
      canned({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              kind: "sheet" as const,
              citedCardId: "medicine-1",
              answer: SPEAKABLE,
            }),
          },
        ],
      }),
    );
    await new AnthropicProvider().answer({
      cards: CARDS,
      question: "白色嗰粒係朝早定夜晚食？",
      inputLanguage: "yue",
      dialect: "yue",
    });

    const body = JSON.stringify(lastRequest(createMock).messages);
    for (const field of FORBIDDEN) expect(body).not.toContain(field);
    // The card body and its source still travel; only the extra fields are dropped.
    expect(body).toContain("medicine-1");
  });
});

describe("AnthropicProvider.answer and .phrase", () => {
  it("use MODEL_ASK at medium effort with their own schemas", async () => {
    process.env.MODEL_ASK = "claude-opus-5";
    createMock.mockResolvedValue(
      canned({
        content: [
          {
            type: "text",
            text: JSON.stringify({ kind: "none" as const, citedCardId: null, answer: null }),
          },
        ],
      }),
    );

    const provider = new AnthropicProvider();
    const answered = await provider.answer({
      cards: CARDS,
      question: "幾時覆診？",
      inputLanguage: "yue",
      dialect: "cmn",
    });
    expect(answered.result.kind).toBe("none");

    let request = lastRequest(createMock);
    expect(request.model).toBe("claude-opus-5");
    expect(request.output_config.effort).toBe("medium");
    expect(request.output_config.format.schema).toEqual(ASK_OUTPUT_FORMAT.schema);
    expect(Object.keys((askResultJsonSchema() as { properties: object }).properties).sort()).toEqual(
      ["answer", "citedCardId", "kind"],
    );
    expect(request.system[0].text).toBe(ASK_SYSTEM);
    expect(request.system[0].cache_control).toEqual({ type: "ephemeral" });

    createMock.mockResolvedValue(
      canned({ content: [{ type: "text", text: JSON.stringify({ spoken: SPEAKABLE }) }] }),
    );
    const phrased = await provider.phrase({
      cardType: "medicine",
      facts: { name: "Amlodipine", strength: "5mg", frequency: null },
      source: SOURCE,
      avoid: ["治療"],
      dialect: "both",
    });
    expect(phrased.result.spoken).toEqual(SPEAKABLE);

    request = lastRequest(createMock);
    expect(request.output_config.effort).toBe("medium");
    expect(request.output_config.format.schema).toEqual(PHRASE_OUTPUT_FORMAT.schema);
    expect(
      Object.keys((phraseResultJsonSchema() as { properties: object }).properties),
    ).toEqual(["spoken"]);
    expect(request.system[0].text).toBe(PHRASE_SYSTEM);
  });
});

describe("response handling", () => {
  it("returns the parsed reading for a valid response", async () => {
    createMock.mockResolvedValue(canned());
    const { reading } = await new AnthropicProvider().readSheet(IMAGES);
    expect(reading).toEqual(READING);
  });

  it("populates the UsageSummary from usage", async () => {
    createMock.mockResolvedValue(canned());
    const { usage } = await new AnthropicProvider().readSheet(IMAGES);
    expect(usage.inputTokens).toBe(412);
    expect(usage.outputTokens).toBe(1180);
    expect(usage.cacheReadInputTokens).toBe(2048);
    expect(usage.cacheCreationInputTokens).toBe(96);
    expect(usage.model).toBe("claude-opus-5");
    expect(usage.ms).toBeGreaterThanOrEqual(0);
  });

  it("throws ModelRefusalError on stop_reason refusal, before reading content", async () => {
    createMock.mockResolvedValue(
      canned({
        stop_reason: "refusal",
        stop_details: { category: "cyber", explanation: "declined" },
        content: [],
      }),
    );

    const error = await new AnthropicProvider()
      .readSheet(IMAGES)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelRefusalError);
    expect((error as InstanceType<typeof ModelRefusalError>).category).toBe("cyber");
  });

  it("throws ModelOutputError when the body is not JSON", async () => {
    createMock.mockResolvedValue(canned({ content: [{ type: "text", text: "sorry, not JSON" }] }));
    await expect(new AnthropicProvider().readSheet(IMAGES)).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("throws ModelOutputError with the Zod issues when the JSON fails the schema", async () => {
    const broken = {
      ...READING,
      medicines: [{ ...READING.medicines[0], name: 42, unexpected: "field" }],
    };
    createMock.mockResolvedValue(
      canned({ content: [{ type: "text", text: JSON.stringify(broken) }] }),
    );

    const error = (await new AnthropicProvider()
      .readSheet(IMAGES)
      .then(() => null)
      .catch((e: unknown) => e)) as InstanceType<typeof ModelOutputError>;

    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error.code).toBe("invalid_output:schema");
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues.some((issue) => issue.path === "medicines.0.name")).toBe(true);
    // Issues carry only a path and a code; no response values reach the log.
    for (const issue of error.issues) {
      expect(Object.keys(issue).sort()).toEqual(["code", "path"]);
    }
  });

  it("throws ModelOutputError when the response was truncated", async () => {
    createMock.mockResolvedValue(canned({ stop_reason: "max_tokens" }));
    const error = (await new AnthropicProvider()
      .readSheet(IMAGES)
      .then(() => null)
      .catch((e: unknown) => e)) as InstanceType<typeof ModelOutputError>;
    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error.code).toBe("invalid_output:truncated");
  });

  it("never leaks request or response text through an error message", async () => {
    createMock.mockResolvedValue(
      canned({ content: [{ type: "text", text: "Amlodipine 5mg 1 tab daily" }] }),
    );
    const error = (await new AnthropicProvider()
      .readSheet(IMAGES)
      .then(() => null)
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("Amlodipine");
    expect(error.message).not.toContain("AAAAJPEGBYTES");
  });
});

describe("transport errors", () => {
  const headers = new Headers();

  it.each([
    ["connection", new APIConnectionError({ message: "socket hang up" }), null],
    ["429", new RateLimitError(429, undefined, "slow down", headers), 429],
    ["5xx", new InternalServerError(529, undefined, "overloaded", headers), 529],
  ])("maps a %s failure to ModelUnavailableError", async (_label, thrown, status) => {
    createMock.mockRejectedValue(thrown);
    const error = (await new AnthropicProvider()
      .readSheet(IMAGES)
      .then(() => null)
      .catch((e: unknown) => e)) as InstanceType<typeof ModelUnavailableError>;
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(error.status).toBe(status);
  });

  it("maps a 4xx to ModelRequestError", async () => {
    createMock.mockRejectedValue(new BadRequestError(400, undefined, "bad request", headers));
    const error = (await new AnthropicProvider()
      .readSheet(IMAGES)
      .then(() => null)
      .catch((e: unknown) => e)) as InstanceType<typeof ModelRequestError>;
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error.status).toBe(400);
  });
});

describe("readSheetStream", () => {
  it("uses the SDK stream helper, forwards text deltas and validates the final message", async () => {
    streamMock.mockReturnValue(fakeStream(canned(), ["{\"sheetType\":", "\"hk_en\"..."]));

    const seen: string[] = [];
    const { reading, usage } = await new AnthropicProvider().readSheetStream(IMAGES, (delta) =>
      seen.push(delta),
    );

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    expect(seen).toEqual(["{\"sheetType\":", "\"hk_en\"..."]);
    expect(reading).toEqual(READING);
    expect(usage.cacheReadInputTokens).toBe(2048);

    const request = lastRequest(streamMock);
    expect(request.output_config.effort).toBe(READ_EFFORT);
    expect(request.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(request.messages[0].content.map((block) => block.type)).toEqual([
      "image",
      "image",
      "text",
    ]);
  });

  it("surfaces a refusal from the streamed final message", async () => {
    streamMock.mockReturnValue(
      fakeStream(canned({ stop_reason: "refusal", content: [], stop_details: undefined })),
    );
    await expect(new AnthropicProvider().readSheetStream(IMAGES)).rejects.toBeInstanceOf(
      ModelRefusalError,
    );
  });
});

describe("getModelProvider", () => {
  it("returns the same instance while the model ids are unchanged", () => {
    expect(getModelProvider()).toBe(getModelProvider());
  });
});

describe("frozen system prompts", () => {
  const BANNED = [
    "診斷",
    "诊断",
    "治療",
    "治疗",
    "處方",
    "处方",
    "治癒",
    "治愈",
    "能吃",
    "不能吃",
    "唔食得",
    "建議你",
    "建议你",
    "你應該",
    "你应该",
    // The prompts write English now, so the English half of the filter is named on the same line.
    "diagnose",
    "diagnosis",
    "treat",
    "treatment",
    "cure",
    "prescribe",
    "prescription",
    "you should",
    "you must",
    "can eat",
    "cannot eat",
    "safe to eat",
  ];

  const prompts: Array<[string, string]> = [
    ["READ_SYSTEM", READ_SYSTEM],
    ["ASK_SYSTEM", ASK_SYSTEM],
    ["PHRASE_SYSTEM", PHRASE_SYSTEM],
  ];

  it.each(prompts)("%s has exactly one banned-words instruction line", (_name, prompt) => {
    const instructionLines = prompt
      .split("\n")
      .filter((line) => line.startsWith(BANNED_WORDS_LINE_PREFIX));
    expect(instructionLines).toHaveLength(1);
    for (const term of BANNED) expect(instructionLines[0]).toContain(term);
  });

  it.each(prompts)("%s contains banned words only on that line", (name, prompt) => {
    const lines = prompt.split("\n");
    const instructionLines = lines.filter((line) => line.startsWith(BANNED_WORDS_LINE_PREFIX));
    for (const term of BANNED) {
      const hits = lines.filter((line) => line.includes(term));
      expect(hits, `${name} mentions "${term}" outside the banned-words line`).toEqual(
        instructionLines,
      );
    }
  });

  it.each(prompts)("%s asks for the English form alongside the two dialects", (_name, prompt) => {
    // Every prompt has to name `en`, or the model has no reason to fill the third field at all.
    expect(prompt).toContain("`en`");
    expect(prompt).toContain("`yue`");
    expect(prompt).toContain("`cmn`");
    expect(prompt).toMatch(/twelve-year-old reading level/);
    expect(prompt, "the English brief has to say what register it wants").toMatch(
      /short sentences|Short sentences/,
    );
  });

  it("READ_SYSTEM tells the model the three fields are one object, not two", () => {
    expect(READ_SYSTEM).toContain("is an object with three fields");
    expect(READ_SYSTEM).not.toContain("is an object with two fields");
  });

  it("every prompt keeps drug names verbatim in the English form too", () => {
    for (const [name, prompt] of prompts) {
      expect(prompt, `${name} does not pin names to their original script`).toMatch(
        /original script/,
      );
    }
    // The two prompts that write a whole sentence around a name say it outright.
    expect(READ_SYSTEM).toMatch(/never translated, transliterated or re-spelled/);
    expect(ASK_SYSTEM).toMatch(/never translated or transliterated/);
    expect(PHRASE_SYSTEM).toMatch(/verbatim in each of them/);
  });

  /**
   * The four instructions that answer the four failures in tests/eval/stress.md. Each is here
   * because the schema alone cannot carry it: the field exists, and the prompt is the only thing
   * that says how to fill it.
   */
  describe("READ_SYSTEM answers the stress findings", () => {
    it("says where a medicine's status comes from, and names the headings", () => {
      expect(READ_SYSTEM).toContain("MEDICINE STATUS");
      expect(READ_SYSTEM).toMatch(/from the page's own headings/i);
      for (const heading of ["停用药物", "出院后不再服用", "Discontinued", "not to be taken"]) {
        expect(READ_SYSTEM, `no heading example "${heading}"`).toContain(heading);
      }
      // The clause that stops the same drug coming back twice when the dose was changed.
      expect(READ_SYSTEM).toMatch(/never returned as a second medicine/);
    });

    it("says an unresolvable character makes the whole field unreadable", () => {
      expect(READ_SYSTEM).toMatch(/UNCERTAIN/);
      expect(READ_SYSTEM).toMatch(/makes the WHOLE field unreadable/);
      expect(READ_SYSTEM).toMatch(/rather than choosing the most likely reading/);
      // and that the flag names which value it costs, not just "somewhere on the page".
      expect(READ_SYSTEM).toMatch(/followUp\[0\]\.when/);
    });

    it("says the quote is a copy and gives the line that was rewritten", () => {
      expect(READ_SYSTEM).toMatch(/character-for-character copy/);
      expect(READ_SYSTEM).toContain("Breathless at rest");
      expect(READ_SYSTEM).toMatch(/never translate/i);
      expect(READ_SYSTEM).toMatch(/findable in that same medicine's own/);
    });

    it("says the whole instruction clause is one frequency", () => {
      expect(READ_SYSTEM).toContain("每日一次，早餐后服");
      expect(READ_SYSTEM).toContain("daily, 30 min before breakfast");
      expect(READ_SYSTEM).toMatch(/ONE verbatim string/);
    });
  });

  it.each(prompts)("%s carries nothing that would break the prompt cache", (_name, prompt) => {
    // No dates, clock times or uuid-like ids in the cached prefix (shared/prompt-caching.md).
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prompt).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
