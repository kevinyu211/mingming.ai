/**
 * T033/T034 — the failure paths (quickstart V7), for the parts a browser can actually prove.
 *
 * The constitution treats failure paths as features, so each one has a designed screen and each
 * way out is one tap (SC-007). What is covered here: the reading service down (502), a reading
 * that will not validate (422), a body over the limit (413), no voice at all, no speech input,
 * and the camera fallbacks.
 *
 * `/api/tts` is deliberately NOT mocked. It answers 503 for real in this environment
 * (`TTS_PROVIDER=browser`), which is the "speak on the device" signal — so deleting
 * `window.speechSynthesis` is enough to reach the text-only state honestly.
 */
import { devices, expect, test } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import { toScript } from "../../lib/i18n/script";
import {
  acceptConsent,
  cardTitles,
  cards,
  chooseCantonese,
  expectNoHorizontalScroll,
  expectedCards,
  mockRead,
  seedConsent,
  seedReading,
  uploadFixture,
} from "./helpers";

/** Copy that lives in `components/DeclineState.tsx`, not in `lib/i18n/ui.ts`. */
const INVALID_TITLE = "讀唔到呢張紙";
const INVALID_BODY = "影清楚啲再試多次，或者用示範紙睇下點運作。";
const UNAVAILABLE_BODY = "而家連唔到讀紙嗰邊。示範紙照用得，成個流程都睇到。";
const TYPED_TITLE = "打字輸入仲未做得到";
const TYPED_BODY = "呢個版本淨係讀得到相。影張相，或者用示範紙睇下點運作。";

/** Copy that lives in `app/ask/page.tsx`. */
const MIC_UNAVAILABLE = "而家聽唔到你講嘢，打字問就得。";

test.describe("The reading service is down or refuses (V7)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await acceptConsent(page);
    await chooseCantonese(page);
  });

  test("502 offers the bundled sample sheet, and the sample reads", async ({ page }) => {
    await mockRead(page, { status: 502 });

    await uploadFixture(page, "hk_en.png");
    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();

    await expect(
      page.getByRole("heading", { name: UI.hant["fallback.modelUnavailable"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UNAVAILABLE_BODY, { exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);

    // One tap out (SC-007): the sample is bundled, so it works with the route still failing.
    await page.getByRole("button", { name: UI.hant["capture.sample"], exact: true }).click();

    await expect(page.getByText(UI.hant["cards.sampleBanner"], { exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(expectedCards("hk_en").length);
    await expectNoHorizontalScroll(page);
  });

  test("422 shows the couldn't-read state with the sample sheet beside it", async ({ page }) => {
    await mockRead(page, { status: 422 });

    await uploadFixture(page, "hk_en.png");
    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();

    await expect(page.getByRole("heading", { name: INVALID_TITLE, exact: true })).toBeVisible();
    await expect(page.getByText(INVALID_BODY, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: UI.hant["capture.retake"], exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: UI.hant["capture.sample"], exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });

  test("413 re-downscales and retries once, then ends in an honest state", async ({ page }) => {
    const log = await mockRead(page, { status: 413 });

    await uploadFixture(page, "hk_en.png");
    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();

    // contracts/api-read.md: "Client re-downscales and retries once". A second 413 lands on the
    // invalid-reading state, honest and one tap from the sample sheet.
    await expect(page.getByRole("heading", { name: INVALID_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: UI.hant["capture.sample"], exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);

    // Exactly two requests: the original pages, then the smaller re-encode.
    expect(log.count).toBe(2);
  });
});

test.describe("Speech output is unavailable (V7)", () => {
  test("the play controls become the text-only state and the cards stay readable", async ({
    page,
  }) => {
    await seedConsent(page);
    await page.addInitScript(() => {
      // Window interface members are own properties of the global object, so this really removes
      // it: `lib/speech/tts.ts` then falls through the cloud path (503) to text-only.
      const globalWindow = window as unknown as Record<string, unknown>;
      delete globalWindow.speechSynthesis;
      delete globalWindow.SpeechSynthesisUtterance;
    });

    await page.goto("/read?sample=hk_en");

    const expected = expectedCards("hk_en");
    await expect(cards(page)).toHaveCount(expected.length);

    const playCue = page.getByRole("button", { name: UI.hant["cards.play"], exact: true });
    await expect(playCue).toBeVisible();
    await playCue.click();

    // S10: every card's play control becomes 睇字, and the bar says where the words are.
    await expect(page.getByText(UI.hant["fallback.noVoice"], { exact: true })).toHaveCount(
      expected.length,
    );
    await expect(page.getByText(UI.hant["fallback.noVoiceNote"], { exact: true })).toBeVisible();

    // The point of the fallback: the words are still on screen.
    await expect(
      cards(page).first().getByText(toScript(expected[0].body.yue, "hant"), { exact: true }),
    ).toBeVisible();
    expect(await cardTitles(page)).toHaveLength(expected.length);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("Speech input is unavailable (V7, Story 1 scenario 11)", () => {
  test("the mic shows its unavailable state and the text box takes over", async ({ page }) => {
    await seedReading(page, "hk_en");
    await page.addInitScript(() => {
      const globalWindow = window as unknown as Record<string, unknown>;
      delete globalWindow.SpeechRecognition;
      delete globalWindow.webkitSpeechRecognition;
      delete globalWindow.MediaRecorder;
    });

    await page.goto("/ask");

    // `components/MicButton.tsx` renames itself to the typed-input label when there is no API.
    const mic = page.getByRole("button", { name: UI.hant["capture.type"], exact: true });
    await expect(mic).toBeVisible();
    await expect(page.getByText(MIC_UNAVAILABLE, { exact: true })).toBeVisible();

    // Holding a dead mic moves focus to the field instead of failing silently. The button carries
    // `aria-disabled` (it cannot listen) but is not `disabled` and still handles the tap, exactly
    // as it would on a phone — so the actionability check is skipped rather than waited out.
    await mic.click({ force: true });
    const field = page.getByRole("textbox", { name: UI.hant["ask.placeholder"], exact: true });
    await expect(field).toBeFocused();

    await field.fill("白色嗰粒係朝早定夜晚食？");
    await expect(
      page.getByRole("button", { name: UI.hant["ask.send"], exact: true }),
    ).toBeEnabled();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("The camera is not the way in (V7)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await acceptConsent(page);
    await chooseCantonese(page);
  });

  test("the photo-library picker takes a file", async ({ page }) => {
    await mockRead(page, "hk_en");

    // Both projects emulate a touch device, so `components/Capture.tsx` treats the camera as
    // usable: the big tile is the camera, and the photo library is the secondary way in
    // (S3). On a phone that refuses the camera, this secondary picker is what the user reaches
    // for, so it has to take a file and read it exactly like the camera path.
    await expect(
      page.getByRole("button", { name: UI.hant["capture.title"], exact: true }),
    ).toBeVisible();
    const libraryButton = page.getByRole("button", { name: UI.hant["capture.library"], exact: true });
    await expect(libraryButton).toHaveCount(1);
    await expect(libraryButton).toBeVisible();

    await uploadFixture(page, "hk_en.png", "library");
    await expect(page.getByRole("img", { name: "第 1 頁", exact: true })).toBeVisible();

    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();
    await expect(cards(page)).toHaveCount(expectedCards("hk_en").length);
  });

  test("the typed-sheet path says honestly what it cannot do yet", async ({ page }) => {
    await page.getByRole("button", { name: UI.hant["capture.type"], exact: true }).click();

    const box = page.getByLabel(UI.hant["capture.type"]);
    await expect(box).toBeVisible();
    await box.fill("Amlodipine 5mg 1 tab daily");
    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();

    const notice = page.getByRole("region", { name: TYPED_TITLE, exact: true });
    await expect(notice).toBeVisible();
    await expect(notice.getByText(TYPED_BODY, { exact: true })).toBeVisible();
    await expect(
      notice.getByRole("button", { name: UI.hant["capture.sample"], exact: true }),
    ).toBeVisible();
  });
});

/**
 * The laptop case (FR-024, S10).
 *
 * Both phone profiles report touch and a mobile user agent, so `components/Capture.tsx` keeps the
 * camera tile there and the describe above never reaches the other branch. A judge opening the
 * demo on a laptop does: `readCapture()` sees no touch and a desktop UA, the tile becomes the
 * photo-library picker, and it says why the camera is not on offer. Nothing else covered that,
 * and `fallback.cameraDenied` is the one S10 string with no other route to the screen.
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

  test("the tile becomes the library picker, says why, and still reads a sheet", async ({
    page,
  }) => {
    await mockRead(page, "hk_en");
    await page.goto("/");
    await acceptConsent(page);
    await chooseCantonese(page);

    await expect(page.getByText(UI.hant["fallback.cameraDenied"], { exact: true })).toBeVisible();
    // The tile IS the picker here, so there is no second library button beside it, and the
    // camera tile's name is gone from the screen entirely.
    await expect(
      page.getByRole("button", { name: UI.hant["capture.library"], exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: UI.hant["capture.title"], exact: true }),
    ).toHaveCount(0);

    // The fallback is only real if it reads a sheet like the camera path does.
    await uploadFixture(page, "hk_en.png", "library");
    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();
    await expect(cards(page)).toHaveCount(expectedCards("hk_en").length);
  });
});
