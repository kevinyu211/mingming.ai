/**
 * On-device memory: the caps, the brief, and the promise that "delete everything" still means it
 * (constitution principle V).
 *
 * Runs against the same in-memory localStorage + window shim the storage tests use, because the
 * memory layer is client-only by construction: it never fetches, never logs, and never reaches
 * anything but `lib/storage/local.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Dialect, StoredReading } from "@/lib/domain/schemas";
import { MAX_BRIEF_CHARS, buildMemoryBrief } from "@/lib/memory/context";
import { appendExchange, appendReading, summariseReading } from "@/lib/memory/record";
import { loadMemory, memoryBrief, rememberExchange, rememberReading } from "@/lib/memory/store";
import {
  MAX_EXCHANGES,
  MAX_READINGS,
  emptyMemory,
  type Memory,
  type RememberedReading,
} from "@/lib/memory/types";
import {
  ImageDataRejectedError,
  deleteEverything,
  loadState,
  saveMemory,
  saveProfile,
  type Profile,
} from "@/lib/storage/local";

/* -------------------------------------------------------------------------- */
/* Shims                                                                      */
/* -------------------------------------------------------------------------- */

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

const memory = new MemoryStorage();

const windowShim = {
  localStorage: memory as unknown as Storage,
  addEventListener() {},
  removeEventListener() {},
};

beforeAll(() => {
  (globalThis as { window?: unknown }).window = windowShim;
});

beforeEach(() => {
  memory.clear();
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const LABEL = "阿媽";
const NAME = "陳大文";
const PROFILE: Profile = { label: LABEL, dialect: "yue", script: "hant" };

function speak(text: string) {
  return { yue: text, cmn: text, en: text };
}

function source(quote: string, section = "Discharge Medication(s) & Follow-up Plan") {
  return { section, lineIndex: 0, quote };
}

/** A synthetic reading, in the shape the client stores. Fictional patient, fictional hospital. */
function reading(readAt: string, overrides: Partial<StoredReading> = {}): StoredReading {
  return {
    sheetType: "hk_en",
    warningSigns: [
      {
        symptom: speak("胸口痛"),
        action: speak("即刻返急症室。"),
        source: source("Return to A&E if chest pain", "Advice on Discharge"),
      },
    ],
    medicines: [
      {
        name: "Amlodipine",
        strength: "5mg",
        amount: "1 tab",
        frequency: "daily",
        duration: null,
        status: "current",
        spoken: speak("Amlodipine 5mg，一粒，每日一次。"),
        source: source("1. Amlodipine 5mg 1 tab daily"),
      },
    ],
    followUp: [
      {
        clinic: "SOPD",
        when: "2/52",
        tests: null,
        spoken: speak("兩個星期後覆診。"),
        source: source("F/U SOPD 2/52"),
      },
    ],
    dietLine: {
      raw: "Low salt, low fat diet",
      recognisedType: "low_salt",
      spoken: speak("張紙寫住少鹽少油。"),
      source: source("Diet: Low salt, low fat diet", "Advice on Discharge"),
    },
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
    readAt,
    ...overrides,
  };
}

const DIALECT: Dialect = "yue";

function remembered(readAt: string): RememberedReading {
  return summariseReading(reading(readAt), DIALECT);
}

/* -------------------------------------------------------------------------- */
/* Caps                                                                       */
/* -------------------------------------------------------------------------- */

describe("the store cannot grow without bound", () => {
  it("keeps the five most recent readings: a sixth evicts the first", () => {
    let store: Memory = emptyMemory();
    for (let day = 1; day <= MAX_READINGS; day += 1) {
      store = appendReading(store, remembered(`2026-09-0${day}T09:00:00.000Z`));
    }
    expect(store.readings).toHaveLength(MAX_READINGS);
    expect(store.readings[0].readAt).toBe("2026-09-01T09:00:00.000Z");

    store = appendReading(store, remembered("2026-09-06T09:00:00.000Z"));

    expect(store.readings).toHaveLength(MAX_READINGS);
    // The first is gone, the sixth is last, and the order in between is untouched.
    expect(store.readings.map((entry) => entry.readAt)).toEqual([
      "2026-09-02T09:00:00.000Z",
      "2026-09-03T09:00:00.000Z",
      "2026-09-04T09:00:00.000Z",
      "2026-09-05T09:00:00.000Z",
      "2026-09-06T09:00:00.000Z",
    ]);
  });

  it("keeps the fifty most recent exchanges: a fifty-first evicts the first", () => {
    let store: Memory = emptyMemory();
    for (let n = 0; n < MAX_EXCHANGES; n += 1) {
      store = appendExchange(store, {
        question: `question ${n}`,
        outcome: "answered",
        citedCardId: "medicine-0",
        askedAt: `2026-09-02T09:${String(n).padStart(2, "0")}:00.000Z`,
      });
    }
    expect(store.exchanges).toHaveLength(MAX_EXCHANGES);
    expect(store.exchanges[0].question).toBe("question 0");

    store = appendExchange(store, {
      question: "question 50",
      outcome: "answered",
      askedAt: "2026-09-02T10:00:00.000Z",
    });

    expect(store.exchanges).toHaveLength(MAX_EXCHANGES);
    expect(store.exchanges[0].question).toBe("question 1");
    expect(store.exchanges[MAX_EXCHANGES - 1].question).toBe("question 50");
  });

  it("replaces rather than duplicates when the same reading is saved twice", () => {
    let store: Memory = emptyMemory();
    store = appendReading(store, remembered("2026-09-02T09:00:00.000Z"));
    store = appendReading(store, remembered("2026-09-02T09:00:00.000Z"));
    expect(store.readings).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* What is remembered, and what is not                                        */
/* -------------------------------------------------------------------------- */

describe("what a remembered reading holds", () => {
  it("copies the printed fields and borrows the model's own sentences for the recap", () => {
    const entry = summariseReading(reading("2026-09-02T09:00:00.000Z"), DIALECT);

    expect(entry.medicines).toEqual(["Amlodipine 5mg 1 tab daily"]);
    expect(entry.followUp).toEqual(["SOPD 2/52"]);
    expect(entry.dietLine).toBe("Low salt, low fat diet");
    expect(entry.warningSigns).toEqual(["胸口痛"]);
    expect(entry.recap).toContain("Amlodipine 5mg");
    // No source references, no unreadable regions, no card bodies: memory is a summary, not a copy.
    expect(Object.keys(entry).sort()).toEqual([
      "dietLine",
      "followUp",
      "id",
      "medicines",
      "readAt",
      "recap",
      "sheetType",
      "warningSigns",
    ]);
  });

  it("never records a crisis question, whatever the caller passes", () => {
    rememberExchange({ question: "我唔想再活落去。", outcome: "crisis_referral" });
    expect(loadMemory().exchanges).toHaveLength(0);
    expect(JSON.stringify(loadState())).not.toContain("唔想再活");
  });

  it("records nothing for a request that never produced an answer", () => {
    rememberExchange({ question: "幾時覆診？", outcome: "model_unavailable" });
    rememberExchange({ question: "幾時覆診？", outcome: "bad_request" });
    expect(loadMemory().exchanges).toHaveLength(0);
  });

  it("records the three outcomes that did happen", () => {
    rememberExchange({ question: "白色嗰粒點食？", outcome: "answered", citedCardId: "medicine-0" });
    rememberExchange({ question: "佢可以食咩生果？", outcome: "not_on_sheet" });
    rememberExchange({ question: "可唔可以唔食？", outcome: "refused_medicine_change" });

    const stored = loadMemory().exchanges;
    expect(stored.map((entry) => entry.outcome)).toEqual([
      "answered",
      "not_on_sheet",
      "refused_medicine_change",
    ]);
    expect(stored[0].citedCardId).toBe("medicine-0");
    expect(stored[1].citedCardId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The brief                                                                  */
/* -------------------------------------------------------------------------- */

describe("the memory brief", () => {
  it("is empty when there is nothing to say, so a first question sends no memory at all", () => {
    expect(buildMemoryBrief(null)).toBe("");
    expect(buildMemoryBrief(emptyMemory())).toBe("");
    expect(memoryBrief()).toBe("");
  });

  it("names the sheets, the medicines, the follow-up and what was already asked", () => {
    rememberReading(reading("2026-09-02T09:00:00.000Z"), DIALECT);
    rememberExchange({
      question: "白色嗰粒係朝早定夜晚食？",
      outcome: "answered",
      citedCardId: "medicine-0",
      askedAt: "2026-09-02T09:05:00.000Z",
    });

    const brief = memoryBrief();

    expect(brief).toContain("2026-09-02");
    expect(brief).toContain("Hong Kong English sheet");
    expect(brief).toContain("Amlodipine 5mg 1 tab daily");
    expect(brief).toContain("SOPD 2/52");
    expect(brief).toContain("Low salt, low fat diet");
    expect(brief).toContain("白色嗰粒係朝早定夜晚食？");
    expect(brief).toContain("answered from the sheet");
  });

  it("names a declined medicine-change question without quoting it back", () => {
    rememberExchange({
      question: "可唔可以唔食呢隻藥？",
      outcome: "refused_medicine_change",
      askedAt: "2026-09-02T09:10:00.000Z",
    });

    const brief = memoryBrief();

    expect(brief).toContain("asked about changing a medicine");
    // That question was answered without a model call; a later brief must not be the way it
    // finally reaches one.
    expect(brief).not.toContain("可唔可以唔食呢隻藥？");
  });

  it("drops a generated line that trips the banned-term filter, and keeps the page's own text", () => {
    // An entry as an older build could have written it: the recap and the warning sign carry a
    // banned term because the filter of the day did not cover every spoken form. The medicine and
    // diet lines are verbatim page text and stay whatever they say (principle IV).
    const stale: Memory = {
      readings: [
        {
          ...remembered("2026-09-02T09:00:00.000Z"),
          warningSigns: ["胸口痛", "呢個係治療嘅一部分"],
          recap: "This medicine treats high blood pressure.",
          medicines: ["Curesol 5mg 1 tab daily"],
          dietLine: "Diet after treatment: low salt",
        },
      ],
      exchanges: [],
    };

    const brief = buildMemoryBrief(stale);

    expect(brief).not.toContain("This medicine treats");
    expect(brief).not.toContain("治療");
    expect(brief).toContain("胸口痛");
    // Verbatim page text is exempt and must survive, banned-looking words and all.
    expect(brief).toContain("Curesol 5mg 1 tab daily");
    expect(brief).toContain("Diet after treatment: low salt");
  });

  it("stays under the character cap and drops oldest first", () => {
    let store: Memory = emptyMemory();
    for (let day = 1; day <= MAX_READINGS; day += 1) {
      const readAt = `2026-09-0${day}T09:00:00.000Z`;
      store = appendReading(
        store,
        summariseReading(
          reading(readAt, {
            medicines: Array.from({ length: 6 }, (_, index) => ({
              name: `Medicine${day}${index}`,
              strength: "500mg",
              amount: "2 tab",
              frequency: "three times a day after food",
              duration: "x 14 days",
              status: "current",
              spoken: speak("每日三次，飯後食。"),
              source: source(`${index}. Medicine ${index}`),
            })),
          }),
          DIALECT,
        ),
      );
    }
    for (let n = 0; n < MAX_EXCHANGES; n += 1) {
      store = appendExchange(store, {
        question: `呢隻藥係咪要飯後食，定係空肚食都得？（${n}）`,
        outcome: "answered",
        citedCardId: "medicine-0",
        askedAt: `2026-09-05T10:${String(n).padStart(2, "0")}:00.000Z`,
      });
    }

    const brief = buildMemoryBrief(store);

    expect(brief.length).toBeGreaterThan(0);
    expect(brief.length).toBeLessThanOrEqual(MAX_BRIEF_CHARS);
    // The most recent sheet survives; the oldest one and the oldest questions are what went.
    expect(brief).toContain("2026-09-05");
    expect(brief).not.toContain("Medicine10");
    expect(brief).toContain("（49）");
    expect(brief).not.toContain("（0）");
  });

  it("keeps the newest sheet even when the questions alone would fill the cap", () => {
    let store: Memory = emptyMemory();
    store = appendReading(store, remembered("2026-09-05T09:00:00.000Z"));
    for (let n = 0; n < MAX_EXCHANGES; n += 1) {
      store = appendExchange(store, {
        question: `${"問".repeat(60)}${n}`,
        outcome: "answered",
        askedAt: `2026-09-06T10:${String(n).padStart(2, "0")}:00.000Z`,
      });
    }

    const brief = buildMemoryBrief(store);

    expect(brief.length).toBeLessThanOrEqual(MAX_BRIEF_CHARS);
    expect(brief).toContain("Amlodipine 5mg 1 tab daily");
  });

  it("carries no relationship label, no name and no plan, with all of them on the phone", () => {
    saveProfile(PROFILE);
    rememberReading(reading("2026-09-02T09:00:00.000Z"), DIALECT);
    // A question that happens to mention the label and a name: what the phone keeps is one
    // thing, what the brief renders is another.
    rememberExchange({
      question: `${LABEL}同${NAME}幾時覆診？`,
      outcome: "not_on_sheet",
      askedAt: "2026-09-02T09:05:00.000Z",
    });

    const brief = memoryBrief();

    // The label and the name are not fields of the memory shape, so the only way they could
    // appear is inside a question the user typed — and that is the user's own sentence, not a
    // profile field the app attached.
    expect(brief).not.toContain("label");
    expect(brief).not.toContain("plan");
    expect(brief).not.toContain("confirmedAt");
    expect(brief).not.toContain("followUpDate");

    const withoutQuestions = buildMemoryBrief({ readings: loadMemory().readings, exchanges: [] });
    expect(withoutQuestions).not.toContain(LABEL);
    expect(withoutQuestions).not.toContain(NAME);
    expect(loadState().profile?.label).toBe(LABEL);
  });
});

/* -------------------------------------------------------------------------- */
/* Storage guarantees                                                         */
/* -------------------------------------------------------------------------- */

describe("memory lives under the one key", () => {
  it("is wiped by deleteEverything, like everything else", () => {
    saveProfile(PROFILE);
    rememberReading(reading("2026-09-02T09:00:00.000Z"), DIALECT);
    rememberExchange({ question: "幾時覆診？", outcome: "answered", citedCardId: "followUp-0" });

    expect(loadMemory().readings).toHaveLength(1);
    expect(loadMemory().exchanges).toHaveLength(1);
    expect(memory.length).toBe(1);

    deleteEverything();

    expect(loadState().memory).toBeUndefined();
    expect(loadMemory()).toEqual(emptyMemory());
    expect(memoryBrief()).toBe("");
    // One key, removed in one move: nothing of the memory survives anywhere.
    expect(memory.length).toBe(0);
  });

  it("survives a reload, which is the whole point", () => {
    rememberReading(reading("2026-09-02T09:00:00.000Z"), DIALECT);
    rememberExchange({ question: "幾時覆診？", outcome: "answered", citedCardId: "followUp-0" });

    // A "reload" is just reading the key again; nothing is cached in module state.
    expect(loadMemory().readings[0].medicines).toEqual(["Amlodipine 5mg 1 tab daily"]);
    expect(loadMemory().exchanges[0].question).toBe("幾時覆診？");
  });

  it("still refuses image data on the way in (FR-018)", () => {
    const withImage = {
      readings: [
        {
          ...remembered("2026-09-02T09:00:00.000Z"),
          base64: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
        },
      ],
      exchanges: [],
    } as unknown as Memory;

    expect(() => saveMemory(withImage)).toThrow(ImageDataRejectedError);
    expect(JSON.stringify(loadState())).not.toContain("QUJDREVG");
  });

  it("repairs a store written by an older or hand-edited key rather than throwing", () => {
    memory.setItem(
      "fitornot.v1",
      JSON.stringify({ version: 1, consentedAt: null, memory: { readings: "nonsense" } }),
    );
    expect(loadMemory()).toEqual(emptyMemory());
    expect(memoryBrief()).toBe("");
  });
});
