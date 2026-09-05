/**
 * The only module that writes sheets (v2 build brief §5).
 *
 * Everything still lives under the single `fitornot.v1` key in `lib/storage/local.ts`, so
 * `deleteEverything()` remains one `removeItem` and every write here funnels through `saveState`
 * — which means `assertNoImageData` covers the thread, the doses and the archive exactly as it
 * covers everything else (constitution V). There is no second store, no IndexedDB and no cache.
 *
 * Client-safe: `lib/storage/local.ts` guards `typeof window`, so importing this from a server
 * component is inert rather than fatal. A read on the server returns an empty state.
 *
 * The invariant this module exists to hold is **one active sheet at a time**. Photographing a new
 * sheet archives the previous one with its counters frozen, and nothing here can mutate an
 * archived sheet: every mutator goes through `updateActive`, which touches `active` and nothing
 * else. That is what keeps 「張紙寫：每日兩次」 honest — a counter can only ever quote one page.
 */
import { doseTargets, localDay } from "@/lib/rules/doses";
import { draftPlan } from "@/lib/rules/plan-from-reading";
import { sheetTitle } from "@/lib/sheets/title";
import { InvalidReadingCardsError, validateReadingCards } from "@/lib/sheets/cards";
import type { Sheet, SheetsState, ThreadMessage } from "@/lib/sheets/types";
import type { Card, StoredReading } from "@/lib/domain/schemas";
import {
  loadState,
  saveSheets,
  subscribe,
  type StoredState,
  type UiLocale,
} from "@/lib/storage/local";

/**
 * How many old sheets 以前嘅 keeps. The archive is history, not a filing cabinet: five is more
 * than a family refers back to, and an unbounded list would grow one whole reading per
 * photograph inside a single localStorage key that also has to stay under quota.
 */
export const ARCHIVE_LIMIT = 5;

/** Makes ids unique within a session; `capturedAt` already separates them across sessions. */
let sequence = 0;

/** A fresh sheet id. Opaque and stable once written — the UI keys threads and rows off it. */
function nextId(): string {
  sequence += 1;
  return `sheet-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

/**
 * The interface language the title should be written in. The interface locale comes first because
 * the title is read on screen; the profile's script is the fallback for a phone that was set up
 * before `uiLocale` existed, and traditional Chinese is the default the product ships in.
 */
function localeOf(state: StoredState): UiLocale {
  return state.uiLocale ?? state.profile?.script ?? "hant";
}

/** A whole, non-negative page count. Anything else is treated as "not known" rather than guessed. */
function pageCountOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * Turns a pre-v2 `StoredState` into the active sheet.
 *
 * A phone that read a sheet before this redesign has a `reading` and possibly a `plan` sitting at
 * the top level of the stored state and no `sheets` block at all. Losing that on upgrade would
 * mean a family opening the app to an empty 記錄 with their sheet gone, so the old fields are read
 * back into a sheet instead. The id is derived from `readAt`, not generated, so calling
 * `loadSheets()` twice before anything is written returns the same sheet rather than two.
 *
 * `pageCount` is 0 because a pre-v2 reading never recorded how many pages it came from. Claiming
 * "1 頁" would be inventing a fact about a medical document to make a chip look tidier
 * (constitution IV); the shell omits the count when it is 0.
 */
function migratedSheet(state: StoredState): Sheet | null {
  const reading = state.reading;
  if (!reading) return null;
  const capturedAt = typeof reading.readAt === "string" ? reading.readAt : "";
  return {
    id: `sheet-migrated-${capturedAt}`,
    capturedAt,
    pageCount: 0,
    title: sheetTitle(reading, localeOf(state)),
    reading,
    // The stored `FollowUpPlan` carries `confirmedAt` on top of a `DraftPlan`, which is harmless
    // here; a phone that stored a reading but never confirmed a plan gets one derived by rule.
    plan: state.plan ?? draftPlan(reading),
    thread: [],
    doses: {},
    briefing: { phase: "idle", step: 0 },
    checkin: "none",
    archivedAt: null,
  };
}

/**
 * The sheets held by one stored state, migrating a pre-v2 one on the way past.
 *
 * Deliberately side-effect free: a read never writes. The migrated sheet is materialised again on
 * every load until the first real mutation persists it, which costs nothing and means merely
 * opening the app cannot corrupt an old state.
 */
function sheetsOf(state: StoredState): SheetsState {
  const stored = state.sheets;
  if (stored) {
    return {
      active: stored.active ?? null,
      archive: Array.isArray(stored.archive) ? [...stored.archive] : [],
    };
  }
  return { active: migratedSheet(state), archive: [] };
}

/** The active sheet and the read-only history behind it. Empty on a fresh phone. */
export function loadSheets(): SheetsState {
  return sheetsOf(loadState());
}

/**
 * How long after a sheet is started a second identical call still counts as the same landing.
 *
 * Generous next to the thing it is catching — a remount races in milliseconds — and far short of
 * anything a person would do deliberately. A minute later with nothing said and no dose counted is
 * still the same arrival at the same page.
 */
export const SAME_LANDING_MS = 60_000;

/** The reading's fields except `readAt`, for comparing two reads of the same pages. */
function contentOf(reading: StoredReading): string {
  // `readAt` is stamped per call — `loadSampleReading` re-stamps it on every load — so the two
  // calls in one landing differ there and nowhere else. Comparing it would defeat the check
  // entirely, which is exactly what happened the first time this guard was written.
  const rest: Record<string, unknown> = { ...reading };
  delete rest.readAt;
  return JSON.stringify(rest);
}

/**
 * True when `reading` is the sheet that is already active AND nothing has happened on it yet.
 *
 * "Nothing has happened" is the important half: an untouched sheet is indistinguishable from one
 * just created, so re-making it loses nothing, while a sheet with a thread or a counted dose holds
 * work that archiving would freeze and a fresh start would abandon.
 *
 * The time bound is what keeps a genuine re-photograph separate. Read the same paper again next
 * week and the plan should re-anchor on today, so that has to be a new sheet even though the
 * pages are identical.
 */
function isSameLanding(
  active: Sheet,
  reading: StoredReading,
  pageCount: number,
  now: number,
  activeIsMigrated: boolean,
): boolean {
  if (active.thread.length > 0) return false;
  if (Object.keys(active.doses).length > 0) return false;
  if (contentOf(active.reading) !== contentOf(reading)) return false;

  // A migrated sheet is not a stored sheet at all — it is a view materialised out of the legacy
  // top-level `reading` field, rebuilt on every `loadSheets()` and never written. When its content
  // IS the reading being started, it is not a previous sheet to archive; it is the same page
  // arriving through the old field, and archiving it manufactures a duplicate out of nothing.
  //
  // The two checks below are skipped for it deliberately. Its `pageCount` is always 0 because a
  // pre-v2 state never recorded one, and its `capturedAt` is the OLD reading's `readAt`, which can
  // be days back — so an age bound would reject exactly the case that needs catching.
  if (activeIsMigrated) return true;

  // 0 means "not known" (`pageCountOf`), and a count that was never recorded cannot contradict one.
  const known = active.pageCount !== 0 && pageCountOf(pageCount) !== 0;
  if (known && active.pageCount !== pageCountOf(pageCount)) return false;

  const age = now - Date.parse(active.capturedAt);
  return Number.isFinite(age) && age >= 0 && age <= SAME_LANDING_MS;
}

/**
 * Makes a newly read sheet the active one and archives the previous one read-only (只可以睇).
 *
 * The outgoing sheet is stamped with `archivedAt` and moved to the front of the archive with its
 * thread and its counters exactly as they stood. It is not deleted — the family may still want to
 * see what the last sheet said — but nothing in this module will ever write to it again, so a
 * counter can never drift away from the page it was quoting. The archive keeps the newest
 * `ARCHIVE_LIMIT` and drops the oldest.
 */
export function startSheet(
  reading: StoredReading,
  pageCount: number,
  validatedCards?: Card[],
): Sheet {
  const canonicalCards =
    validatedCards === undefined ? undefined : validateReadingCards(reading, validatedCards);
  if (validatedCards !== undefined && canonicalCards === null) {
    throw new InvalidReadingCardsError();
  }

  const state = loadState();
  const current = sheetsOf(state);
  const capturedAt = new Date().toISOString();

  // One landing can call this twice. `app/chat/page.tsx` guards with a `useRef`, and a ref does
  // not survive a remount — the page can be remounted while the sample import or the read is
  // still in flight, and the second pass starts the same sheet again. The visible damage is
  // precisely the thing this module exists to prevent: 記錄 shows 「以前嘅 (1)」 after the very
  // first photograph, and the five-sheet archive fills at double rate.
  //
  // So the invariant lives here rather than in the caller, where it cannot be raced: starting a
  // sheet identical to the active one, while nothing has yet been said about it and no dose has
  // been counted, is the SAME landing and returns the sheet already made. Once the conversation
  // has started or a dose has been taken, an identical reading is a genuine re-photograph and is
  // archived normally — the family really may shoot the same page twice.
  const activeIsMigrated = state.sheets === undefined;
  const same =
    current.active !== null &&
    isSameLanding(current.active, reading, pageCount, Date.parse(capturedAt), activeIsMigrated);

  // A stored sheet that is the same landing is returned as it stands: it has an id the UI is
  // already keyed to, and remaking it would restart the briefing.
  if (same && !activeIsMigrated) return current.active as Sheet;

  // A MIGRATED one is different. It is a view rather than a stored sheet, and it carries no page
  // count because a pre-v2 state never recorded one — so it is not returned, it is simply not
  // treated as a previous sheet. The real sheet is built below and supersedes it, with the page
  // count this landing actually knows.
  const archive =
    current.active === null || same
      ? current.archive
      : [{ ...current.active, archivedAt: capturedAt }, ...current.archive];

  const sheet: Sheet = {
    id: nextId(),
    capturedAt,
    pageCount: pageCountOf(pageCount),
    title: sheetTitle(reading, localeOf(state)),
    reading,
    ...(canonicalCards == null ? {} : { validatedCards: canonicalCards }),
    plan: draftPlan(reading),
    thread: [],
    doses: {},
    briefing: { phase: "idle", step: 0 },
    checkin: "none",
    archivedAt: null,
  };

  saveSheets({ active: sheet, archive: archive.slice(0, ARCHIVE_LIMIT) });
  return sheet;
}

/**
 * Applies a patch to the active sheet and persists it. Returns the new sheet, or null when there
 * is no active sheet to patch.
 *
 * This is the single write path for an existing sheet, which is what makes the archive safe: no
 * caller can reach an archived sheet through it. `id` and `capturedAt` are re-applied after the
 * patch — which sheet this is, and when it was photographed, are not things an update may change.
 */
export function updateActive(patch: (sheet: Sheet) => Partial<Sheet>): Sheet | null {
  const { active, archive } = sheetsOf(loadState());
  if (active === null) return null;
  const next: Sheet = {
    ...active,
    ...patch(active),
    id: active.id,
    capturedAt: active.capturedAt,
  };
  saveSheets({ active: next, archive });
  return next;
}

/**
 * Appends one line to the active sheet's thread. The store owns `id` and `at` so a caller cannot
 * accidentally reuse an id: the index within the thread is unique because a thread only ever
 * grows.
 */
export function appendMessage(message: Omit<ThreadMessage, "id" | "at">): Sheet | null {
  const at = new Date().toISOString();
  return updateActive((sheet) => ({
    thread: [
      ...sheet.thread,
      { ...message, id: `${sheet.id}-m${sheet.thread.length}`, at },
    ],
  }));
}

/**
 * Records that one dose has been taken, today.
 *
 * Three things this does not do, each of them a rule rather than an omission:
 *
 * - It **refuses** for a target the page stopped, for an as-needed target, and for a clause whose
 *   frequency could not be read. A withdrawn drug is not a dose (constitution VIII), and counting
 *   down something the page never counted would be inventing a schedule. The refusal is a no-op:
 *   the unchanged sheet comes back, so a caller cannot mistake it for "there is no sheet".
 * - It **resets** when the stored count belongs to another local calendar day. A new day starts
 *   at nothing taken, without a timer having to fire overnight.
 * - It **clamps** at the target's total, so tapping 食咗 twice on a once-a-day medicine cannot
 *   produce a count the page does not support.
 *
 * `today` is a parameter, never `new Date()` inside a rule, so the daily reset is testable.
 */
export function takeDose(key: string, today: Date): Sheet | null {
  const { active } = sheetsOf(loadState());
  if (active === null) return null;

  const target = doseTargets(active.reading).find((t) => t.key === key);
  if (!target || target.stopped || target.asNeeded || target.total <= 0) return active;

  const day = localDay(today);
  const current = active.doses[key];
  const takenToday = current !== undefined && current.day === day ? Math.max(0, current.taken) : 0;
  const taken = Math.min(target.total, takenToday + 1);

  return updateActive((sheet) => ({
    doses: { ...sheet.doses, [key]: { key, taken, day } },
  }));
}

/**
 * Subscribes to sheet changes: writes made here and writes made in another tab, on top of the
 * existing `subscribe` in `lib/storage/local.ts` so there is still one listener set and one
 * `storage` handler. Like `subscribe`, it does not fire on subscription — call `loadSheets()` for
 * the current value. Returns an unsubscribe function.
 */
export function subscribeSheets(fn: (value: SheetsState) => void): () => void {
  return subscribe((state) => fn(sheetsOf(state)));
}
