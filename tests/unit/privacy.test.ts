/**
 * T039 — the privacy guarantee, asserted at the wire (quickstart V9, SC-009, FR-018, FR-019,
 * constitution principle V).
 *
 * The phone holds four things it must never post anywhere: the relationship label, the plan
 * (with its `confirmedAt` and `followUpDate`), the reading, and — for a few milliseconds during
 * a read — the pixels of the sheet. Three request builders can reach the network:
 *
 *   `readSheet`  → POST /api/read   may carry the pages, and nothing else
 *   `ask`        → POST /api/ask    may carry the reading, the question and the dialect
 *   `speak`      → POST /api/tts    may carry the sentence and the dialect
 *
 * So this file fills storage with a profile, a confirmed plan and a reading — the fullest state
 * the app ever holds — then drives all three and inspects every byte that left. A regression
 * that widens a request type shows up here as a failing string search, not as a privacy
 * incident found by a judge with a network inspector.
 *
 * `saveReading` is checked too, because the other half of FR-018 is that no image can be written
 * to storage even if a future caller tries.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ask } from "@/lib/client/ask-stream";
import { readSheet } from "@/lib/client/read-stream";
import type { StoredReading } from "@/lib/domain/schemas";
import { resetSpeechSession, speak } from "@/lib/speech/tts";
import {
  ImageDataRejectedError,
  assertNoImageData,
  loadState,
  savePlan,
  saveProfile,
  saveReading,
  type FollowUpPlan,
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

/**
 * No `speechSynthesis`: with the cloud answering "nothing to play", `speak` falls through to the
 * device voice, finds none, and returns `text-only`. That is the whole path under test — what
 * the request carried — and it avoids needing an audio element in Node.
 */
const windowShim = {
  localStorage: memory as unknown as Storage,
  addEventListener() {},
  removeEventListener() {},
};

/** Every request any builder made, in order. */
interface Sent {
  url: string;
  body: string;
}

let sent: Sent[] = [];

function ndjson(events: unknown[]): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

/** Replies the way each route replies in this environment; records what was posted. */
function mockFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, body: typeof init?.body === "string" ? init.body : "" });

    if (url.endsWith("/api/read")) {
      return new Response(
        ndjson([
          { event: "status", phase: "reading" },
          { event: "done", reading: WIRE_READING, filter: { regenerated: 0, templated: 0 } },
        ]),
        { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
      );
    }
    if (url.endsWith("/api/ask")) {
      return new Response(
        ndjson([
          { event: "outcome", outcome: "answered", citedCardId: "medicine-0" },
          { event: "answer", answer: { yue: "每日一次。", cmn: "每天一次。" } },
          { event: "done" },
        ]),
        { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
      );
    }
    // An empty body is how "no cloud voice, use the phone's" arrives at `lib/speech/tts.ts`.
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
}

beforeAll(() => {
  (globalThis as { window?: unknown }).window = windowShim;
});

beforeEach(() => {
  memory.clear();
  sent = [];
  resetSpeechSession();
  vi.stubGlobal("fetch", mockFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The fullest state the app ever holds                                       */
/* -------------------------------------------------------------------------- */

const LABEL = "阿媽";

const PROFILE: Profile = { label: LABEL, dialect: "yue", script: "hant" };

const SOURCE = {
  section: "Discharge Medication(s) & Follow-up Plan",
  lineIndex: 0,
  quote: "1. Amlodipine 5mg 1 tab daily",
};

/** The reading as `/api/read` returns it — no `readAt`, and above all no pixels. */
const WIRE_READING = {
  sheetType: "hk_en",
  warningSigns: [],
  medicines: [
    {
      name: "Amlodipine",
      strength: "5mg",
      amount: "1 tab",
      frequency: "daily",
      duration: null,
      spoken: { yue: "Amlodipine 5mg，一粒，每日一次。", cmn: "Amlodipine 5mg，一片，每天一次。" },
      source: SOURCE,
    },
  ],
  followUp: [],
  dietLine: null,
  activityLine: null,
  hospitalContact: null,
  unreadable: [],
};

const PLAN: FollowUpPlan = {
  items: [
    {
      kind: "medicineTime",
      label: "Amlodipine 5mg",
      when: "daily",
      source: SOURCE,
    },
  ],
  confirmedAt: "2026-09-02T09:20:00.000Z",
  followUpDate: "2026-09-16",
};

/** The base64 of one page. Distinctive so it can be searched for in later requests. */
const PAGE_BASE64 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";

function seedEverything(): void {
  saveProfile(PROFILE);
  savePlan(PLAN);
}

/** Runs the read the way `app/read/page.tsx` does, and stores the result the way it does. */
async function performRead(): Promise<StoredReading> {
  const outcome = await readSheet([{ mediaType: "image/jpeg", base64: PAGE_BASE64 }]);
  if (outcome.kind !== "reading") throw new Error(`unexpected read outcome: ${outcome.kind}`);
  saveReading(outcome.reading);
  return outcome.reading;
}

/** Strings that must never appear in a request body, whatever the caller intended. */
const FORBIDDEN = [LABEL, "label", "plan", "confirmedAt", "followUpDate"] as const;

function expectNoProfileData(body: string, where: string): void {
  for (const needle of FORBIDDEN) {
    expect(body, `${where} must not carry "${needle}"`).not.toContain(needle);
  }
}

function expectNoImageData(body: string, where: string): void {
  for (const needle of ["base64", "image", "Image", PAGE_BASE64]) {
    expect(body, `${where} must not carry "${needle}"`).not.toContain(needle);
  }
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("POST /api/read", () => {
  it("carries the pages and nothing else, with a full profile and plan on the phone", async () => {
    seedEverything();
    await performRead();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/read");

    const body = JSON.parse(sent[0].body) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["images"]);
    const images = body.images as Record<string, unknown>[];
    expect(images).toHaveLength(1);
    expect(Object.keys(images[0]).sort()).toEqual(["base64", "mediaType"]);

    // The pixels are the point of this request; the profile and the plan are not.
    expectNoProfileData(sent[0].body, "the read request");
  });
});

describe("POST /api/ask", () => {
  it("carries the reading, the question and the dialect, and no profile or plan", async () => {
    seedEverything();
    const reading = await performRead();
    sent = [];

    await ask({
      reading,
      question: { text: "白色嗰粒，朝早定夜晚食？", inputLanguage: "yue" },
      dialect: "yue",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/ask");

    const body = JSON.parse(sent[0].body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["dialect", "question", "reading"]);
    expect(Object.keys(body.question as object).sort()).toEqual(["inputLanguage", "text"]);

    expectNoProfileData(sent[0].body, "the ask request");
    // FR-018: the photo is gone by now, so the reading it sends cannot contain it.
    expectNoImageData(sent[0].body, "the ask request");
  });

  it("still sends nothing extra when the caller passes a widened object", async () => {
    seedEverything();
    const reading = await performRead();
    sent = [];

    // A future caller spreading the stored state into the request is exactly the mistake the
    // field-by-field body in `ask-stream.ts` exists to make impossible.
    const widened = {
      reading,
      question: { text: "幾時覆診？", inputLanguage: "yue" as const, label: LABEL },
      dialect: "yue" as const,
      profile: PROFILE,
      plan: PLAN,
    };
    await ask(widened);

    const body = JSON.parse(sent[0].body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["dialect", "question", "reading"]);
    expectNoProfileData(sent[0].body, "the widened ask request");
  });
});

describe("POST /api/tts", () => {
  it("carries the sentence and the dialect, and never the relationship label", async () => {
    seedEverything();
    await performRead();
    sent = [];

    const result = await speak("張紙寫住 Amlodipine 5mg 每日一次。AI 寫嘅，可能有錯。", "yue");
    // No cloud audio and no device voice in Node: the honest outcome is on-screen text.
    expect(result.mode).toBe("text-only");

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/tts");

    const body = JSON.parse(sent[0].body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["dialect", "text"]);
    expect(body.dialect).toBe("yue");

    expectNoProfileData(sent[0].body, "the tts request");
    expectNoImageData(sent[0].body, "the tts request");
  });

  /**
   * `components/CardStack.tsx` opens "全部讀出" with the form of address, spoken by the phone's
   * own voice. This is the contract that keeps that honest: whatever the stack decides to say
   * out loud, the string handed to `speak` is the one that gets posted — so the label must never
   * be put into it.
   */
  it("posts exactly the string it was given, which is why the address is spoken locally", async () => {
    seedEverything();
    const sentence = "張紙上面寫，如果胸口痛。";
    await speak(sentence, "yue");
    expect(JSON.parse(sent[0].body)).toEqual({ text: sentence, dialect: "yue" });
  });
});

describe("across the whole session", () => {
  it("leaks no profile field into any request the app can make", async () => {
    seedEverything();
    const reading = await performRead();
    await ask({
      reading,
      question: { text: "幾時覆診？", inputLanguage: "cmn" },
      dialect: "yue",
    });
    await speak("覆診喺兩個星期後。", "yue");

    expect(sent.map((entry) => entry.url)).toEqual(["/api/read", "/api/ask", "/api/tts"]);
    for (const entry of sent) expectNoProfileData(entry.body, entry.url);

    // …and the phone still holds all of it, which is the point: on the device, not on the wire.
    const state = loadState();
    expect(state.profile?.label).toBe(LABEL);
    expect(state.plan?.confirmedAt).toBe(PLAN.confirmedAt);
    expect(state.plan?.followUpDate).toBe("2026-09-16");
  });

  it("keeps no image data in storage after a read", async () => {
    seedEverything();
    await performRead();

    const stored = JSON.stringify(loadState());
    expectNoImageData(stored, "stored state");
    expect(() => assertNoImageData(loadState())).not.toThrow();
  });
});

describe("saveReading", () => {
  it("refuses a reading that carries images rather than storing it (FR-018)", async () => {
    seedEverything();
    const reading = await performRead();

    const withImages = {
      ...reading,
      images: [{ mediaType: "image/jpeg", base64: PAGE_BASE64 }],
    } as unknown as StoredReading;

    expect(() => saveReading(withImages)).toThrow(ImageDataRejectedError);
    expect(() => saveReading(withImages)).toThrow(/state\.reading\.images/);

    // The refusal is a guard, not a partial write: what was stored before is untouched.
    expect(JSON.stringify(loadState())).not.toContain(PAGE_BASE64);
  });

  it("refuses a nested base64 field however deeply it is buried", async () => {
    const buried = {
      sheetType: "hk_en",
      warningSigns: [],
      medicines: [],
      followUp: [],
      dietLine: null,
      activityLine: null,
      hospitalContact: null,
      unreadable: [{ section: "Ward", region: { base64: PAGE_BASE64 } }],
      readAt: "2026-09-02T09:00:00.000Z",
    } as unknown as StoredReading;

    expect(() => saveReading(buried)).toThrow(ImageDataRejectedError);
  });
});
