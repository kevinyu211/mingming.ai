import { expect, test } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import {
  activeSheet,
  expectGreeting,
  mockRead,
  noSpeechInput,
  seedConsent,
  seedSheet,
  startReading,
  storedReading,
  uploadFixture,
  wireReading,
} from "./helpers";
import { buildCards } from "../../lib/rules/card-order";
import { KEY } from "../../lib/storage/local";

test.describe("read lifecycle", () => {
  test("can cancel a pending read without replacing the existing route state", async ({ page }) => {
    await seedConsent(page);
    await seedSheet(page, activeSheet(storedReading("hk_en")));
    await mockRead(page, "hk_en", { delayMs: 2_000 });
    await uploadFixture(page, "hk_en.png");
    await startReading(page);

    await expect(page.getByRole("button", { name: UI.hant["reading.cancel"], exact: true })).toBeVisible();
    await page.getByRole("button", { name: UI.hant["reading.cancel"], exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: UI.hant["capture.photo"] })).toBeVisible();
    await expect(page.getByRole("heading", { name: UI.hant["home.nowTalking"], exact: true })).toBeVisible();
    await page.waitForTimeout(2_500);
    await expect(page.getByRole("heading", { name: UI.hant["home.nowTalking"], exact: true })).toBeVisible();
    const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), KEY);
    expect(after.sheets.active.id).toBe("sheet-e2e");
    expect(after.sheets.archive).toHaveLength(0);
  });

  test("retains validated cards after a successful read and reload", async ({ page }) => {
    await seedConsent(page);
    await noSpeechInput(page);
    const reading = wireReading("hk_en");
    const cards = buildCards(reading).map((card) =>
      card.id === "medicine-0"
        ? {
            ...card,
            body: {
              yue: "保留原文，請先核對張紙。",
              cmn: "保留原文，请先核对纸张。",
              en: "Keep the printed line and check the sheet first.",
            },
            aiGenerated: false,
            unverified: true,
          }
        : card,
    );
    await page.route("**/api/read", async (route) => {
      const ndjson = [
        { event: "status", phase: "reading" },
        ...cards.map((card) => ({ event: "card", card })),
        { event: "done", reading, filter: { regenerated: 0, templated: 0 } },
      ]
        .map((event) => `${JSON.stringify(event)}\n`)
        .join("");
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson });
    });
    await uploadFixture(page, "hk_en.png");
    await startReading(page);
    await expectGreeting(page);

    const beforeReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), KEY);
    const storedCard = beforeReload.sheets.active.validatedCards.find(
      (card: { id: string }) => card.id === "medicine-0",
    );
    expect(storedCard).toMatchObject({ aiGenerated: false, unverified: true });
    expect(storedCard.body.en).toContain("Keep the printed line");

    await page.reload();
    await expectGreeting(page);
    const afterReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), KEY);
    const reloadedCard = afterReload.sheets.active.validatedCards.find(
      (card: { id: string }) => card.id === "medicine-0",
    );
    expect(reloadedCard).toMatchObject({ aiGenerated: false, unverified: true });
    expect(reloadedCard.body.en).toContain("Keep the printed line");
    await page.goto("/track");
    await expect(page.getByText("Metformin", { exact: false }).first()).toBeVisible();
  });
});
