/**
 * On-device memory. Import surface for the UI:
 *
 *   import { memoryBrief, rememberExchange, rememberReading } from "@/lib/memory";
 *
 * Server code wants `MAX_BRIEF_CHARS` from `@/lib/memory/context` directly — this barrel pulls in
 * `lib/storage/local.ts`, which is harmless on the server but pointless there.
 */
export { MAX_BRIEF_CHARS, buildMemoryBrief } from "@/lib/memory/context";
export {
  appendExchange,
  appendReading,
  normaliseMemory,
  recapOf,
  summariseReading,
  type ExchangeInput,
} from "@/lib/memory/record";
export { loadMemory, memoryBrief, rememberExchange, rememberReading } from "@/lib/memory/store";
export {
  MAX_EXCHANGES,
  MAX_READINGS,
  REMEMBERED_OUTCOMES,
  emptyMemory,
  isRememberedOutcome,
  type ExchangeOutcome,
  type Memory,
  type RememberedExchange,
  type RememberedReading,
} from "@/lib/memory/types";
