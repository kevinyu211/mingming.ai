/**
 * Memory on the device: the four calls the UI makes.
 *
 * Client-safe — everything funnels through `lib/storage/local.ts`, which guards `typeof window`,
 * so importing this from a server component is inert rather than fatal. No `fetch`, no `console`,
 * no timers: the memory layer never talks to anything.
 *
 *   after a read      → `rememberReading(reading, dialect)`
 *   after an answer   → `rememberExchange({ question, outcome, citedCardId })`
 *   before asking     → `memoryBrief()` → pass as `memory` to `ask()`
 *   settings          → nothing to add; `deleteEverything()` already takes the whole key
 */
import type { Dialect, StoredReading } from "@/lib/domain/schemas";
import { buildMemoryBrief } from "@/lib/memory/context";
import {
  appendExchange,
  appendReading,
  normaliseMemory,
  summariseReading,
  type ExchangeInput,
} from "@/lib/memory/record";
import { isRememberedOutcome, type Memory } from "@/lib/memory/types";
import { loadState, saveMemory, type StoredState } from "@/lib/storage/local";

/** The stored memory, repaired into a usable shape. Empty on a fresh phone. */
export function loadMemory(): Memory {
  return normaliseMemory(loadState().memory);
}

/**
 * Records a sheet that has just been read. Safe to call on every save of the same reading: the
 * entry is keyed on `readAt`, so re-entering `/read` from `/ask` updates rather than duplicates.
 */
export function rememberReading(reading: StoredReading, dialect: Dialect): StoredState {
  return saveMemory(appendReading(loadMemory(), summariseReading(reading, dialect)));
}

/**
 * Records one question and what came of it. Outcomes that are not worth remembering are ignored
 * rather than rejected, so the caller can hand over `result.outcome` unchecked:
 *
 * - `crisis_referral` — never stored. That question never left the phone and never will.
 * - `bad_request` / `model_unavailable` — nothing happened; there is nothing to be continuous
 *   about, and a remembered failure would only crowd out a real exchange.
 */
export function rememberExchange(input: {
  question: string;
  outcome: string;
  citedCardId?: string | null;
  askedAt?: string;
}): StoredState {
  if (!isRememberedOutcome(input.outcome)) return loadState();
  const entry: ExchangeInput = {
    question: input.question,
    outcome: input.outcome,
    citedCardId: input.citedCardId ?? null,
    askedAt: input.askedAt,
  };
  return saveMemory(appendExchange(loadMemory(), entry));
}

/** The brief to send with the next question, or "" when there is nothing to say. */
export function memoryBrief(): string {
  return buildMemoryBrief(loadMemory());
}
