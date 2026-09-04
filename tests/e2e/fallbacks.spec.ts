/**
 * The failure paths, on the v2 screens (quickstart V7).
 *
 * The constitution treats failure paths as features: camera fails → the photo library; speech
 * input fails → type; the model fails → the bundled sample; speech output fails → the words stay
 * on screen. Each has a designed state and each way out is one tap (SC-007).
 *
 * ## What this file owns after the redesign, and what it handed over
 *
 * The three read failures — 502, 422, 413 — happened on the v1 `/read` screen, which is gone.
 * They are now on `/chat`, and `tests/e2e/chat-briefing.spec.ts` covers all three there
 * (`:282`, `:299`, `:310`, plus the not-a-sheet decline at `:320`), including the part that
 * matters most: that the bundled sample is one tap away and **actually reads** with the route
 * still failing. Those cases belong to that file now and are not repeated here.
 *
 * What was left uncovered by the hand-over is the *seam*: chat-briefing seeds the downscaled
 * pages straight into `sessionStorage`, deliberately, so it could be written while `/capture` was
 * still being rebuilt. Nothing proved that a real photograph taken on the real screen reaches
 * those states at all. The first test below does exactly that and nothing more.
 *
 * "No speech input" is likewise chat-briefing's (`:196` for the honest keyboard state, `:207` for
 * a typed question actually going through). What is here instead is the half no other file can
 * reach: no speech OUTPUT, and the camera fallbacks including the laptop.
 *
 * ## Deleted rather than migrated
 *
 * The v1 "typed-sheet path says honestly what it cannot do yet" test drove the 打字輸入 tile into
 * `DeclineState`'s `typedText` variant. v2 has no typed-input affordance anywhere — `capture.type`
 * survives only in the orphaned `components/MicButton.tsx` — so there is no screen to drive and
 * nothing to assert. See the report; the copy still promises it.
 *
 * `/api/tts` is deliberately NOT mocked except where a test is about silence. It answers 503 for
 * real in this environment (`TTS_PROVIDER=browser`), which is the "speak on the device" signal.
 */
import path from "node:path";
import { devices, expect, test } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import {
  FIXTURE_DIR,
  expectNoHorizontalScroll,
  expectedCards,
  mockRead,
  noVoiceOutput,
  seedConsent,
  startReading,
  uploadFixture,
} from "./helpers";

/** Copy that lives in `components/DeclineState.tsx`, not in `lib/i18n/ui.ts`. */
const UNAVAILABLE_BODY = "而家連唔到讀紙嗰邊。示範紙照用得，成個流程都睇到。";

const cards = expectedCards("hk_en");
const warnings = cards.filter((card) => card.type === "warning");

/* -------------------------------------------------------------------------- */
/* The seam between /capture and /chat                                        */
/* -------------------------------------------------------------------------- */

test.describe("A photograph that cannot be read (V7)", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  /**
   * The whole way in, driven as a person does it: the camera, the review grid, 講俾我聽, and the
   * honest state at the other end with the sample one tap away.
   *
   * This is the only test in the suite that crosses the `sessionStorage` hand-off for real. Its
   * value is the crossing, not the 502 — `chat-briefing.spec.ts:282` already proves what the
   * failure state says and that the sample reads out of it. If this ever fails while that one
   * passes, the bug is in the hand-off, which is precisely what a split like this buys.
   */
  test("a real photograph reaches the honest state, and the sample is one tap out", async ({
    page,
  }) => {
    await mockRead(page, { status: 502 });

    await uploadFixture(page, "hk_en.png");
    await startReading(page);

    await expect(
      page.getByRole("heading", { name: UI.hant["fallback.modelUnavailable"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UNAVAILABLE_BODY, { exact: true })).toBeVisible();
    // The sheet never became "the active sheet" on the strength of a photograph nobody could read.
    await expect(page.getByRole("region", { name: UI.hant["brief.warnTitle"] })).toHaveCount(0);

    await page.getByRole("button", { name: UI.hant["capture.sample"], exact: true }).click();
    await expect(page.getByText(UI.hant["cards.sampleBanner"], { exact: true })).toBeVisible();
    await expect(page.getByText(UI.hant["brief.intro"], { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await expectNoHorizontalScroll(page);
  });
});

/* -------------------------------------------------------------------------- */
/* No voice at all                                                            */
/* -------------------------------------------------------------------------- */

/**
 * S10, re-expressed for a product where **nothing is a play button** (brief §6).
 *
 * The v1 version of this test pressed 全部讀出 and asserted that every card's play control turned
 * into 睇字. That assertion now contradicts the product: 明仔 types himself out and speaks at the
 * same time, the 讀住 waveform is a status indicator, and the only voice control on the screen is
 * the speaker toggle. Asserting a play control would pin down the exact thing the redesign
 * removed, so the behaviour is re-expressed as what it was always protecting:
 *
 *   with no voice anywhere, the WORDS still arrive, and the screen says out loud that they are
 *   all there is.
 *
 * That is the constitution's "speech output fails → on-screen text" without naming a control.
 */
test.describe("Speech output is unavailable (V7)", () => {
  test("the words arrive anyway, the screen says so, and there is no play control", async ({
    page,
  }) => {
    await seedConsent(page);
    await noVoiceOutput(page);

    await page.goto("/chat?sample=hk_en");

    // 1. The words. 明仔's opening line is typed out and committed with no sound behind it.
    await expect(page.getByText(UI.hant["brief.intro"], { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // 2. The red flags, in full, still first and still not behind a tap (constitution II).
    const block = page.getByRole("region", { name: UI.hant["brief.warnTitle"], exact: true });
    await expect(block).toBeVisible();
    for (const warning of warnings) {
      await expect(block.getByText(warning.body.yue, { exact: true })).toBeVisible();
    }
    // And each of them still traces to its own line, which is the only way to check a silent app.
    await expect(block.getByRole("button", { name: UI.hant["card.sourceLink"] })).toHaveCount(
      warnings.length,
    );

    // 3. The screen says it is silent rather than looking broken.
    await expect(page.getByText(UI.hant["fallback.noVoiceNote"], { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // 4. And it does NOT grow a play button to compensate. The speaker toggle is still the only
    //    voice control, even now that there is no voice for it to control.
    for (const gone of ["cards.playAll", "cards.play", "cards.stop", "fallback.noVoice"] as const) {
      await expect(page.getByRole("button", { name: UI.hant[gone], exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: UI.hant["chat.reading"] })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: UI.hant["chat.muteSpeaker"], exact: true }),
    ).toBeVisible();

    // 5. The teach-back loop still runs, so a silent phone can still walk the whole sheet.
    await expect(
      page.getByRole("button", { name: UI.hant["brief.understand"], exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalScroll(page);
  });
});

/* -------------------------------------------------------------------------- */
/* No speech input — see chat-briefing.spec.ts                                */
/* -------------------------------------------------------------------------- */

/*
 * "The bar goes to keyboard mode and says so honestly" is covered by
 * `tests/e2e/chat-briefing.spec.ts:196` — it deletes `SpeechRecognition`, asserts the plain
 * sentence 「而家聽唔到你講嘢，打字問就得。」, asserts the field is there, and asserts 按住講嘢 is
 * NOT, which is the whole of the v1 behaviour on the one control that replaced the voice bar.
 * `:207` then sends a typed question through it end to end. Nothing is added by saying it twice.
 */

/* -------------------------------------------------------------------------- */
/* The camera is not the way in                                               */
/* -------------------------------------------------------------------------- */

test.describe("The camera is not the way in (V7)", () => {
  test("上載相片 opens the picker, and a chosen photo reads like a photographed one", async ({
    page,
  }) => {
    await seedConsent(page);
    await mockRead(page, "hk_en");

    // Both phone profiles report touch, so `components/Capture.tsx` treats the camera as usable
    // and 拍張紙 is the primary. On a phone whose camera is refused, 上載相片 is what the family
    // reaches for — so it has to take a file and read it exactly like the camera path (S3).
    await page.goto("/");
    await page.getByRole("link", { name: UI.hant["capture.upload"] }).click();
    await expect(page.getByRole("dialog", { name: UI.hant["pick.title"] })).toBeVisible();

    await uploadFixture(page, "hk_en.png", "library");
    await startReading(page);

    await expect(page.getByText(UI.hant["brief.intro"], { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("region", { name: UI.hant["brief.warnTitle"], exact: true }),
    ).toBeVisible();
  });
});

/**
 * The laptop case (FR-024, S10).
 *
 * Both phone profiles report touch and a mobile user agent, so `components/Capture.tsx` keeps the
 * viewfinder there and the describe above never reaches the other branch. A judge opening the demo
 * on a laptop does: `readCapture()` sees no touch and a desktop UA, `/capture` opens on the review
 * grid instead of a dark panel pretending to be a lens, and it says why the camera is not on offer.
 *
 * This is still the one route to `fallback.cameraDenied` on screen, which is why it survived the
 * redesign unchanged in purpose. Only the screen it drives moved: `/` → `/capture`.
 */
test.describe("The camera is not the way in, on a laptop (V7)", () => {
  // Not `...devices["Desktop Chrome"]`: it carries `defaultBrowserType`, which forces a new
  // worker and is rejected at describe level. These are the four options the branch turns on.
  test.use({
    viewport: { width: 1280, height: 800 },
    userAgent: devices["Desktop Chrome"].userAgent,
    isMobile: false,
    hasTouch: false,
  });

  test("says why there is no viewfinder, and still reads a sheet from the library", async ({
    page,
  }) => {
    await seedConsent(page);
    await mockRead(page, "hk_en");

    await page.goto("/capture");

    // The honest reason, in the subtitle's own place, on the screen the camera would have been.
    await expect(page.getByText(UI.hant["fallback.cameraDenied"], { exact: true })).toBeVisible();
    // No viewfinder chrome at all: no shutter to press, no 完成 over a camera that never opened.
    await expect(
      page.getByRole("button", { name: UI.hant["camera.shutter"], exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(UI.hant["camera.hintFirst"], { exact: true })).toHaveCount(0);
    // The promise about the photograph is made here too — it is the screen a document is chosen on.
    await expect(page.getByText(UI.hant["review.onDevice"], { exact: true }).first()).toBeVisible();

    // 加一頁 is the way in on this branch, and it opens the picker rather than a dead camera.
    await page.getByRole("button", { name: UI.hant["review.addPage"], exact: true }).click();
    await expect(page.getByRole("dialog", { name: UI.hant["pick.title"] })).toBeVisible();

    // The fallback is only real if it reads a sheet like the camera path does.
    await page.locator('input[type="file"]').last().setInputFiles(path.join(FIXTURE_DIR, "hk_en.png"));
    await expect(page.getByRole("img", { name: "第 1 頁", exact: true }).first()).toBeVisible();
    await page
      .getByRole("button", { name: UI.hant["pick.use"].replace("{n}", "1"), exact: true })
      .click();

    await startReading(page);
    await expect(page.getByText(UI.hant["brief.intro"], { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });
});
