/**
 * `/api/warm` makes one fixed model call, rate-limits itself, and logs nothing but timings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const answer = vi.fn();

vi.mock("@/lib/model/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/model/client")>();
  return { ...actual, getModelProvider: () => ({ answer }) };
});

const USAGE = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  model: "mock",
  ms: 42,
};

describe("/api/warm", () => {
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    answer.mockReset();
    info = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    info.mockRestore();
  });

  it("calls the model with a fixed card and greeting, and reports the timing only", async () => {
    answer.mockResolvedValue({ result: { kind: "none", citedCardIds: [], answer: null }, usage: USAGE });
    const { POST } = await import("@/app/api/warm/route");

    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ warmed: true, ms: 42 });
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(answer).toHaveBeenCalledTimes(1);
    const input = answer.mock.calls[0][0] as { cards: { id: string }[]; question: string };
    expect(input.cards.map((card) => card.id)).toEqual(["no-warnings"]);
    expect(input.question).toBe("你好");

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('"route":"warm"');
    expect(logged).not.toContain("你好");
  });

  it("makes one call for a burst of callers", async () => {
    answer.mockResolvedValue({ result: { kind: "none", citedCardIds: [], answer: null }, usage: USAGE });
    const { GET, POST } = await import("@/app/api/warm/route");

    await POST();
    const second = await GET();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(await second.json()).toEqual({ warmed: false, reason: "recent" });
  });

  it("answers 502 with a code, never a message, when the model cannot be reached", async () => {
    const { ModelUnavailableError } = await import("@/lib/model/client");
    answer.mockRejectedValue(new ModelUnavailableError(503));
    const { POST } = await import("@/app/api/warm/route");

    const response = await POST();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ warmed: false, reason: "model_unavailable" });
    // The gap resets on failure so the next caller can try again at once.
    answer.mockResolvedValue({ result: { kind: "none", citedCardIds: [], answer: null }, usage: USAGE });
    expect((await POST()).status).toBe(200);
  });
});
