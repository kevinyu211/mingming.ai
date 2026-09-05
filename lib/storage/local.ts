/**
 * On-device storage. Constitution principle V: nothing leaves the phone except the question.
 *
 * Everything the app remembers lives under a single localStorage key so that
 * `deleteEverything()` is provably complete (research.md R9). No IndexedDB, no cookies,
 * no analytics, no server. Client-safe: every entry point guards `typeof window`, so the
 * module can be imported from a server component without exploding.
 */
import type { Dialect, StoredReading } from "@/lib/domain/schemas";
import type { Memory } from "@/lib/memory/types";
import type { SheetsState } from "@/lib/sheets/types";

/** The one and only key. Bump the suffix if the shape ever changes incompatibly. */
export const KEY = "fitornot.v1";

/** The four animals already in `public/mascot/`. 明明's name never changes; only the body does. */
export const MASCOT_ANIMALS = ["cat", "panda", "puppy", "rabbit"] as const;
export type MascotAnimal = (typeof MASCOT_ANIMALS)[number];
export const DEFAULT_MASCOT: MascotAnimal = "panda";

export function isMascotAnimal(value: unknown): value is MascotAnimal {
  return typeof value === "string" && (MASCOT_ANIMALS as readonly string[]).includes(value);
}

/**
 * Coerce a stored (or missing) animal to a known one. Invalid values such as `"dragon"` become
 * the default panda rather than crashing a screen that just wants to draw 明明.
 */
export function readMascotAnimal(state: { mascotAnimal?: string }): MascotAnimal {
  return isMascotAnimal(state.mascotAnimal) ? state.mascotAnimal : DEFAULT_MASCOT;
}

/** Written form of Chinese. Defaults from the dialect, user-flippable. */
export type Script = "hant" | "hans";

/** Relationship label + output language. Never a name, never anything clinical. */
export interface Profile {
  /** Relationship label such as 阿媽 or 老豆. Max 12 characters, never a person's name. */
  label: string;
  dialect: Dialect;
  script: Script;
}

/**
 * The language of the interface, which is not the same thing as the dialect the parent hears.
 * `hant`/`hans` also decide which written form the card text is converted to; `en` leaves the
 * cards in the parent's own script, because the cards are what gets spoken to them.
 */
export type UiLocale = "hant" | "hans" | "en";

export interface PlanItem {
  kind: "appointment" | "medicineTime";
  label: string;
  /** Verbatim from the sheet: "2/52", "每日一次", a printed date. Never computed. */
  when: string;
  source: { section: string; lineIndex: number | null; quote: string };
}

export interface FollowUpPlan {
  items: PlanItem[];
  /** null until the user taps 確認. Nothing is persisted before that (FR-020). */
  confirmedAt: string | null;
  /** Only set when the rules could parse an unambiguous date from a source line. */
  followUpDate: string | null;
}

export interface StoredState {
  version: 1;
  consentedAt: string | null;
  /** Interface language. Top-level, not on the profile, so it can be set before setup runs. */
  uiLocale?: UiLocale;
  profile?: Profile;
  /**
   * Superseded by `sheets.active.reading`. Kept in the type as a one-way migration path: a phone
   * that stored a reading before the sheets block existed still has one here, and
   * `lib/sheets/store.ts` turns it into the active sheet on first load. The sheets layer only ever
   * READS these two; nothing writes them any more, and nothing may start depending on them again.
   */
  reading?: StoredReading;
  /** Superseded by `sheets.active.plan`. Same one-way migration path as `reading` above. */
  plan?: FollowUpPlan;
  /**
   * The one active sheet and the read-only history behind it (v2 build brief §5).
   *
   * It lives under this same key, like `memory`, so `deleteEverything()` below is still one
   * `removeItem` — "you can wipe it" stays a single provable move rather than a list of places to
   * remember. Every write goes through `saveState`, so `assertNoImageData` covers the thread and
   * the archive exactly as it covers everything else: a sheet can never carry its own photograph.
   *
   * Optional because a fresh phone has no sheets, and because `emptyState()` must keep returning
   * the two-field object the storage suite asserts byte for byte.
   */
  sheets?: SheetsState;
  /**
   * What the app remembers between sessions: the last few sheets read and the last few questions
   * asked (`lib/memory/`). It lives under this same key on purpose — `deleteEverything()` below
   * is still one `removeItem`, so "you can wipe it" stays a single provable move. Capped by the
   * memory layer, never holds an image, and holds nothing about the person.
   */
  memory?: Memory;
  /**
   * Which animal body 明明 wears. Optional so a fresh phone — and `emptyState()` — stay exactly
   * `{ version: 1, consentedAt: null }`. Missing or unknown values read as panda.
   */
  mascotAnimal?: MascotAnimal;
}

/** Keys that would mean an image is about to be written. The sheet photo is never stored (FR-018). */
const IMAGE_KEYS = new Set(["image", "images", "base64"]);

export class ImageDataRejectedError extends Error {
  constructor(path: string) {
    super(
      `Refusing to store image-like data at "${path}": the sheet photo is discarded after ` +
        `extraction and must never be persisted (constitution principle V, FR-018).`,
    );
    this.name = "ImageDataRejectedError";
  }
}

/**
 * Walks a value about to be persisted and throws if any object key is named
 * `image`, `images` or `base64` (any casing). Cheap, total, and impossible to forget
 * because every write funnels through `saveState`.
 */
export function assertNoImageData(value: unknown, path = "state"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoImageData(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (IMAGE_KEYS.has(key.toLowerCase())) throw new ImageDataRejectedError(`${path}.${key}`);
    assertNoImageData(entry, `${path}.${key}`);
  }
}

function emptyState(): StoredState {
  return { version: 1, consentedAt: null };
}

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Safari private mode and locked-down embedded browsers throw on access.
    return null;
  }
}

/** Reads the stored state. Returns a fresh empty state when absent, unreadable or a stale version. */
export function loadState(): StoredState {
  const s = store();
  if (!s) return emptyState();
  let raw: string | null;
  try {
    raw = s.getItem(KEY);
  } catch {
    return emptyState();
  }
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState> | null;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) return emptyState();
    const next: StoredState = { ...emptyState(), ...parsed, version: 1 };
    if (next.mascotAnimal !== undefined && !isMascotAnimal(next.mascotAnimal)) {
      delete next.mascotAnimal;
    }
    return next;
  } catch {
    return emptyState();
  }
}

/** Shallow-merges `partial` into the stored state and writes it back. Returns the new state. */
export function saveState(partial: Partial<StoredState>): StoredState {
  assertNoImageData(partial, "state");
  const next: StoredState = { ...loadState(), ...partial, version: 1 };
  const s = store();
  if (s) {
    try {
      s.setItem(KEY, JSON.stringify(next));
    } catch {
      // Quota or private mode: the session keeps working, nothing is persisted.
    }
  }
  notify(next);
  return next;
}

/** One-tap consent for the simulated-input notice (FR-015). */
export function setConsented(at: string = new Date().toISOString()): StoredState {
  return saveState({ consentedAt: at });
}

export function saveProfile(profile: Profile): StoredState {
  return saveState({ profile });
}

/** The interface language, remembered across sessions like every other preference. */
export function saveUiLocale(uiLocale: UiLocale): StoredState {
  return saveState({ uiLocale });
}

/** Which animal body 明明 wears. Lives under the same key as everything else. */
export function saveMascotAnimal(animal: MascotAnimal): StoredState {
  return saveState({ mascotAnimal: animal });
}

export function saveReading(reading: StoredReading): StoredState {
  return saveState({ reading });
}

export function savePlan(plan: FollowUpPlan): StoredState {
  return saveState({ plan });
}

/**
 * Writes the sheets block. Goes through `saveState` like everything else, so the image guard runs
 * over the whole of it — a thread message or an archived sheet that somehow carried a photograph
 * would throw rather than persist. `lib/sheets/store.ts` is the only intended caller.
 */
export function saveSheets(sheets: SheetsState): StoredState {
  return saveState({ sheets });
}

/**
 * Writes the memory block. Goes through `saveState`, so the image guard covers it too: a future
 * caller that tried to remember a thumbnail of the sheet would throw rather than persist it.
 * `lib/memory/store.ts` is the only intended caller.
 */
export function saveMemory(memory: Memory): StoredState {
  return saveState({ memory });
}

/** Removes the key entirely. This is the whole of "delete everything" (FR-017). */
export function deleteEverything(): StoredState {
  const s = store();
  if (s) {
    try {
      s.removeItem(KEY);
    } catch {
      // Nothing else to do: if we cannot remove it we cannot have written it either.
    }
  }
  const next = emptyState();
  notify(next);
  return next;
}

export type StorageListener = (state: StoredState) => void;

const listeners = new Set<StorageListener>();
let windowListenerAttached = false;

function notify(state: StoredState): void {
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch {
      // A broken subscriber must not break a write.
    }
  }
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== KEY) return;
  notify(loadState());
}

/**
 * Subscribes to state changes: writes made in this tab (via the functions above) and
 * writes made in another tab (the `storage` event). Returns an unsubscribe function.
 */
export function subscribe(listener: StorageListener): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined" && !windowListenerAttached) {
    window.addEventListener("storage", onStorageEvent);
    windowListenerAttached = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined" && windowListenerAttached) {
      window.removeEventListener("storage", onStorageEvent);
      windowListenerAttached = false;
    }
  };
}
