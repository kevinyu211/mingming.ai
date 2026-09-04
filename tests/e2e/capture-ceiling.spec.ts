/**
 * The six-page ceiling on `/capture`, driven through the real screen.
 *
 * `tests/unit/capture-ceiling.test.ts` proves the arithmetic. This proves the part that actually
 * protects somebody: that the refusal is ON SCREEN, in all three places it can bite, and that
 * choosing more photographs than there is room for says how many did not fit rather than keeping
 * the first six and going quiet.
 *
 * It matters because a Hong Kong patient leaves with a stack — 出院紙, 覆診紙, 抽血紙, 治療處方 —
 * and the follow-up date is printed on a different sheet from the medicines
 * (docs/real-sheet-evidence.md §1). A page dropped without a word is a missing medicine.
 *
 * The two inputs are deliberately different, and the tests follow that: the camera takes ONE
 * photograph per press, so the ceiling can only be reached a page at a time and the refusal there
 * is a spent shutter. The photo library takes a whole selection at once, so that is the only route
 * by which pages can overflow — and the only place a count of what did not fit means anything.
 *
 * No API is touched: nothing here gets as far as 講俾我聽.
 */
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import { FIXTURE_DIR, expectNoHorizontalScroll, seedConsent } from "./helpers";

/** One real sheet photograph, repeated, so a selection of N can be built from it. */
function pages(count: number): string[] {
  return Array.from({ length: count }, () => path.join(FIXTURE_DIR, "hk_en.png"));
}

/**
 * Copy that lives in `components/Capture.tsx`, not in `lib/i18n/ui.ts` — the overflow refusal,
 * which the design canvas has no line for. Written to the same banned-term rule as everything in
 * the interface. If it moves into `lib/i18n/ui.ts`, this constant comes with it.
 */
const TURNED_AWAY_2 = "有 2 張加唔到，最多得 6 張。";

/** The hidden inputs: the camera first, the photo library second (components/Capture.tsx). */
const CAMERA_INPUT = 0;
const LIBRARY_INPUT = 1;

/** One press of the shutter, and the wait for the page it produced. */
async function shoot(page: Page, nth: number): Promise<void> {
  await page.locator('input[type="file"]').nth(CAMERA_INPUT).setInputFiles(pages(1));
  await expect(page.getByText(`${nth}/6`, { exact: true })).toBeVisible();
}

test.describe("Six pages is the ceiling, and it refuses out loud", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("the camera says 夠 6 頁喇 over a spent shutter, and 加一頁 goes dead", async ({ page }) => {
    await page.goto("/capture");

    // Both phone profiles report touch, so `components/Capture.tsx` opens on the camera.
    const shutter = page.getByRole("button", { name: UI.hant["camera.shutter"], exact: true });
    await expect(shutter).toBeEnabled();
    await expect(page.getByText(UI.hant["camera.hintFirst"], { exact: true })).toBeVisible();

    await shoot(page, 1);
    await expect(page.getByText(UI.hant["camera.hintNext"], { exact: true })).toBeVisible();
    for (let n = 2; n <= 5; n += 1) await shoot(page, n);
    await expect(shutter).toBeEnabled();

    await shoot(page, 6);

    // PLACE 3: the hint stops being advice and becomes a refusal; the shutter no longer fires.
    await expect(page.getByText(UI.hant["camera.hintFull"], { exact: true })).toBeVisible();
    await expect(page.getByText(UI.hant["camera.hintFullSub"], { exact: true })).toBeVisible();
    await expect(shutter).toBeDisabled();

    await page.getByRole("button", { name: UI.hant["camera.done"], exact: true }).click();
    // By alt text, not by role alone: the dev overlay contributes an image of its own.
    await expect(page.getByRole("img", { name: /第 \d+ 頁/ })).toHaveCount(6);

    // PLACE 2: the 加一頁 tile stops offering, states the limit, and cannot be pressed.
    const addTile = page.getByRole("button", { name: UI.hant["pick.subtitleFull"], exact: true });
    await expect(addTile).toBeVisible();
    await expect(addTile).toBeDisabled();
    await expect(
      page.getByRole("button", { name: UI.hant["review.addPage"], exact: true }),
    ).toHaveCount(0);

    await expectNoHorizontalScroll(page);
  });

  test("the picker states the limit in its subtitle, before and after it is reached", async ({
    page,
  }) => {
    await page.goto("/capture?pick=1");
    const sheet = page.getByRole("dialog", { name: UI.hant["pick.title"] });

    // PLACE 1, before: the subtitle carries 最多 6 張 while there is still room.
    await expect(sheet.getByText(UI.hant["pick.subtitle"], { exact: true })).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: UI.hant["pick.useNone"], exact: true }),
    ).toBeDisabled();

    // Eight photographs of a four-page discharge stack, chosen in one go.
    await page.locator('input[type="file"]').nth(LIBRARY_INPUT).setInputFiles(pages(8));

    // PLACE 1, after: the subtitle flips to the refusal, in the subtitle's own place.
    await expect(sheet.getByText(UI.hant["pick.subtitleFull"], { exact: true })).toBeVisible();
    await expect(sheet.getByText(UI.hant["pick.subtitle"], { exact: true })).toHaveCount(0);

    // And the two that did not fit are said in words, not dropped in silence. It appears twice —
    // once in the sheet and once on the review screen behind it — which is the point: closing the
    // sheet must not close the only notice that pages were refused.
    await expect(page.getByText(TURNED_AWAY_2, { exact: true })).toHaveCount(2);

    // Exactly six went in, and the confirm button counts them.
    await expect(
      sheet.getByRole("button", { name: UI.hant["pick.use"].replace("{n}", "6"), exact: true }),
    ).toBeEnabled();

    await expectNoHorizontalScroll(page);
  });
});
