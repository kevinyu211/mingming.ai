/**
 * The recorded path, in a real browser, with a real microphone.
 *
 * Every other spec in this suite deletes `MediaRecorder` and drives a stubbed `SpeechRecognition`,
 * which is fine for the gesture and useless for the bug Kevin actually hit: *"the transcription is
 * still not working sometimes."* Sometimes is not a gesture problem. It is a capture problem, and
 * capture cannot be tested against a stub.
 *
 * So this file launches Chrome with `--use-fake-device-for-media-stream` — a real
 * `getUserMedia`, a real `MediaRecorder`, real bytes on the wire — and asserts the three things
 * that "sometimes" is made of:
 *
 *   1. **Three holds in a row all land.** "Sometimes" almost always means "not the second one".
 *   2. **Every microphone track is `ended` afterwards.** A leaked track is the best explanation
 *      there is for a second hold that opens nothing, and `readyState` is checkable from the page.
 *   3. **The browser recogniser is never constructed.** Two engines on one microphone was the
 *      diagnosis; this is the assertion that keeps them apart. Chrome ships
 *      `webkitSpeechRecognition`, so if anything ever reaches for it again, this fails.
 *
 * What it cannot prove: any of this on iOS Safari, which is a different engine with a different
 * audio session and a different `MediaRecorder`. Chrome grants the microphone freely and never
 * shows the two racing permission prompts that an iPhone does. This file proves the code path is
 * correct and leak-free; the phone is still the phone.
 */
import { expect, test, type Page } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import { mockAsk, seedConsent } from "./helpers";

/** Comfortably past ChatBar's 220 ms threshold, and past the 700 ms a real utterance needs. */
const HOLD_MS = 900;

/** What the mocked `/api/stt` says it heard. Three different ones, so no assertion can alias. */
const SAID = ["白色嗰粒係做咩用？", "覆診要帶咩嘢？", "呢隻藥要唔要隨餐食？"] as const;

/** How long the mocked route takes, so the bar's 「送緊…」 state is observable rather than a frame. */
const UPLOAD_MS = 400;

interface Uploads {
  /** One entry per POST to `/api/stt`: the bytes and the mime type the recorder chose. */
  readonly seen: { bytes: number; contentType: string }[];
}

/**
 * `/api/stt` answers with a transcript, slowly enough to see.
 *
 * The e2e dev server runs `STT_PROVIDER=browser`, so the real route answers 503 — which is a real
 * state (`lib/speech/stt.ts` switches engines for the session on it) and exactly not the one under
 * test here.
 */
async function mockStt(page: Page): Promise<Uploads> {
  const seen: { bytes: number; contentType: string }[] = [];
  await page.route("**/api/stt**", async (route) => {
    const body = route.request().postDataBuffer();
    seen.push({
      bytes: body ? body.byteLength : 0,
      contentType: route.request().headers()["content-type"] ?? "",
    });
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_MS));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: SAID[Math.min(seen.length - 1, SAID.length - 1)] }),
    });
  });
  return { seen };
}

/**
 * Watch the microphone without stubbing it.
 *
 * `getUserMedia` still opens Chrome's fake device and still returns a real `MediaStream`; every
 * track it hands out is just kept so the test can read its `readyState` at the end. And
 * `webkitSpeechRecognition` is replaced with something that counts constructions and hears
 * nothing, because the point is that nothing ever builds one.
 */
async function watchTheMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as {
      __tracks: MediaStreamTrack[];
      __recognitions: number;
      webkitSpeechRecognition: unknown;
      SpeechRecognition: unknown;
    };
    scope.__tracks = [];
    scope.__recognitions = 0;

    const devices = navigator.mediaDevices;
    const open = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await open(constraints);
      scope.__tracks.push(...stream.getTracks());
      return stream;
    };

    class CountedRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: unknown = null;
      onerror: unknown = null;
      onend: (() => void) | null = null;
      constructor() {
        scope.__recognitions += 1;
      }
      start(): void {}
      stop(): void {
        this.onend?.();
      }
      abort(): void {
        this.onend?.();
      }
    }
    scope.webkitSpeechRecognition = CountedRecognition;
    scope.SpeechRecognition = CountedRecognition;
  });
}

/**
 * 明明 reads with the device voice instead of the provider.
 *
 * 503 is what `TTS_PROVIDER=browser` answers, and `lib/speech/tts.ts` treats it as the configured
 * choice rather than a failure. Without it this spec would spend real MiniMax calls on audio
 * nobody listens to, and would fail whenever the network did.
 */
async function silenceVoice(page: Page): Promise<void> {
  await page.route("**/api/tts", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "browser_fallback" }),
    }),
  );
}

/** Press the bar, hold it long enough to have said something, let go. */
async function holdTheBar(page: Page): Promise<void> {
  const bar = page.getByRole("button", { name: UI.hant["bar.hold"] });
  await expect(bar).toBeEnabled();
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByText(UI.hant["bar.listeningSub"], { exact: true })).toBeVisible();
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
}

/** Every microphone track the page was ever handed, by `readyState`. */
async function trackStates(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map(
      (track) => track.readyState,
    ),
  );
}

// A real capture pipeline: Chrome's own fake device on the media stream, and no permission dialog
// in the way. Headless Chrome grants the microphone freely, which is precisely why this proves the
// code and not the phone.
//
// File-level rather than inside the describe: `launchOptions` forces a new worker, and Playwright
// refuses to scope a worker option to a group.
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["microphone"],
});

test.describe("the recorded path, with a microphone that actually exists", () => {
  test("three holds in a row all reach the thread, and no microphone track is left open", async ({
    page,
  }) => {
    const ask = await mockAsk(page, "answered");
    const uploads = await mockStt(page);
    await watchTheMicrophone(page);
    await silenceVoice(page);
    await seedConsent(page);
    await page.goto("/chat?sample=hk_en");

    for (const [index, said] of SAID.entries()) {
      await holdTheBar(page);

      // The state that did not exist: between letting go and the words arriving the bar says it
      // is sending, rather than still claiming to be listening to a microphone it has closed.
      await expect(page.getByText(UI.hant["bar.sendingSub"], { exact: true })).toBeVisible();

      await expect(page.getByText(said, { exact: true })).toBeVisible({ timeout: 30_000 });
      expect(uploads.seen, `hold ${index + 1} should have uploaded`).toHaveLength(index + 1);
      // Real audio, not an empty blob dressed up as one. A one-second capture is thousands of
      // bytes; the failure this catches is a recorder that stops before `ondataavailable`.
      expect(uploads.seen[index].bytes).toBeGreaterThan(1_000);
      expect(uploads.seen[index].contentType).toMatch(/^audio\//);

      // The bar comes all the way back before the next hold, so the next press is a real one.
      await expect(page.getByRole("button", { name: UI.hant["bar.hold"] })).toBeEnabled({
        timeout: 30_000,
      });
    }

    expect(ask.count).toBe(SAID.length);

    // Three holds, three microphone tracks, all of them stopped. A track left `live` is the
    // failure that makes the NEXT hold do nothing on a phone.
    expect(await trackStates(page)).toEqual(["ended", "ended", "ended"]);

    // And the whole diagnosis, as one number: the browser recogniser was never built, so it was
    // never competing for the microphone the recorder had open.
    const recognitions = await page.evaluate(
      () => (window as unknown as { __recognitions: number }).__recognitions,
    );
    expect(recognitions).toBe(0);
  });

  test("a hold whose upload cannot go through says so instead of going quiet", async ({ page }) => {
    // The bug in one sentence: the reader spoke, the phone captured it, and nothing appeared and
    // nothing was said. Audio was captured here and the route is unreachable, so the bar has to
    // account for it — and it must NOT be the thread's "I didn't catch that", which is untrue.
    await mockAsk(page, "answered");
    await watchTheMicrophone(page);
    await silenceVoice(page);
    await page.route("**/api/stt**", (route) => route.abort("failed"));
    await seedConsent(page);
    await page.goto("/chat?sample=hk_en");

    await holdTheBar(page);

    await expect(
      page.getByText("聽到你講嘢，但係送唔到出去。撳住再講多次，或者打字問。", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    // Not the wrong sentence, which would send a seventy-year-old back to say it louder.
    await expect(page.getByText(UI.hant["chat.nothingHeard"], { exact: true })).toHaveCount(0);

    // And it recovers: the bar is a bar again, and the microphone was let go on the way out.
    await expect(page.getByRole("button", { name: UI.hant["bar.hold"] })).toBeEnabled();
    expect((await trackStates(page)).every((state) => state === "ended")).toBe(true);
  });
});
