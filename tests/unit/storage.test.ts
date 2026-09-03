/**
 * On-device storage (constitution principle V). Runs against a minimal in-memory
 * localStorage + window shim so the module under test can stay client-only.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredReading } from "@/lib/domain/schemas";
import {
  KEY,
  deleteEverything,
  loadState,
  savePlan,
  saveProfile,
  saveReading,
  saveState,
  setConsented,
  subscribe,
  type FollowUpPlan,
  type Profile,
} from "@/lib/storage/local";

// --- minimal shims -------------------------------------------------------------------

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

type Handler = (event: { key: string | null }) => void;

const memory = new MemoryStorage();
const windowHandlers = new Map<string, Set<Handler>>();

const windowShim = {
  localStorage: memory as unknown as Storage,
  addEventListener(type: string, handler: Handler) {
    if (!windowHandlers.has(type)) windowHandlers.set(type, new Set());
    windowHandlers.get(type)?.add(handler);
  },
  removeEventListener(type: string, handler: Handler) {
    windowHandlers.get(type)?.delete(handler);
  },
};

/** Simulates a write from another tab. */
function fireStorageEvent(key: string | null) {
  for (const handler of windowHandlers.get("storage") ?? []) handler({ key });
}

beforeAll(() => {
  (globalThis as { window?: unknown }).window = windowShim;
});

beforeEach(() => {
  memory.clear();
  windowHandlers.clear();
});

// --- fixtures ------------------------------------------------------------------------

const profile: Profile = { label: "阿媽", dialect: "yue", script: "hant" };

const reading: StoredReading = {
  sheetType: "hk_en",
  warningSigns: [],
  medicines: [],
  followUp: [],
  dietLine: null,
  activityLine: null,
  hospitalContact: null,
  unreadable: [],
  readAt: "2026-09-02T02:00:00.000Z",
};

const plan: FollowUpPlan = {
  items: [
    {
      kind: "appointment",
      label: "SOPD",
      when: "2/52",
      source: { section: "Follow-up Plan", lineIndex: 3, quote: "SOPD 2/52" },
    },
  ],
  confirmedAt: null,
  followUpDate: null,
};

// --- tests ---------------------------------------------------------------------------

describe("loadState", () => {
  it("returns an empty consent-less state when nothing is stored", () => {
    expect(loadState()).toEqual({ version: 1, consentedAt: null });
  });

  it("ignores unparseable or wrong-version payloads instead of throwing", () => {
    memory.setItem(KEY, "{not json");
    expect(loadState()).toEqual({ version: 1, consentedAt: null });
    memory.setItem(KEY, JSON.stringify({ version: 99, consentedAt: "x", profile }));
    expect(loadState()).toEqual({ version: 1, consentedAt: null });
  });
});

describe("round trip", () => {
  it("stores and reads back consent, profile, reading and plan under one key", () => {
    setConsented("2026-09-02T01:00:00.000Z");
    saveProfile(profile);
    saveReading(reading);
    savePlan(plan);

    const state = loadState();
    expect(state.version).toBe(1);
    expect(state.consentedAt).toBe("2026-09-02T01:00:00.000Z");
    expect(state.profile).toEqual(profile);
    expect(state.reading).toEqual(reading);
    expect(state.plan).toEqual(plan);

    // Everything lives under exactly one key, which is what makes delete provably complete.
    expect(memory.length).toBe(1);
    expect(memory.key(0)).toBe(KEY);
  });

  it("survives a JSON round trip byte for byte", () => {
    saveReading(reading);
    const raw = memory.getItem(KEY) as string;
    expect(JSON.parse(raw).reading).toEqual(reading);
  });
});

describe("saveState merges", () => {
  it("keeps fields written by earlier calls", () => {
    saveProfile(profile);
    savePlan(plan);
    setConsented("2026-09-02T03:00:00.000Z");

    const state = loadState();
    expect(state.profile).toEqual(profile);
    expect(state.plan).toEqual(plan);
    expect(state.consentedAt).toBe("2026-09-02T03:00:00.000Z");
  });

  it("overwrites only the keys it is given", () => {
    saveProfile(profile);
    const updated: Profile = { ...profile, dialect: "cmn", script: "hans" };
    saveProfile(updated);
    expect(loadState().profile).toEqual(updated);
  });

  it("always writes version 1", () => {
    saveState({ version: 1, consentedAt: null });
    expect(JSON.parse(memory.getItem(KEY) as string).version).toBe(1);
  });
});

describe("deleteEverything", () => {
  it("removes the key entirely, not just its contents", () => {
    setConsented();
    saveProfile(profile);
    saveReading(reading);
    savePlan(plan);
    expect(memory.getItem(KEY)).not.toBeNull();

    deleteEverything();

    expect(memory.getItem(KEY)).toBeNull();
    expect(memory.length).toBe(0);
    expect(loadState()).toEqual({ version: 1, consentedAt: null });
  });
});

describe("image guard", () => {
  it("throws rather than persisting anything with an image-like key", () => {
    expect(() => saveState({ profile: { ...profile, image: "iVBOR" } as unknown as Profile })).toThrow(
      /image/i,
    );
    expect(() =>
      saveReading({ ...reading, images: ["a", "b"] } as unknown as StoredReading),
    ).toThrow(/image/i);
    expect(() =>
      saveReading({ ...reading, base64: "data:image/png;base64,AAA" } as unknown as StoredReading),
    ).toThrow(/image/i);
  });

  it("catches image keys nested deep inside a value", () => {
    const nested = {
      ...reading,
      unreadable: [
        {
          section: "Medication",
          description: "blurred",
          source: { section: "Medication", lineIndex: null, quote: "", base64: "AAA" },
        },
      ],
    } as unknown as StoredReading;
    expect(() => saveReading(nested)).toThrow(/base64/i);
  });

  it("writes nothing when the guard fires", () => {
    expect(() => saveReading({ ...reading, image: "AAA" } as unknown as StoredReading)).toThrow();
    expect(memory.getItem(KEY)).toBeNull();
  });

  it("allows ordinary keys that merely mention imaging in their value", () => {
    expect(() =>
      saveProfile({ ...profile, label: "image" } as Profile),
    ).not.toThrow();
  });
});

describe("subscribe", () => {
  it("notifies in-tab writes and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    saveProfile(profile);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].profile).toEqual(profile);

    deleteEverything();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0]).toEqual({ version: 1, consentedAt: null });

    unsubscribe();
    saveProfile(profile);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("notifies on a storage event from another tab, and ignores other keys", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    memory.setItem(KEY, JSON.stringify({ version: 1, consentedAt: null, profile }));
    fireStorageEvent(KEY);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].profile).toEqual(profile);

    fireStorageEvent("some.other.key");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
