import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "@/lib/model/client";
import { buildCards } from "@/lib/rules/card-order";
import type { SheetReading } from "@/lib/domain/schemas";
import { checkSpeakable } from "@/lib/rules/banned-terms";
import { runReadingPipeline } from "@/lib/server/reading-pipeline";

const SOURCE = path.join(process.cwd(), "fixtures/sheets/hk_en.expected.json");
const BASE = JSON.parse(readFileSync(SOURCE, "utf8")) as SheetReading;
const clone = () => JSON.parse(JSON.stringify(BASE)) as SheetReading;

afterEach(() => vi.useRealTimers());

describe("bounded read repairs", () => {
  it("caps concurrent repairs and templates every stalled candidate at the shared deadline", async () => {
    vi.useFakeTimers();
    const reading = clone();
    for (const medicine of reading.medicines) {
      medicine.spoken = { yue: "用嚟治療。", cmn: "用来治疗。", en: "This treats it." };
    }
    let active = 0;
    let peak = 0;
    const signals: AbortSignal[] = [];
    const parent = new AbortController();
    const provider = {
      phrase: vi.fn(async (_input: unknown, options?: { signal?: AbortSignal }) => {
        active += 1;
        peak = Math.max(peak, active);
        if (options?.signal) signals.push(options.signal);
        return await new Promise<never>(() => {});
      }),
    };
    const promise = runReadingPipeline(reading, provider, { signal: parent.signal });
    await vi.advanceTimersByTimeAsync(10_001);
    const result = await promise;
    expect(result.kind).toBe("reading");
    if (result.kind !== "reading") return;
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.filter.templated).toBe(reading.medicines.length);
    expect(provider.phrase).toHaveBeenCalledTimes(2);
    expect(result.cards.every((card) => checkSpeakable(card.body).ok)).toBe(true);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects instead of completing when the parent signal aborts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reading = clone();
    reading.medicines[0].spoken = { yue: "用嚟治療。", cmn: "用来治疗。", en: "This treats it." };
    const provider = { phrase: vi.fn(async () => await new Promise<never>(() => {})) };
    const promise = runReadingPipeline(reading, provider, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps source, status and order when repairs complete in reverse order", async () => {
    const reading = clone();
    reading.medicines = reading.medicines.slice(0, 2);
    reading.medicines[1].status = "stopped";
    reading.medicines[0].source.quote = "A different printed name";
    for (const medicine of reading.medicines) {
      medicine.spoken = { yue: "治療", cmn: "治疗", en: "This treats it." };
    }
    type Result = Awaited<ReturnType<ModelProvider["phrase"]>>;
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, model: "test", ms: 0 };
    const finish: Array<(value: Result) => void> = [];
    const provider = { phrase: vi.fn(() => new Promise<Result>((resolve) => finish.push(resolve))) };
    const pending = runReadingPipeline(reading, provider);
    expect(finish).toHaveLength(2);
    const safe = { yue: "睇返張紙。", cmn: "请看纸。", en: "Check this line on the sheet." };
    finish[1]({ result: { spoken: safe }, usage });
    await Promise.resolve();
    finish[0]({ result: { spoken: safe }, usage });
    const result = await pending;
    expect(result.kind).toBe("reading");
    if (result.kind !== "reading") throw new Error("expected reading");
    expect(result.cards.map((card) => card.id)).toEqual(buildCards(reading).map((card) => card.id));
    expect(result.cards.find((card) => card.id === "medicine-0")).toMatchObject({ unverified: true, source: reading.medicines[0].source });
    expect(result.cards.find((card) => card.id === "medicine-1")).toMatchObject({ stopped: true, facts: { status: "stopped" }, source: reading.medicines[1].source });
    expect(result.filter).toEqual({ regenerated: 2, templated: 0 });
  });

});
