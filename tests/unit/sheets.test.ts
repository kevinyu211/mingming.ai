/**
 * One active sheet, its conversation and its counters (v2 build brief §5).
 *
 * Runs against the same minimal in-memory localStorage + window shim the storage suite uses, so
 * the modules under test stay client-only. TZ=Asia/Hong_Kong is pinned in vitest.config.mts,
 * which is what makes the daily-reset tests below mean anything: they roll the calendar forward
 * by moving `today`, never by touching the system clock.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Medicine, StoredReading } from "@/lib/domain/schemas";
import { remaining, doseTargets } from "@/lib/rules/doses";
import {
  ARCHIVE_LIMIT,
  SAME_LANDING_MS,
  FALLBACK_TITLE,
  appendMessage,
  loadSheets,
  sheetTitle,
  startSheet,
  subscribeSheets,
  takeDose,
  updateActive,
} from "@/lib/sheets";
import type { Sheet, ThreadMessage } from "@/lib/sheets";
import { KEY, deleteEverything, loadState, saveState, type FollowUpPlan } from "@/lib/storage/local";

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

beforeAll(() => {
  (globalThis as { window?: unknown }).window = windowShim;
});

beforeEach(() => {
  memory.clear();
  windowHandlers.clear();
});

// --- fixtures ------------------------------------------------------------------------

const SOURCE = { section: "Medications", lineIndex: 0, quote: "Metoprolol 25mg BD" };
const SPOKEN = { yue: "", cmn: "", en: "" };

function medicine(overrides: Partial<Medicine> = {}): Medicine {
  return {
    name: "Metoprolol",
    strength: "25mg",
    amount: "1 粒",
    frequency: "每日兩次，隨餐",
    duration: null,
    status: "current",
    spoken: SPOKEN,
    source: SOURCE,
    ...overrides,
  };
}

function reading(overrides: Partial<StoredReading> = {}): StoredReading {
  return {
    sheetType: "hk_en",
    warningSigns: [],
    medicines: [medicine()],
    followUp: [],
    dietLine: null,
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
    readAt: "2026-09-01T02:00:00.000Z",
    ...overrides,
  };
}

function contact(text: string) {
  return { text, spoken: SPOKEN, source: { section: "Contact", lineIndex: 0, quote: text } };
}

function followUp(clinic: string | null) {
  return {
    clinic,
    when: "2/52",
    tests: null,
    spoken: SPOKEN,
    source: { section: "Follow-up", lineIndex: 0, quote: clinic ?? "" },
  };
}

/** Midday in Hong Kong on the 3rd, and midday on the 4th. */
const DAY_3 = new Date("2026-09-03T04:00:00.000Z");
const DAY_4 = new Date("2026-09-04T04:00:00.000Z");

function agentLine(text: string): Omit<ThreadMessage, "id" | "at"> {
  return { role: "agent", text, origin: "rule" };
}

// --- starting and archiving ----------------------------------------------------------

describe("loadSheets", () => {
  it("is empty on a fresh phone", () => {
    expect(loadSheets()).toEqual({ active: null, archive: [] });
  });
});

describe("startSheet", () => {
  it("makes the new sheet active, with an empty conversation and no counters yet", () => {
    const sheet = startSheet(reading({ hospitalContact: contact("威爾斯親王醫院 心臟科") }), 3);

    expect(sheet.pageCount).toBe(3);
    expect(sheet.title).toBe("威爾斯親王醫院 心臟科");
    expect(sheet.thread).toEqual([]);
    expect(sheet.doses).toEqual({});
    expect(sheet.briefing).toEqual({ phase: "idle", step: 0 });
    expect(sheet.checkin).toBe("none");
    expect(sheet.archivedAt).toBeNull();
    // The plan is derived by rule from the reading, never carried over from anywhere.
    expect(sheet.plan.items).toHaveLength(1);
    expect(sheet.plan.items[0].when).toBe("每日兩次，隨餐");

    expect(loadSheets().active).toEqual(sheet);
    expect(loadSheets().archive).toEqual([]);
  });

  it("keeps everything under the one key, so delete stays one removeItem", () => {
    startSheet(reading(), 1);
    appendMessage(agentLine("我睇完你張紙。"));
    takeDose("m0", DAY_3);

    expect(memory.length).toBe(1);
    expect(memory.key(0)).toBe(KEY);

    deleteEverything();
    expect(memory.getItem(KEY)).toBeNull();
    expect(loadSheets()).toEqual({ active: null, archive: [] });
  });

  it("claims no page count when it was given a nonsensical one, rather than inventing one", () => {
    expect(startSheet(reading(), 0).pageCount).toBe(0);
    expect(startSheet(reading(), -2).pageCount).toBe(0);
    expect(startSheet(reading(), Number.NaN).pageCount).toBe(0);
  });

  /**
   * The load-bearing rule: photographing a new sheet archives the previous one read-only with its
   * counters frozen. A counter that kept moving would be counting against a page nobody is
   * holding any more, and 「張紙寫：每日兩次」 would stop being true.
   */
  it("archives the previous sheet, stamped and frozen exactly as it stood", () => {
    const first = startSheet(reading({ hospitalContact: contact("廣華醫院 內科") }), 2);
    appendMessage(agentLine("最緊要嘅先講。"));
    takeDose("m0", DAY_3);

    const before = loadSheets().active as Sheet;
    expect(before.doses.m0.taken).toBe(1);
    expect(before.thread).toHaveLength(1);

    const second = startSheet(reading({ hospitalContact: contact("瑪麗醫院 眼科") }), 1);

    const { active, archive } = loadSheets();
    expect(active?.id).toBe(second.id);
    expect(archive).toHaveLength(1);
    expect(archive[0].id).toBe(first.id);
    expect(archive[0].archivedAt).toBe(second.capturedAt);
    expect(archive[0].doses).toEqual(before.doses);
    expect(archive[0].thread).toEqual(before.thread);

    // Working on the new sheet cannot reach back into the archived one.
    takeDose("m0", DAY_3);
    appendMessage(agentLine("你有一隻藥。"));
    const after = loadSheets();
    expect(after.archive[0]).toEqual(archive[0]);
    expect(after.active?.doses.m0.taken).toBe(1);
    expect(after.active?.thread).toHaveLength(1);
  });

  it("caps the archive at five and drops the oldest", () => {
    const ids: string[] = [];
    for (let n = 1; n <= 7; n += 1) {
      ids.push(startSheet(reading({ hospitalContact: contact(`醫院 ${n}`) }), 1).id);
    }

    const { active, archive } = loadSheets();
    expect(active?.id).toBe(ids[6]);
    expect(archive).toHaveLength(ARCHIVE_LIMIT);
    // Newest first, and the two oldest sheets are gone.
    expect(archive.map((s) => s.id)).toEqual([ids[5], ids[4], ids[3], ids[2], ids[1]]);
    expect(archive.map((s) => s.id)).not.toContain(ids[0]);
  });
});

// --- the conversation ----------------------------------------------------------------

describe("appendMessage", () => {
  it("stamps each line with an id and a time and appends it in order", () => {
    startSheet(reading(), 1);
    appendMessage(agentLine("我睇完你張紙。"));
    const sheet = appendMessage({ role: "user", text: "食咗", origin: "user" }) as Sheet;

    expect(sheet.thread).toHaveLength(2);
    expect(sheet.thread[0].text).toBe("我睇完你張紙。");
    expect(sheet.thread[1].role).toBe("user");
    expect(new Set(sheet.thread.map((m) => m.id)).size).toBe(2);
    for (const message of sheet.thread) {
      expect(message.id.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(message.at))).toBe(false);
    }
  });

  it("returns null when there is no active sheet to talk about", () => {
    expect(appendMessage(agentLine("hello"))).toBeNull();
    expect(updateActive(() => ({ checkin: "pending" }))).toBeNull();
  });

  it("cannot change which sheet is being talked about", () => {
    const sheet = startSheet(reading(), 1);
    const patched = updateActive(() => ({
      id: "somewhere-else",
      capturedAt: "1999-01-01T00:00:00.000Z",
      checkin: "pending",
    })) as Sheet;
    expect(patched.id).toBe(sheet.id);
    expect(patched.capturedAt).toBe(sheet.capturedAt);
    expect(patched.checkin).toBe("pending");
  });

  it("still refuses to persist anything image-like, wherever it is hidden", () => {
    startSheet(reading(), 1);
    const withImage = { ...agentLine("here"), image: "iVBOR" } as unknown as Omit<
      ThreadMessage,
      "id" | "at"
    >;
    expect(() => appendMessage(withImage)).toThrow(/image/i);
    // The write is refused whole: the thread is untouched.
    expect(loadSheets().active?.thread).toEqual([]);
  });
});

// --- counting doses ------------------------------------------------------------------

describe("takeDose", () => {
  it("counts one dose and clamps at what the page printed", () => {
    startSheet(reading(), 1);

    expect((takeDose("m0", DAY_3) as Sheet).doses.m0).toEqual({
      key: "m0",
      taken: 1,
      day: "2026-09-03",
    });
    expect((takeDose("m0", DAY_3) as Sheet).doses.m0.taken).toBe(2);
    // 每日兩次 is two; a third tap cannot produce a count the page does not support.
    expect((takeDose("m0", DAY_3) as Sheet).doses.m0.taken).toBe(2);
  });

  /**
   * The daily reset, write side. Nothing fires overnight: the stored count carries the day it
   * belongs to, so the first tap on a new local day starts again from one and `remaining` reads
   * the full count until then.
   */
  it("starts again at zero on a new local calendar day", () => {
    startSheet(reading(), 1);
    takeDose("m0", DAY_3);
    takeDose("m0", DAY_3);

    const [target] = doseTargets(reading());
    const spent = loadSheets().active as Sheet;
    expect(remaining(target, spent.doses.m0, DAY_3)).toBe(0);

    // Same stored count, one local day later: the counter is back to full before anything is tapped.
    expect(remaining(target, spent.doses.m0, DAY_4)).toBe(2);

    const tomorrow = takeDose("m0", DAY_4) as Sheet;
    expect(tomorrow.doses.m0).toEqual({ key: "m0", taken: 1, day: "2026-09-04" });
    expect(remaining(target, tomorrow.doses.m0, DAY_4)).toBe(1);
  });

  it("refuses a stopped medicine outright — it is never a dose", () => {
    startSheet(
      reading({
        medicines: [medicine({ name: "Digoxin", frequency: "每日一次", status: "stopped" })],
      }),
      1,
    );

    const sheet = takeDose("m0", DAY_3) as Sheet;
    expect(sheet.doses).toEqual({});
    expect(loadSheets().active?.doses).toEqual({});
  });

  it("refuses an as-needed medicine and one whose clause it could not read", () => {
    startSheet(
      reading({
        medicines: [medicine({ frequency: "痛先食" }), medicine({ frequency: "每四小時一次" })],
      }),
      1,
    );

    expect((takeDose("m0", DAY_3) as Sheet).doses).toEqual({});
    expect((takeDose("m1", DAY_3) as Sheet).doses).toEqual({});
  });

  it("ignores a key that is not on this sheet, and says so by changing nothing", () => {
    const sheet = startSheet(reading(), 1);
    expect((takeDose("m9", DAY_3) as Sheet).id).toBe(sheet.id);
    expect(loadSheets().active?.doses).toEqual({});
  });

  it("returns null when there is no sheet at all", () => {
    expect(takeDose("m0", DAY_3)).toBeNull();
  });
});

// --- subscription --------------------------------------------------------------------

describe("subscribeSheets", () => {
  it("notifies on every write and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSheets(listener);

    const sheet = startSheet(reading(), 1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].active.id).toBe(sheet.id);

    appendMessage(agentLine("我睇完你張紙。"));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].active.thread).toHaveLength(1);

    unsubscribe();
    appendMessage(agentLine("仲有一樣。"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

// --- migration from a pre-v2 phone ---------------------------------------------------

describe("migration from a state written before the sheets block existed", () => {
  const legacyReading = reading({
    hospitalContact: contact("瑪麗醫院 心內科門診，薄扶林道 102 號"),
  });

  const legacyPlan: FollowUpPlan = {
    items: [
      {
        kind: "appointment",
        label: "SOPD",
        when: "2/52",
        source: { section: "Follow-up Plan", lineIndex: 3, quote: "SOPD 2/52" },
      },
    ],
    confirmedAt: "2026-09-01T03:00:00.000Z",
    followUpDate: "2026-09-15",
  };

  function writeLegacyState(plan?: FollowUpPlan) {
    memory.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        consentedAt: "2026-09-01T01:00:00.000Z",
        profile: { label: "阿媽", dialect: "yue", script: "hant" },
        reading: legacyReading,
        ...(plan ? { plan } : {}),
      }),
    );
  }

  it("turns the old reading and plan into the active sheet", () => {
    writeLegacyState(legacyPlan);

    const { active, archive } = loadSheets();
    expect(archive).toEqual([]);
    expect(active?.reading).toEqual(legacyReading);
    expect(active?.plan.items).toEqual(legacyPlan.items);
    expect(active?.plan.followUpDate).toBe("2026-09-15");
    expect(active?.capturedAt).toBe(legacyReading.readAt);
    expect(active?.title).toBe("瑪麗醫院 心內科門診");
    expect(active?.thread).toEqual([]);
    expect(active?.archivedAt).toBeNull();
    // A pre-v2 reading never recorded how many pages it came from, so the sheet claims none.
    expect(active?.pageCount).toBe(0);
  });

  it("derives a plan by rule when the old state never confirmed one", () => {
    writeLegacyState();
    expect(loadSheets().active?.plan.items).toHaveLength(1);
    expect(loadSheets().active?.plan.items[0].kind).toBe("medicineTime");
  });

  it("reads without writing, and gives the same sheet every time", () => {
    writeLegacyState(legacyPlan);
    const raw = memory.getItem(KEY);

    const first = loadSheets().active as Sheet;
    const second = loadSheets().active as Sheet;
    expect(second.id).toBe(first.id);
    expect(memory.getItem(KEY)).toBe(raw);
  });

  it("persists the migrated sheet on the first write, and loses nothing on the way", () => {
    writeLegacyState(legacyPlan);
    const migrated = loadSheets().active as Sheet;

    const withMessage = appendMessage(agentLine("我睇完你張紙。")) as Sheet;
    expect(withMessage.id).toBe(migrated.id);

    const state = loadState();
    expect(state.sheets?.active?.thread).toHaveLength(1);
    expect(state.sheets?.active?.reading).toEqual(legacyReading);
    // The old fields stay where they were: this is a one-way read, not a move.
    expect(state.reading).toEqual(legacyReading);
    expect(state.consentedAt).toBe("2026-09-01T01:00:00.000Z");
    expect(state.profile?.label).toBe("阿媽");
  });

  it("counts the migrated sheet's medicines like any other", () => {
    writeLegacyState(legacyPlan);
    const sheet = takeDose("m0", DAY_3) as Sheet;
    expect(sheet.doses.m0).toEqual({ key: "m0", taken: 1, day: "2026-09-03" });
  });

  it("does not run again once a sheets block exists", () => {
    writeLegacyState(legacyPlan);
    const first = startSheet(reading({ hospitalContact: contact("廣華醫院 內科") }), 2);

    // The legacy reading is still at the top level, but it is not resurrected as a second sheet.
    const { active, archive } = loadSheets();
    expect(active?.id).toBe(first.id);
    expect(archive).toHaveLength(1);
    expect(archive[0].reading).toEqual(legacyReading);
  });

  it("is empty rather than broken when the old state had no reading either", () => {
    memory.setItem(KEY, JSON.stringify({ version: 1, consentedAt: null }));
    expect(loadSheets()).toEqual({ active: null, archive: [] });
  });
});

// --- the title -----------------------------------------------------------------------

describe("sheetTitle", () => {
  it("uses the hospital contact line, cut at the first punctuation", () => {
    const r = reading({ hospitalContact: contact("瑪麗醫院 心內科門診，薄扶林道 102 號") });
    expect(sheetTitle(r, "hant")).toBe("瑪麗醫院 心內科門診");
  });

  it("keeps a middle dot and a hyphen, which sit inside a name rather than ending it", () => {
    expect(sheetTitle(reading({ hospitalContact: contact("瑪麗醫院 · 心內科") }), "hant")).toBe(
      "瑪麗醫院 · 心內科",
    );
    expect(
      sheetTitle(reading({ hospitalContact: contact("Queen Mary Hospital - Cardiology") }), "en"),
    ).toBe("Queen Mary Hospital - Cardiology");
  });

  it("takes only the first line, because the second line is the street", () => {
    const r = reading({ hospitalContact: contact("\n 廣華醫院 內科 \n窩打老道 25 號\n") });
    expect(sheetTitle(r, "hant")).toBe("廣華醫院 內科");
  });

  it("falls back to the first clinic the page printed", () => {
    const r = reading({ followUp: [followUp(null), followUp("  眼科門診  ")] });
    expect(sheetTitle(r, "hant")).toBe("眼科門診");
  });

  /**
   * The clinic beats the contact line, and this is why: `hospitalContact` is a CONTACT block, and
   * on every fixture we have it is a phone number wearing a label. Preferring it titled the
   * English sheet "Ward enquiries" and both Chinese sheets 「联系电话」 — the sheet named after its
   * own phone number. The clinic is what the paper is about, and it is what the canvas puts in the
   * header. Both values here are the real strings from `fixtures/sheets/`.
   */
  it("prefers the clinic over a contact line that is really a phone number", () => {
    const hk = reading({
      hospitalContact: contact("Ward enquiries: 2xxx xxxx"),
      followUp: [followUp("SOPD")],
    });
    expect(sheetTitle(hk, "en")).toBe("SOPD");

    const cn = reading({
      hospitalContact: contact("联系电话：0XXX-XXXXXXX（心内科病房）"),
      followUp: [followUp("心内科门诊")],
    });
    expect(sheetTitle(cn, "hans")).toBe("心内科门诊");
  });

  /** With no clinic printed, the contact line is still better than the fixed word. */
  it("still uses the contact line when the page printed no clinic", () => {
    const r = reading({ hospitalContact: contact("威爾斯親王醫院 心臟科") });
    expect(sheetTitle(r, "hant")).toBe("威爾斯親王醫院 心臟科");
  });

  /**
   * The prototype files every sheet under 「瑪麗醫院 · 心內科」. That is fixture text on a mock, not
   * a promise: a page that names no hospital and no clinic gets the fixed word for what the thing
   * is, and no name at all.
   */
  it("uses the fixed title, in the reader's own language, when the page named nothing", () => {
    const bare = reading();
    expect(sheetTitle(bare, "hant")).toBe("出院紙");
    expect(sheetTitle(bare, "hans")).toBe("出院纸");
    expect(sheetTitle(bare, "en")).toBe("Discharge sheet");
    expect(sheetTitle(bare, "hant")).not.toContain("瑪麗");
  });

  it("falls back rather than throwing when there is no reading yet", () => {
    expect(sheetTitle(null, "hant")).toBe("出院紙");
    expect(sheetTitle(undefined, "en")).toBe("Discharge sheet");
  });

  it("ignores blank contact and clinic lines instead of titling a sheet with whitespace", () => {
    const r = reading({ hospitalContact: contact("   \n  "), followUp: [followUp("   ")] });
    expect(sheetTitle(r, "hans")).toBe("出院纸");
  });

  /**
   * The invariant, over every shape above at once: a title is either the fixed string or text the
   * page actually printed. It is never assembled, never translated and never guessed, so it can
   * be checked against the paper character for character.
   */
  it("never returns a name that is not printed in hospitalContact or followUp", () => {
    const cases: StoredReading[] = [
      reading(),
      reading({ hospitalContact: contact("瑪麗醫院 心內科門診，薄扶林道 102 號") }),
      reading({ hospitalContact: contact("Queen Mary Hospital (Cardiology), 102 Pokfulam Road") }),
      reading({ hospitalContact: contact("   "), followUp: [followUp("內科門診")] }),
      reading({ followUp: [followUp(null)] }),
      reading({
        hospitalContact: contact("北京大学第一医院 心血管内科门诊 电话 010-1234-5678"),
      }),
      reading({ hospitalContact: contact("A".repeat(120)) }),
    ];
    const fallbacks = Object.values(FALLBACK_TITLE);

    for (const r of cases) {
      for (const locale of ["hant", "hans", "en"] as const) {
        const title = sheetTitle(r, locale);
        if (fallbacks.includes(title)) continue;
        const printed = [
          r.hospitalContact?.text ?? "",
          ...r.followUp.map((f) => f.clinic ?? ""),
        ];
        expect(
          printed.some((line) => line.includes(title)),
          `"${title}" is not printed anywhere on this sheet`,
        ).toBe(true);
      }
    }
  });

  it("writes the title into the sheet in the reader's interface language", () => {
    memory.setItem(KEY, JSON.stringify({ version: 1, consentedAt: null, uiLocale: "en" }));
    expect(startSheet(reading(), 1).title).toBe("Discharge sheet");

    memory.clear();
    memory.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        consentedAt: null,
        profile: { label: "妈妈", dialect: "cmn", script: "hans" },
      }),
    );
    expect(startSheet(reading(), 1).title).toBe("出院纸");
  });
});

// --- one landing, one sheet -----------------------------------------------------------

/**
 * A single read must leave a single sheet.
 *
 * `app/chat/page.tsx` guards its landing with a `useRef`, and a ref does not survive a remount:
 * the page can be remounted while the sample import or the read is still in flight, and the second
 * pass calls `startSheet` again with the same reading. The bug was visible in the product — 記錄
 * showed 「以前嘅 (1)」 after the very first photograph a phone had ever taken, and the five-sheet
 * archive filled at double rate.
 */
describe("starting the same sheet twice in one landing", () => {
  it("returns the sheet already made instead of archiving it", () => {
    const r = reading();
    const first = startSheet(r, 2);
    const second = startSheet(r, 2);

    expect(second.id).toBe(first.id);
    expect(second.capturedAt).toBe(first.capturedAt);
    expect(loadSheets().archive).toEqual([]);
    expect(loadSheets().active?.id).toBe(first.id);
  });

  /** Once the conversation has started, an identical reading is a real re-photograph. */
  it("archives normally once anything has been said about the sheet", () => {
    const r = reading();
    const first = startSheet(r, 2);
    appendMessage(agentLine("我睇完你張紙。"));

    const second = startSheet(r, 2);
    expect(second.id).not.toBe(first.id);
    expect(loadSheets().archive.map((s) => s.id)).toEqual([first.id]);
  });

  /** And once a dose has been counted, even on a sheet nobody has talked about. */
  it("archives normally once a dose has been counted", () => {
    const r = reading();
    const first = startSheet(r, 1);
    takeDose("m0", DAY_3);

    const second = startSheet(r, 1);
    expect(second.id).not.toBe(first.id);
    expect(loadSheets().archive.map((s) => s.id)).toEqual([first.id]);
  });

  /** A different sheet is always a new landing, however quickly it follows. */
  it("still archives when the second reading is a different page", () => {
    const first = startSheet(reading({ hospitalContact: contact("廣華醫院 內科") }), 1);
    const second = startSheet(reading({ hospitalContact: contact("瑪麗醫院 眼科") }), 1);

    expect(second.id).not.toBe(first.id);
    expect(loadSheets().archive.map((s) => s.id)).toEqual([first.id]);
  });

  /**
   * Same pages, photographed again later: a genuinely separate read, because the plan has to
   * re-anchor on the new day. `readAt` cannot carry this — `loadSampleReading` re-stamps it on
   * every call, so the two calls in one landing differ there too — which is why the guard is
   * bounded by how long ago the ACTIVE sheet was captured.
   */
  it("treats a re-read after the landing window as a new sheet", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-03T04:00:00.000Z"));
      const first = startSheet(reading(), 1);

      vi.setSystemTime(new Date("2026-09-03T04:00:00.000Z").getTime() + SAME_LANDING_MS + 1000);
      const second = startSheet(reading(), 1);

      expect(second.id).not.toBe(first.id);
      expect(loadSheets().archive.map((s) => s.id)).toEqual([first.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Two calls a heartbeat apart, differing only in the timestamp each load stamped. */
  it("collapses two loads whose readings differ only by readAt", () => {
    const first = startSheet(reading({ readAt: "2026-09-03T04:00:00.000Z" }), 1);
    const second = startSheet(reading({ readAt: "2026-09-03T04:00:00.480Z" }), 1);

    expect(second.id).toBe(first.id);
    expect(loadSheets().archive).toEqual([]);
  });
});

/**
 * The exact shape of the duplicate that shipped, kept as a regression test.
 *
 * `app/chat/page.tsx` used to call `saveReading()` immediately before `startSheet()`. That wrote
 * the pre-v2 top-level `reading` field, so the very next `loadSheets()` materialised a phantom
 * "migrated" sheet out of it — and `startSheet` archived the phantom and started a second sheet.
 * One photograph, two sheets, and 記錄 announcing 「以前嘅 (1)」 on a phone that had read one page.
 *
 * The page no longer writes that field. This pins the store against it anyway, because the store
 * is where the "one active sheet" promise lives and it should not depend on a caller's ordering.
 */
describe("a legacy reading written just before the sheet", () => {
  it("does not become a phantom sheet to archive", () => {
    const r = reading();
    // Exactly what `saveReading()` did: the v1 field, with no `sheets` block yet.
    saveState({ reading: r });
    // The migrated view is what `startSheet` would have seen.
    expect(loadSheets().active?.pageCount).toBe(0);

    const sheet = startSheet(r, 1);

    expect(loadSheets().archive).toEqual([]);
    expect(loadSheets().active?.id).toBe(sheet.id);
    expect(loadSheets().active?.pageCount).toBe(1);
  });

  /** A genuine pre-v2 sheet is still archived when a DIFFERENT page is photographed. */
  it("still archives a real migrated sheet when a new page arrives", () => {
    saveState({ reading: reading({ hospitalContact: contact("廣華醫院 內科") }) });
    const migrated = loadSheets().active as Sheet;
    expect(migrated).not.toBeNull();

    const fresh = startSheet(reading({ hospitalContact: contact("瑪麗醫院 眼科") }), 2);

    expect(loadSheets().active?.id).toBe(fresh.id);
    expect(loadSheets().archive.map((s) => s.id)).toEqual([migrated.id]);
  });
});
