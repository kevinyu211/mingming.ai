/**
 * Unit tests for `POST /api/phrase`. Same shape as the read-route tests: `getModelProvider` is
 * mocked, the real error classes are kept, and the route is driven with a plain `Request`.
 *
 * The two properties worth pinning down are the second-strike template and the privacy guard on
 * `facts` — a medicine's `name` is a fact off the page and must stay allowed, while a `label` or a
 * `base64` blob means the caller is sending something this route has no business forwarding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceReference } from "@/lib/domain/schemas";
import { templateFor } from "@/lib/rules/template-fallback";

const { providerMock } = vi.hoisted(() => ({
  providerMock: {
    readSheet: vi.fn(),
    readSheetStream: vi.fn(),
    answer: vi.fn(),
    phrase: vi.fn(),
  },
}));

vi.mock("@/lib/model/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/model/client")>();
  return { ...actual, getModelProvider: () => providerMock };
});

const { POST } = await import("@/app/api/phrase/route");
const { ModelOutputError, ModelUnavailableError } = await import("@/lib/model/client");

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  model: "stub",
  ms: 0,
};

const SOURCE: SourceReference = {
  section: "Discharge Medication(s) & Follow-up Plan",
  lineIndex: 0,
  quote: "1. Amlodipine 5mg 1 tab daily",
};

const FACTS = {
  name: "Amlodipine",
  strength: "5mg",
  amount: "1 tab",
  frequency: "daily",
  duration: null,
};

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cardType: "medicine",
    facts: FACTS,
    source: SOURCE,
    avoid: ["治療"],
    dialect: "both",
    ...overrides,
  };
}

function post(payload: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/phrase", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function returns(yue: string, cmn: string, en = `[en] ${yue}`) {
  providerMock.phrase.mockResolvedValue({ result: { spoken: { yue, cmn, en } }, usage: USAGE });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("POST /api/phrase — success", () => {
  it("returns a clean phrasing unfiltered, and forwards the avoid list", async () => {
    returns("藥名 Amlodipine，5mg，每次一粒，每日一次。", "药名 Amlodipine，5mg，每次一片，每天一次。");

    const response = await POST(post(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      spoken: {
        yue: "藥名 Amlodipine，5mg，每次一粒，每日一次。",
        cmn: "药名 Amlodipine，5mg，每次一片，每天一次。",
        en: "[en] 藥名 Amlodipine，5mg，每次一粒，每日一次。",
      },
      filtered: false,
    });

    expect(providerMock.phrase).toHaveBeenCalledTimes(1);
    expect(providerMock.phrase.mock.calls[0][0]).toEqual({
      cardType: "medicine",
      facts: FACTS,
      source: SOURCE,
      avoid: ["治療"],
      dialect: "both",
    });
  });

  it("substitutes the fixed template when the new phrasing trips the filter", async () => {
    returns("呢隻藥係用嚟治療高血壓。", "这个药是用来治疗高血压的。");

    const response = await POST(post(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      spoken: templateFor("medicine", FACTS),
      filtered: true,
    });
  });

  it("defaults avoid, dialect and source when they are omitted", async () => {
    returns("張紙冇印警號。", "纸上没有印警号。");

    const response = await POST(post({ cardType: "noWarnings", facts: {} }));
    expect(response.status).toBe(200);
    expect(providerMock.phrase.mock.calls[0][0]).toMatchObject({
      avoid: [],
      dialect: "both",
      source: { section: "", lineIndex: null, quote: "" },
    });
  });
});

describe("POST /api/phrase — request validation", () => {
  it("allows a medicine's name key", async () => {
    returns("藥名 Amlodipine。", "药名 Amlodipine。");
    const response = await POST(post(body({ facts: { name: "Amlodipine" } })));
    expect(response.status).toBe(200);
  });

  it.each(["image", "images", "base64", "label", "profile", "Base64", " label "])(
    "rejects a facts object carrying a %s key",
    async (key) => {
      const response = await POST(post(body({ facts: { [key]: "x" } })));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "bad_request",
        detail: "forbidden_fact_key",
      });
      expect(providerMock.phrase).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an unknown card type", body({ cardType: "prescription" })],
    ["a missing cardType", { facts: FACTS, source: SOURCE }],
    ["facts that are not strings or null", body({ facts: { name: 5 } })],
    ["an unknown dialect", body({ dialect: "wuu" })],
    ["an extra field", body({ profile: "mum" })],
  ])("rejects %s with 400", async (_name, payload) => {
    const response = await POST(post(payload));
    expect(response.status).toBe(400);

    const json = (await response.json()) as { error: string; detail: string };
    expect(json.error).toBe("bad_request");
    expect(json.detail).toMatch(/^[A-Za-z0-9_.:-]+$/);
    expect(providerMock.phrase).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON with 400", async () => {
    const response = await POST(post("{{"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_request", detail: "invalid_json" });
  });

  it("rejects an oversize body with 413", async () => {
    const response = await POST(post(body(), { "content-length": String(128 * 1024) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
  });
});

describe("POST /api/phrase — model failures", () => {
  it("answers 502 when the model is unreachable", async () => {
    providerMock.phrase.mockRejectedValue(new ModelUnavailableError(503));

    const response = await POST(post(body()));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "model_unavailable" });
  });

  it("answers 502 on an unusable reply", async () => {
    providerMock.phrase.mockRejectedValue(new ModelOutputError("invalid_json"));

    const response = await POST(post(body()));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "model_unavailable" });
  });
});
