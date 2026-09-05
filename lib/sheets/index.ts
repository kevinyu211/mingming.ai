/**
 * One active sheet, its conversation and its counters. The import surface for the UI:
 *
 *   import { loadSheets, startSheet, appendMessage, takeDose, subscribeSheets } from "@/lib/sheets";
 *
 * The dose rules live in `@/lib/rules/doses` rather than here, because they are deterministic
 * rules with no storage in them at all (constitution III) and the server-side reading pipeline may
 * want them without dragging localStorage across the boundary.
 */
export { FALLBACK_TITLE, sheetTitle } from "@/lib/sheets/title";
import { getValidatedOrLegacyCards } from "@/lib/sheets/cards";
import type { Card } from "@/lib/domain/schemas";
import type { Sheet } from "@/lib/sheets/types";
export {
  ARCHIVE_LIMIT,
  SAME_LANDING_MS,
  appendMessage,
  loadSheets,
  startSheet,
  subscribeSheets,
  takeDose,
  updateActive,
} from "@/lib/sheets/store";
/** Returns the persisted card set, or the checked backward-compatible fallback. */
export function getSheetCards(sheet: Sheet): Card[] {
  return getValidatedOrLegacyCards(sheet);
}
export type {
  BriefPhase,
  CheckinState,
  DoseState,
  Sheet,
  SheetsState,
  ThreadMessage,
  ThreadWidget,
} from "@/lib/sheets/types";
