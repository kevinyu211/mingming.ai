import { expect, test } from "@playwright/test";
import { mockRead, seedConsent, startReading, uploadFixture } from "./helpers";

test("a failed navigation handoff keeps the photos and does not submit until retry", async ({ page }) => {
  await seedConsent(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    let failOnce = true;
    Storage.prototype.setItem = function (key, value) {
      if (key === "fitornot.pending-images" && failOnce) {
        failOnce = false;
        throw new DOMException("Storage full", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });
  const requests = await mockRead(page, "hk_en");
  await uploadFixture(page, "hk_en.png", "library");
  await startReading(page);
  await expect(page.getByRole("alert").filter({ hasText: "相片仲喺呢度" })).toBeVisible();
  await expect(page).toHaveURL(/\/capture/);
  await expect(page.getByRole("img", { name: "第 1 頁", exact: true })).toBeVisible();
  expect(requests.count).toBe(0);
  await startReading(page);
  await expect(page).toHaveURL(/\/chat/);
  await expect.poll(() => requests.count).toBe(1);
});
