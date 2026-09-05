/**
 * Unit tests for the model provider adapter. The AI SDK entry points (`generateText` /
 * `streamText`) are injected through `GatewayProvider`'s test seams, so nothing here reaches the
 * Gateway and no token is needed: the fakes return canned results and the tests assert on the
 * request that was built and on how each result is handled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError, RetryError, type generateText, type streamText } from "ai";

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
import {
  ASK_TIMEOUT_MS,
  DEFAULT_MODEL,
  GatewayProvider,
  MAX_TOKENS,
  ModelOutputError,
  ModelRefusalError,
  ModelRequestError,
  ModelUnavailableError,
  READ_TIMEOUT_MS,
  getModelProvider,
  toModelError,
  toUserContent,
} from "@/lib/model/client";

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
  inputTokens: 412,
  outputTokens: 1180,
  totalTokens: 1592,
  inputTokenDetails: { noCacheTokens: 412, cacheReadTokens: 2048, cacheWriteTokens: 96 },
  outputTokenDetails: { textTokens: 1180, reasoningTokens: 0 },
};

type FinishReason = Awaited<ReturnType<typeof generateText>>["finishReason"];

/** The subset of a `generateText` result that `client.ts` reads. */
interface CannedResult {
  text: string;
  finishReason: FinishReason;
  usage: typeof USAGE;
  response: { modelId: string };
}

function canned(overrides: Partial<CannedResult> = {}): CannedResult {
  return {
    text: JSON.stringify(READING),
    finishReason: "stop",
    usage: { ...USAGE },
    response: { modelId: "google/gemini-3.8-flash" },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Request inspection helpers                                                 */
/* -------------------------------------------------------------------------- */

interface Part {
  type: string;
  text?: string;
  image?: string;
  mediaType?: string;
}

interface RecordedMessage {
  role: string;
  content: string | Part[];
  providerOptions?: { anthropic?: { cacheControl?: { type: string } } };
}

interface RecordedRequest {
  model: string;
  messages: RecordedMessage[];
  output: { responseFormat: unknown };
  maxOutputTokens: number;
  maxRetries: number;
  timeout: { totalMs: number };
  providerOptions: { gateway: { tags: string[] } };
  onError?: (event: { error: unknown }) => void;
}

const generateMock = vi.fn();
const streamMock = vi.fn();

/** A provider wired to the fakes, so no test can reach the real SDK. */
function provider(options: { modelRead?: string; modelAsk?: string } = {}) {
  return new GatewayProvider({
    ...options,
    generate: generateMock as unknown as typeof generateText,
    stream: streamMock as unknown as typeof streamText,
  });
}

function lastRequest(mock: typeof generateMock): RecordedRequest {
  const { calls } = mock.mock;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as RecordedRequest;
}

function systemMessage(request: RecordedRequest): RecordedMessage {
  const [system] = request.messages;
  expect(system.role).toBe("system");
  return system;
}

function userParts(request: RecordedRequest): Part[] {
  const user = request.messages[1];
  expect(user.role).toBe("user");
  expect(Array.isArray(user.content)).toBe(true);
  return user.content as Part[];
}

/** The JSON schema the SDK will send, out of the `Output.object()` in the request. */
async function wireSchema(request: RecordedRequest) {
  const format = (await request.output.responseFormat) as {
    type: string;
    schema: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> };
  };
  expect(format.type).toBe("json");
  return format.schema;
}

/** What `streamText` returns, reduced to the fields `client.ts` reads. */
function fakeStream(result: CannedResult, deltas: string[] = []) {
  return {
    textStream: (async function* () {
      for (const delta of deltas) yield delta;
    })(),
    finishReason: Promise.resolve(result.finishReason),
    usage: Promise.resolve(result.usage),
    response: Promise.resolve(result.response),
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null).catch((e: unknown) => e);
}

function apiError(statusCode: number | undefined) {
  return new APICallError({
    message: "upstream said: Amlodipine 5mg 1 tab daily",
    url: "https://ai-gateway.vercel.sh/v1/ai/language-model",
    requestBodyValues: { images: ["AAAAJPEGBYTES"] },
    statusCode,
    responseBody: "Amlodipine 5mg 1 tab daily",
    isRetryable: statusCode === undefined || statusCode === 429 || statusCode >= 500,
  });
}

beforeEach(() => {
  generateMock.mockReset();
  streamMock.mockReset();
  delete process.env.MODEL_READ;
  delete process.env.MODEL_ASK;
});

afterEach(() => {
  delete process.env.MODEL_READ;
  delete process.env.MODEL_ASK;
});

/* -------------------------------------------------------------------------- */

describe("GatewayProvider.readSheet request", () => {
  it("forwards a caller signal and clamps a generous timeout to the read default", async () => {
    generateMock.mockResolvedValue(canned());
    const signal = new AbortController().signal;
    await provider().readSheet(IMAGES, { signal, timeoutMs: READ_TIMEOUT_MS + 60_000 });
    const request = lastRequest(generateMock) as RecordedRequest & { abortSignal?: AbortSignal };
    expect(request.abortSignal).toBe(signal);
    expect(request.timeout).toEqual({ totalMs: READ_TIMEOUT_MS });
  });

  it("uses a shorter remaining timeout when supplied", async () => {
    generateMock.mockResolvedValue(canned());
    await provider().readSheet(IMAGES, { timeoutMs: 4_000 });
    expect(lastRequest(generateMock).timeout).toEqual({ totalMs: 4_000 });
  });

  it("uses MODEL_READ from the environment, defaulting to google/gemini-3.8-flash", async () => {
    generateMock.mockResolvedValue(canned());

    await provider().readSheet(IMAGES);
    expect(lastRequest(generateMock).model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("google/gemini-3.8-flash");

    process.env.MODEL_READ = "anthropic/claude-sonnet-5";
    await provider().readSheet(IMAGES);
    expect(lastRequest(generateMock).model).toBe("anthropic/claude-sonnet-5");

    // Blank means unset, not a model called "".
    process.env.MODEL_READ = "   ";
    await provider().readSheet(IMAGES);
    expect(lastRequest(generateMock).model).toBe(DEFAULT_MODEL);
  });

  it("sends one frozen system message first, carrying the Anthropic cache breakpoint", async () => {
    generateMock.mockResolvedValue(canned());
    await provider().readSheet(IMAGES);

    const request = lastRequest(generateMock);
    expect(request.messages).toHaveLength(2);
    const system = systemMessage(request);
    expect(system.content).toBe(READ_SYSTEM);
    expect(system.providerOptions?.anthropic?.cacheControl).toEqual({ type: "ephemeral" });
  });

  it("keeps the system prefix byte-identical across calls", async () => {
    generateMock.mockResolvedValue(canned());
    const p = provider();
    await p.readSheet(IMAGES);
    const first = systemMessage(lastRequest(generateMock)).content;
    await p.readSheet([IMAGES[0]]);
    expect(systemMessage(lastRequest(generateMock)).content).toBe(first);
  });

  it("asks for structured output from the sheet schema and caps the reply", async () => {
    generateMock.mockResolvedValue(canned());
    await provider().readSheet(IMAGES);

    const request = lastRequest(generateMock);
    expect(request.maxOutputTokens).toBe(MAX_TOKENS);
    expect(MAX_TOKENS).toBe(16000);
    expect(request.maxRetries).toBe(2);
    expect(request.timeout).toEqual({ totalMs: READ_TIMEOUT_MS });
    expect(request.providerOptions).toEqual({ gateway: { tags: ["route:read"] } });

    // The wire schema must still describe what contracts/sheet-reading.schema.json and
    // lib/domain's sheetReadingJsonSchema() describe.
    const published = sheetReadingJsonSchema() as {
      required: string[];
      properties: Record<string, unknown>;
    };
    const wire = await wireSchema(request);
    expect(wire.required).toEqual(published.required);
    expect(Object.keys(wire.properties).sort()).toEqual(Object.keys(published.properties).sort());
    expect(wire.additionalProperties).toBe(false);
    // Nothing volatile is baked into the schema bytes.
    expect(JSON.stringify(wire)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("puts every image part before the text instruction", async () => {
    generateMock.mockResolvedValue(canned());
    await provider().readSheet(IMAGES);

    const parts = userParts(lastRequest(generateMock));
    expect(parts.map((part) => part.type)).toEqual(["image", "image", "text"]);
    expect(parts[0]).toEqual({ type: "image", image: "AAAAJPEGBYTES", mediaType: "image/jpeg" });
    expect(parts[1].mediaType).toBe("image/png");
    expect(parts[2].text).toContain("page 1");
  });
});

describe("toUserContent", () => {
  it("converts text and base64 image blocks into SDK parts", () => {
    expect(
      toUserContent([
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAAPNGBYTES" } },
        { type: "text", text: "Read page 1." },
      ]),
    ).toEqual([
      { type: "image", image: "AAAAPNGBYTES", mediaType: "image/png" },
      { type: "text", text: "Read page 1." },
    ]);
  });

  it("rejects a block shape this app never builds, without echoing it", () => {
    let thrown: unknown = null;
    try {
      toUserContent([
        { type: "image", source: { type: "url", url: "https://example.invalid/AAAAJPEGBYTES" } },
      ]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ModelRequestError);
    expect((thrown as Error).message).not.toContain("AAAAJPEGBYTES");
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

  // The user message is the only part of the request built from caller data: the system message
  // is asserted byte-equal to the frozen constant elsewhere (and the frozen prompt itself talks
  // about "labels" and "plans"), and `output` is the derived schema.
  it("omits them from the read request", async () => {
    generateMock.mockResolvedValue(canned());
    await provider().readSheet(IMAGES);
    const body = JSON.stringify(userParts(lastRequest(generateMock)));
    for (const field of FORBIDDEN) expect(body).not.toContain(field);
  });

  it("omits them from the ask request, including the cards' own facts", async () => {
    generateMock.mockResolvedValue(
      canned({
        text: JSON.stringify({
          kind: "sheet" as const,
          citedCardIds: ["medicine-1"],
          answer: SPEAKABLE,
        }),
      }),
    );
    await provider().answer({
      cards: CARDS,
      question: "白色嗰粒係朝早定夜晚食？",
      inputLanguage: "yue",
      dialect: "yue",
    });

    const body = JSON.stringify(userParts(lastRequest(generateMock)));
    for (const field of FORBIDDEN) expect(body).not.toContain(field);
    // The card body and its source still travel; only the extra fields are dropped.
    expect(body).toContain("medicine-1");
  });
});

describe("GatewayProvider.answer and .phrase", () => {
  it("use MODEL_ASK with their own schemas, tags and timeout", async () => {
    process.env.MODEL_ASK = "openai/gpt-5.6-terra";
    generateMock.mockResolvedValue(
      canned({ text: JSON.stringify({ kind: "none" as const, citedCardIds: [], answer: null }) }),
    );

    const p = provider();
    const answered = await p.answer({
      cards: CARDS,
      question: "幾時覆診？",
      inputLanguage: "yue",
      dialect: "cmn",
    });
    expect(answered.result.kind).toBe("none");

    let request = lastRequest(generateMock);
    expect(request.model).toBe("openai/gpt-5.6-terra");
    expect(request.timeout).toEqual({ totalMs: ASK_TIMEOUT_MS });
    expect(request.providerOptions.gateway.tags).toEqual(["route:ask"]);
    expect(Object.keys((await wireSchema(request)).properties).sort()).toEqual(
      Object.keys((askResultJsonSchema() as { properties: object }).properties).sort(),
    );
    expect(systemMessage(request).content).toBe(ASK_SYSTEM);
    expect(systemMessage(request).providerOptions?.anthropic?.cacheControl).toEqual({
      type: "ephemeral",
    });

    generateMock.mockResolvedValue(canned({ text: JSON.stringify({ spoken: SPEAKABLE }) }));
    const phrased = await p.phrase({
      cardType: "medicine",
      facts: { name: "Amlodipine", strength: "5mg", frequency: null },
      source: SOURCE,
      avoid: ["治病"],
      dialect: "both",
    });
    expect(phrased.result.spoken).toEqual(SPEAKABLE);

    request = lastRequest(generateMock);
    expect(request.model).toBe("openai/gpt-5.6-terra");
    expect(request.timeout).toEqual({ totalMs: ASK_TIMEOUT_MS });
    expect(request.providerOptions.gateway.tags).toEqual(["route:phrase"]);
    expect(Object.keys((await wireSchema(request)).properties)).toEqual(
      Object.keys((phraseResultJsonSchema() as { properties: object }).properties),
    );
    expect(systemMessage(request).content).toBe(PHRASE_SYSTEM);
  });

  it("constructor options win over the environment", async () => {
    process.env.MODEL_READ = "anthropic/claude-sonnet-5";
    process.env.MODEL_ASK = "anthropic/claude-sonnet-5";
    const p = provider({ modelRead: "google/gemini-3.8-pro", modelAsk: "openai/gpt-5.6-terra" });
    expect(p.modelRead).toBe("google/gemini-3.8-pro");
    expect(p.modelAsk).toBe("openai/gpt-5.6-terra");
  });
});

describe("response handling", () => {
  it("returns the parsed reading for a valid response", async () => {
    generateMock.mockResolvedValue(canned());
    const { reading } = await provider().readSheet(IMAGES);
    expect(reading).toEqual(READING);
  });

  it("populates the UsageSummary from usage and the serving model id", async () => {
    generateMock.mockResolvedValue(canned({ response: { modelId: "gemini-3.8-flash-002" } }));
    const { usage } = await provider().readSheet(IMAGES);
    expect(usage.inputTokens).toBe(412);
    expect(usage.outputTokens).toBe(1180);
    expect(usage.cacheReadInputTokens).toBe(2048);
    expect(usage.cacheCreationInputTokens).toBe(96);
    expect(usage.model).toBe("gemini-3.8-flash-002");
    expect(usage.ms).toBeGreaterThanOrEqual(0);
  });

  it("falls back to the requested model and zero counts when the gateway reports none", async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify(READING),
      finishReason: "stop",
      usage: undefined,
      response: undefined,
    });
    const { usage } = await provider().readSheet(IMAGES);
    expect(usage.model).toBe(DEFAULT_MODEL);
    expect(usage.inputTokens).toBe(0);
    expect(usage.cacheReadInputTokens).toBe(0);
  });

  it("throws ModelRefusalError on a content-filter finish, before reading the text", async () => {
    generateMock.mockResolvedValue(canned({ finishReason: "content-filter", text: "" }));

    const error = await failure(provider().readSheet(IMAGES));
    expect(error).toBeInstanceOf(ModelRefusalError);
    expect((error as InstanceType<typeof ModelRefusalError>).code).toBe("refusal");
    expect((error as InstanceType<typeof ModelRefusalError>).category).toBeNull();
  });

  it("throws ModelOutputError when the body is not JSON", async () => {
    generateMock.mockResolvedValue(canned({ text: "sorry, not JSON" }));
    const error = await failure(provider().readSheet(IMAGES));
    expect(error).toBeInstanceOf(ModelOutputError);
    expect((error as InstanceType<typeof ModelOutputError>).code).toBe("invalid_output:invalid_json");
  });

  it("throws ModelOutputError with the Zod issues when the JSON fails the schema", async () => {
    const broken = {
      ...READING,
      medicines: [{ ...READING.medicines[0], name: 42, unexpected: "field" }],
    };
    generateMock.mockResolvedValue(canned({ text: JSON.stringify(broken) }));

    const error = (await failure(provider().readSheet(IMAGES))) as InstanceType<
      typeof ModelOutputError
    >;

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
    generateMock.mockResolvedValue(canned({ finishReason: "length" }));
    const error = (await failure(provider().readSheet(IMAGES))) as InstanceType<
      typeof ModelOutputError
    >;
    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error.code).toBe("invalid_output:truncated");
  });

  it("throws ModelUnavailableError when the provider reports an error finish", async () => {
    generateMock.mockResolvedValue(canned({ finishReason: "error" }));
    const error = (await failure(provider().readSheet(IMAGES))) as InstanceType<
      typeof ModelUnavailableError
    >;
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(error.status).toBeNull();
  });

  it("never leaks request or response text through an error message", async () => {
    generateMock.mockResolvedValue(canned({ text: "Amlodipine 5mg 1 tab daily" }));
    const error = (await failure(provider().readSheet(IMAGES))) as Error;
    expect(error.message).not.toContain("Amlodipine");
    expect(error.message).not.toContain("AAAAJPEGBYTES");
  });
});

describe("transport errors", () => {
  it.each([
    ["connection", apiError(undefined), null],
    ["429", apiError(429), 429],
    ["5xx", apiError(529), 529],
    ["non-SDK", new Error("socket hang up: AAAAJPEGBYTES"), null],
  ])("maps a %s failure to ModelUnavailableError", async (_label, thrown, status) => {
    generateMock.mockRejectedValue(thrown);
    const error = (await failure(provider().readSheet(IMAGES))) as InstanceType<
      typeof ModelUnavailableError
    >;
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(error.status).toBe(status);
    expect(error.message).not.toContain("Amlodipine");
    expect(error.message).not.toContain("AAAAJPEGBYTES");
  });

  it("maps a 4xx to ModelRequestError", async () => {
    generateMock.mockRejectedValue(apiError(400));
    const error = (await failure(provider().readSheet(IMAGES))) as InstanceType<
      typeof ModelRequestError
    >;
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error.status).toBe(400);
    expect(error.message).not.toContain("Amlodipine");
  });

  it("unwraps the last attempt from the SDK's RetryError", async () => {
    generateMock.mockRejectedValue(
      new RetryError({
        message: "Failed after 3 attempts",
        reason: "maxRetriesExceeded",
        errors: [apiError(500), apiError(503), apiError(429)],
      }),
    );
    const error = (await failure(provider().readSheet(IMAGES))) as InstanceType<
      typeof ModelUnavailableError
    >;
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(error.status).toBe(429);
  });

  it("toModelError passes its own errors through untouched", () => {
    const refusal = new ModelRefusalError("cyber");
    expect(toModelError(refusal)).toBe(refusal);
    expect(toModelError("not even an Error")).toBeInstanceOf(ModelUnavailableError);
  });
});

describe("readSheetStream", () => {
  it("uses streamText, forwards text deltas in order and validates the final text", async () => {
    // The final text is what the deltas add up to, so make them do so here.
    const full = JSON.stringify(READING);
    const chunks = [full.slice(0, 20), full.slice(20, 100), full.slice(100)];
    streamMock.mockReturnValue(fakeStream(canned(), chunks));

    const seen: string[] = [];
    const { reading, usage } = await provider().readSheetStream(IMAGES, (delta) =>
      seen.push(delta),
    );

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(generateMock).not.toHaveBeenCalled();
    expect(seen).toEqual(chunks);
    expect(reading).toEqual(READING);
    expect(usage.cacheReadInputTokens).toBe(2048);
    expect(usage.model).toBe("google/gemini-3.8-flash");

    // Same request as the unstreamed path, plus the error hook.
    const request = lastRequest(streamMock);
    expect(request.model).toBe(DEFAULT_MODEL);
    expect(request.timeout).toEqual({ totalMs: READ_TIMEOUT_MS });
    expect(request.providerOptions.gateway.tags).toEqual(["route:read"]);
    expect(systemMessage(request).providerOptions?.anthropic?.cacheControl).toEqual({
      type: "ephemeral",
    });
    expect(userParts(request).map((part) => part.type)).toEqual(["image", "image", "text"]);
    expect(typeof request.onError).toBe("function");
  });

  it("validates the concatenated text, not the deltas", async () => {
    streamMock.mockReturnValue(fakeStream(canned(), ["not ", "json"]));
    const error = await failure(provider().readSheetStream(IMAGES));
    expect(error).toBeInstanceOf(ModelOutputError);
    expect((error as InstanceType<typeof ModelOutputError>).code).toBe("invalid_output:invalid_json");
  });

  it("surfaces a refusal from the streamed finish reason", async () => {
    streamMock.mockReturnValue(fakeStream(canned({ finishReason: "content-filter", text: "" })));
    await expect(provider().readSheetStream(IMAGES)).rejects.toBeInstanceOf(ModelRefusalError);
  });

  it("surfaces a transport error reported through onError after the stream ends", async () => {
    streamMock.mockImplementation((params: RecordedRequest) => {
      const stream = fakeStream(canned({ finishReason: "error", text: "" }), ["{"]);
      params.onError?.({ error: apiError(503) });
      return stream;
    });
    const seen: string[] = [];
    const error = (await failure(
      provider().readSheetStream(IMAGES, (delta) => seen.push(delta)),
    )) as InstanceType<typeof ModelUnavailableError>;
    expect(seen).toEqual(["{"]);
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(error.status).toBe(503);
  });

  it("maps a throw from the stream itself", async () => {
    streamMock.mockImplementation(() => {
      throw apiError(401);
    });
    const error = (await failure(provider().readSheetStream(IMAGES))) as InstanceType<
      typeof ModelRequestError
    >;
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error.status).toBe(401);
  });
});

describe("getModelProvider", () => {
  it("returns the same instance while the model ids are unchanged", () => {
    expect(getModelProvider()).toBe(getModelProvider());
  });

  it("rebuilds the provider when the model ids change", () => {
    const before = getModelProvider();
    process.env.MODEL_ASK = "anthropic/claude-sonnet-5";
    const after = getModelProvider();
    expect(after).not.toBe(before);
    expect((after as GatewayProvider).modelAsk).toBe("anthropic/claude-sonnet-5");
    expect(getModelProvider()).toBe(after);
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

describe("answerStream", () => {
  const RESULT = {
    kind: "sheet" as const,
    citedCardIds: ["medicine-0"],
    answer: SPEAKABLE,
  };

  it("reports the reader's sentence once, as soon as it and `kind` have closed, then validates the whole", async () => {
    const full = JSON.stringify(RESULT);
    const cut = full.indexOf('"cmn"');
    // The Cantonese sentence closes inside the first delta; the rest arrives afterwards.
    streamMock.mockReturnValue(fakeStream(canned({ text: full }), [full.slice(0, cut), full.slice(cut)]));

    const early: unknown[] = [];
    const { result } = await provider().answerStream(
      { cards: CARDS, question: "幾時覆診？", inputLanguage: "yue", dialect: "yue" },
      (partial) => early.push(partial),
    );

    expect(early).toEqual([{ kind: "sheet", citedCardIds: ["medicine-0"], text: SPEAKABLE.yue }]);
    expect(result).toEqual(RESULT);
    const request = lastRequest(streamMock);
    expect(request.providerOptions.gateway.tags).toEqual(["route:ask"]);
    expect(request.timeout).toEqual({ totalMs: ASK_TIMEOUT_MS });
  });

  it("reports nothing early when the sentence never closes before the end", async () => {
    streamMock.mockReturnValue(fakeStream(canned({ text: "{" }), ["{"]));
    const onEarly = vi.fn();
    await expect(
      provider().answerStream(
        { cards: CARDS, question: "?", inputLanguage: "yue", dialect: "yue" },
        onEarly,
      ),
    ).rejects.toBeInstanceOf(ModelOutputError);
    expect(onEarly).not.toHaveBeenCalled();
  });
});
