/**
 * One element, unlocked by a finger, reused for every clip.
 *
 * Kevin's report from a real iPhone was two sentences: *"I am pretty sure it doesn't play by
 * itself, and it's also delayed. Significantly."* The first half is this file.
 *
 * `lib/speech/tts.ts` used to build `new Audio(url)` per clip. On iOS a freshly constructed
 * element has no user gesture behind it, and 明仔 starts talking on his own — so the very first
 * `play()` was refused and every clip after it was refused the same way. The fix is the standard
 * one and it only works if it is exactly this: ONE `HTMLAudioElement`, `play()`ed once inside a
 * real handler, then re-`src`ed for every later clip.
 *
 * **What this file can and cannot prove.** Headless Chrome and Node both autoplay freely, so no
 * test here can reproduce the refusal — a quiet run proves nothing about an iPhone. What it can
 * prove is the MECHANISM: that one element is constructed and reused, that a clip asked for
 * before any tap does not quietly build a second one, and that the unlock happens on the same
 * tick as the gesture rather than a microtask later, which is the part iOS actually checks.
 *
 * This repo's vitest runs in `node` with no jsdom, so the browser surface is stubbed by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every element the module under test constructed, in order. */
let built: FakeAudio[] = [];

class FakeAudio {
  src = "";
  preload = "";
  currentTime = 0;
  paused = true;
  playsInline = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Every `src` this element was pointed at, so reuse is visible rather than inferred. */
  readonly played: string[] = [];
  readonly attributes: Record<string, string> = {};

  constructor(src?: string) {
    if (src) this.src = src;
    built.push(this);
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  pause(): void {
    this.paused = true;
  }
  play(): Promise<void> {
    this.paused = false;
    this.played.push(this.src);
    // A real clip runs for seconds; the shortest honest stand-in is "it ended".
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }
}

interface DocumentStub {
  handlers: Map<string, (() => void)[]>;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  tap: () => void;
}

function stubDocument(): DocumentStub {
  const handlers = new Map<string, (() => void)[]>();
  return {
    handlers,
    addEventListener(type: string, fn: () => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: () => void) {
      handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== fn));
    },
    /** What a finger on the glass looks like from here. */
    tap() {
      for (const fn of handlers.get("pointerdown") ?? []) fn();
    },
  };
}

/** A browser generous enough that silence can only mean the code chose it. */
function stubBrowser(): DocumentStub {
  built = [];
  const documentStub = stubDocument();
  vi.stubGlobal("window", { Audio: FakeAudio });
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("navigator", { userAgent: "test" });
  // Node's own `URL.createObjectURL` is left alone: it mints a distinct blob: URL per call, which
  // is exactly what is needed to see one element being pointed at several different clips.
  return documentStub;
}

/** `/api/tts` answering with real bytes, and a count of how many times it was asked. */
function stubCloud(): { calls: () => number; bodies: () => string[] } {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      // A distinct size per call, so `createObjectURL` gives each clip its own URL.
      return new Response(new Uint8Array(bodies.length * 8).fill(1), { status: 200 });
    }),
  );
  return { calls: () => bodies.length, bodies: () => bodies };
}

describe("the audio element is unlocked once and reused", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays every clip through the same element, not a new one per clip", async () => {
    stubBrowser();
    stubCloud();

    const { speak, unlockAudio } = await import("@/lib/speech/tts");
    unlockAudio();
    await speak("第一句。", "yue");
    await speak("第二句。", "yue");
    await speak("第三句。", "yue");

    expect(built).toHaveLength(1);
    // The silent unlock buffer, then the three clips: one element, four sources.
    expect(built[0].played).toHaveLength(4);
    expect(built[0].played[0]).toMatch(/^data:audio\/wav/);
    expect(new Set(built[0].played.slice(1)).size).toBe(3);
  });

  it("does not construct a second element for a clip asked for before any tap", async () => {
    stubBrowser();
    stubCloud();

    // Exactly the briefing's own order: 明仔 speaks first and nobody has pressed anything.
    const { speak, unlockAudio } = await import("@/lib/speech/tts");
    await speak("未撳過任何嘢。", "yue");
    expect(built).toHaveLength(1);

    // The tap arrives later — and lands on the element that is already there.
    unlockAudio();
    await speak("撳咗之後。", "yue");
    expect(built).toHaveLength(1);
  });

  it("unlocks on the same tick as the gesture, not in a promise continuation", async () => {
    stubBrowser();
    const { unlockAudio } = await import("@/lib/speech/unlock");

    // iOS only honours the gesture on the tick the handler runs, so `play()` has to have been
    // called by the time the handler returns — not after an await, and not from a `.then`.
    unlockAudio();

    expect(built).toHaveLength(1);
    expect(built[0].played).toHaveLength(1);
    expect(built[0].played[0]).toMatch(/^data:audio\/wav/);
  });

  it("unlocks on the first tap anywhere, with nothing wired up to ask it to", async () => {
    const documentStub = stubBrowser();
    const { isAudioUnlocked } = await import("@/lib/speech/unlock");

    // Importing the module arms the safety net; the reader has not tapped yet.
    expect(built).toHaveLength(0);
    expect(isAudioUnlocked()).toBe(false);

    documentStub.tap();
    await Promise.resolve();

    expect(built).toHaveLength(1);
    expect(isAudioUnlocked()).toBe(true);
  });

  it("a tap during a line does not cut 明仔 off", async () => {
    const documentStub = stubBrowser();
    const { isAudioUnlocked, speechAudio } = await import("@/lib/speech/unlock");

    // Chrome allows autoplay, so nothing there ever calls `unlockAudio()` and the safety net stays
    // armed for the whole session. Pointing the element at the silent buffer on the next tap would
    // then stop the reading: the reader taps a source link and 明仔 goes quiet mid-sentence.
    const element = speechAudio() as unknown as FakeAudio;
    element.src = "blob:clip/reading-right-now";
    element.paused = false;

    documentStub.tap();

    expect(element.src).toBe("blob:clip/reading-right-now");
    expect(element.played).toHaveLength(0);
    // A tap on an element that is already making a sound is proof it was never locked.
    expect(isAudioUnlocked()).toBe(true);
  });

  it("keeps the unlocked element when the speech session is reset", async () => {
    stubBrowser();
    stubCloud();

    const { resetSpeechSession, speak, unlockAudio } = await import("@/lib/speech/tts");
    unlockAudio();
    await speak("刪除之前。", "yue");

    // 全部刪除 clears what was said. The right to make a sound is a property of the device, not
    // data about the reader, and throwing it away would leave the rest of the session silent.
    resetSpeechSession();
    await speak("刪除之後。", "yue");

    expect(built).toHaveLength(1);
  });
});

describe("the next line is fetched before its bubble needs it", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("joins a request already in flight instead of paying for the line twice", async () => {
    stubBrowser();
    const cloud = stubCloud();

    const { prefetch, speak } = await import("@/lib/speech/tts");

    // The warm-up goes out while the previous line is still speaking, and the bubble arrives
    // before it has landed. Two calls here would be two provider charges and, worse, a second
    // two-second wait that the warm-up was supposed to have removed.
    const warming = prefetch([{ text: "跟住講藥。", dialect: "yue" }]);
    const spoken = speak("跟住講藥。", "yue");
    await Promise.all([warming, spoken]);

    expect(cloud.calls()).toBe(1);
  });

  it("speaks a warmed line without going to the network at all", async () => {
    stubBrowser();
    const cloud = stubCloud();

    const { prefetch, speak, isCached } = await import("@/lib/speech/tts");
    await prefetch([{ text: "覆診喺下個月。", dialect: "yue" }]);
    expect(cloud.calls()).toBe(1);
    expect(isCached("覆診喺下個月。", "yue")).toBe(true);

    await speak("覆診喺下個月。", "yue");
    expect(cloud.calls()).toBe(1);
  });

  it("cancelling one line does not throw away a clip somebody else is waiting for", async () => {
    stubBrowser();
    const cloud = stubCloud();

    const { prefetch, speak, isCached } = await import("@/lib/speech/tts");
    const controller = new AbortController();
    const spoken = speak("讀到一半就俾人打斷。", "yue", { signal: controller.signal });
    const warming = prefetch([{ text: "讀到一半就俾人打斷。", dialect: "yue" }]);

    controller.abort();
    expect((await spoken).mode).toBe("text-only");

    // The download was shared, so aborting the utterance must not cancel it: the bytes still
    // arrive, and 再講一次 is then instant instead of another two seconds away.
    await warming;
    expect(cloud.calls()).toBe(1);
    expect(isCached("讀到一半就俾人打斷。", "yue")).toBe(true);
  });
});
