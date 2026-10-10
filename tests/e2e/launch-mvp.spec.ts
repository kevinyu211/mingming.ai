/**
 * Steven’s launch cut, as one phone path Kevin can finish in under three minutes.
 *
 * The pieces already live in live-path / chat-briefing / profile-plan. This file is the
 * stitched walk: consent → demo sheet → 明白 → 「可唔可以唔食？」 → 跟進 → Settings honesty.
 * No API key. No camera. No model.
 */
import { expect, test } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import {
  BEAT,
  BRIEFING_TIMEOUT,
  acceptConsent,
  askQuestion,
  expectDisclaimer,
  expectGreeting,
  mockAsk,
  noSpeechInput,
  sayUnderstood,
} from "./helpers";

test.describe("Launch MVP happy path (under three minutes)", () => {
  test("consent → 英文示範紙 → 明白 → refuse skip → 跟進 → Settings honesty", async ({
    page,
  }) => {
    test.setTimeout(BRIEFING_TIMEOUT);
    await noSpeechInput(page);
    const askLog = await mockAsk(page, "answered");

    await page.goto("/");
    const gate = page.getByRole("dialog", { name: UI.hant["consent.title"], exact: true });
    await expect(gate).toBeVisible();
    await expect(gate.getByText(UI.hant["consent.body2"], { exact: true })).toBeVisible();
    await expect(gate.getByText(UI.hant["consent.body2"])).not.toContainText("張紙會留");
    await acceptConsent(page);

    await expect(page.getByRole("link", { name: UI.hant["home.demoEn"], exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: UI.hant["home.demoZh"], exact: true })).toBeVisible();
    await expect(page.getByText(UI.hant["review.onDevice"])).toContainText("香港以外");
    await page.getByRole("link", { name: UI.hant["home.demoEn"], exact: true }).click();

    await expectGreeting(page);
    await expect(page.getByRole("button", { name: UI.hant["brief.understand"], exact: true })).toBeVisible({
      timeout: BEAT,
    });
    await sayUnderstood(page);
    await expect(page.getByText(UI.hant["brief.warnLead"], { exact: false })).toBeVisible({
      timeout: BEAT,
    });

    await askQuestion(page, "我可唔可以唔食抗生素？");
    await expect(page.getByRole("heading", { name: UI.hant["ask.refused"] })).toBeVisible();
    expect(askLog.count).toBe(0);

    await page.goto("/track");
    await expect(page.getByRole("heading", { name: UI.hant["track.title"], exact: true })).toBeVisible();
    await expect(page.getByText(UI.hant["track.todayMeds"], { exact: true })).toBeVisible();

    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: UI.hant["settings.honesty"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UI.hant["settings.honestyBody"], { exact: true })).toBeVisible();
    await expect(page.getByText(UI.hant["settings.honestyBody"])).toContainText("唔係護士講解");
    await expect(page.getByText("香港以外", { exact: false }).first()).toBeVisible();
    await expectDisclaimer(page);
  });
});
