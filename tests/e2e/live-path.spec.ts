/**
 * T033 — the live path (quickstart V1, V4 and V5, minus the voice itself).
 *
 * These are the scenarios a judge watches: consent, the sample sheet, a photographed sheet, a
 * photo that is not a sheet, and the four ask outcomes. `/api/read` and `/api/ask` are mocked
 * from the bundled fixtures (see `helpers.ts`) so the whole path runs with no API key; the
 * card order, the source quotes and the two client-side gates are the real code.
 *
 * Speech is out of scope here — `tests/e2e/fallbacks.spec.ts` covers the no-voice path, which is
 * what this environment can actually observe.
 */
import { expect, test } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import { toScript } from "../../lib/i18n/script";
import { REFERRAL } from "../../lib/i18n/referral";
import { cardTitle } from "../../lib/rules/card-order";
import { REFUSED_MEDICINE_CHANGE } from "../../lib/rules/template-fallback";
import {
  MOCK_ANSWER,
  MOCK_CITED_CARD_ID,
  acceptConsent,
  askQuestion,
  cardTitles,
  cards,
  chooseCantonese,
  expectDisclaimer,
  expectNoHorizontalScroll,
  expectedCard,
  expectedCards,
  expectedSource,
  mockAsk,
  mockRead,
  seedConsent,
  seedProfile,
  seedReading,
  uploadFixture,
} from "./helpers";

/** Copy that lives in `components/AnswerCard.tsx`, not in `lib/i18n/ui.ts`. */
const ANSWER_UNAVAILABLE_TITLE = "而家答唔到";
const ANSWER_UNAVAILABLE_BODY = "張紙讀出嚟嗰幾張卡冇變，照樣睇得。等陣再問多次。";
const ANSWER_RETRY = "再問一次";

test.describe("Consent and the disclaimer (V1)", () => {
  test("the consent notice comes first and one tap dismisses it", async ({ page }) => {
    await page.goto("/");

    const gate = page.getByRole("dialog", { name: UI.hant["consent.title"], exact: true });
    await expect(gate).toBeVisible();
    await expect(gate.getByText(UI.hant["consent.body2"], { exact: true })).toBeVisible();
    // Nothing is rendered behind the notice — not even the first setup question (T035).
    await expect(page.getByRole("heading", { name: UI.hant["setup.labelQuestion"] })).toHaveCount(0);
    await expectDisclaimer(page);

    await acceptConsent(page);

    await expect(gate).toHaveCount(0);
    // A phone with no profile lands on setup, not on the camera (Story 2, scenario 1).
    await expect(
      page.getByRole("heading", { name: UI.hant["setup.labelQuestion"], exact: true }),
    ).toBeVisible();
    await expectDisclaimer(page);
  });

  test("the disclaimer footer is on every screen the demo visits", async ({ page }) => {
    await seedProfile(page, "hk_en");

    for (const url of ["/", "/setup", "/read?sample=hk_en", "/ask", "/read", "/plan", "/settings"]) {
      await page.goto(url);
      await expectDisclaimer(page);
    }
  });
});

test.describe("The sample sheet (V1)", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("shows the banner, then the cards in the fixed order, each with its source", async ({
    page,
  }) => {
    const expected = expectedCards("hk_en");

    await page.goto("/read?sample=hk_en");

    await expect(page.getByText(UI.hant["cards.sampleBanner"], { exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(expected.length);
    expect(await cardTitles(page)).toEqual(expected.map((card) => cardTitle(card.type, "hant")));

    // Red flags first, on their own amber ground. Colour is never the only signal, so the 警號
    // heading is asserted beside it; the card's shape itself is the designer's business.
    const first = cards(page).first();
    await expect(first.getByRole("heading")).toHaveText("警號");
    await expect(first).toHaveClass(/bg-warning-bg/);
    const warningGround = await first.evaluate((el) => getComputedStyle(el).backgroundColor);
    const medicineGround = await cards(page)
      .nth(3)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(warningGround).not.toBe(medicineGround);

    // Three warnings before any medicine, three medicines, then follow-up, diet, activity.
    const titles = await cardTitles(page);
    expect(titles.lastIndexOf(cardTitle("warning", "hant"))).toBeLessThan(
      titles.indexOf(cardTitle("medicine", "hant")),
    );
    expect(titles.filter((t) => t === cardTitle("warning", "hant"))).toHaveLength(3);
    expect(titles.filter((t) => t === cardTitle("medicine", "hant"))).toHaveLength(3);
    expect(titles).toContain(cardTitle("followUp", "hant"));
    expect(titles).toContain(cardTitle("diet", "hant"));

    // Medicines are the printed facts, verbatim: name, strength, amount, frequency (FR-003).
    // The grouped-row layout splits the frequency from strength · amount, so each fact is
    // asserted on its own rather than as one joined string — what matters is that every printed
    // value reaches the screen unchanged, not how the row arranges them.
    const amlodipine = cards(page).nth(3);
    await expect(amlodipine.getByText("Amlodipine", { exact: true })).toBeVisible();
    const medicines = expected.filter((card) => card.type === "medicine");
    expect(medicines).toHaveLength(3);
    for (const [offset, medicine] of medicines.entries()) {
      const facts = medicine.facts ?? {};
      const card = cards(page).nth(titles.indexOf(cardTitle("medicine", "hant")) + offset);
      await expect(card.getByText(String(facts.name), { exact: true })).toBeVisible();
      for (const part of [facts.strength, facts.amount, facts.frequency]) {
        if (typeof part !== "string" || part.trim().length === 0) continue;
        await expect(card.getByText(part, { exact: false }).first()).toBeVisible();
      }
    }

    // Every card here was written by the model, so every card carries the AI chip.
    for (let i = 0; i < expected.length; i += 1) {
      await expect(cards(page).nth(i).getByText(UI.hant.aiChip, { exact: true })).toBeVisible();
    }

    await expectNoHorizontalScroll(page);
  });

  test("a card's source link opens the verbatim quote and closes again", async ({ page }) => {
    await page.goto("/read?sample=hk_en");
    await expect(cards(page)).toHaveCount(expectedCards("hk_en").length);

    const warningTitle = cardTitle("warning", "hant");
    await cards(page)
      .first()
      .getByRole("button", {
        name: `${UI.hant["card.sourceLink"]}：${warningTitle}`,
        exact: true,
      })
      .click();

    const sheet = page.getByRole("dialog", { name: UI.hant["source.title"], exact: true });
    await expect(sheet).toBeVisible();
    const source = expectedSource("hk_en", "warning-0");
    await expect(sheet.getByText(source.quote, { exact: true })).toBeVisible();
    await expect(sheet.getByText(source.section, { exact: true })).toBeVisible();

    await sheet.getByRole("button", { name: UI.hant["source.close"], exact: true }).click();
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("The photo path (V1, V4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await acceptConsent(page);
    await chooseCantonese(page);
  });

  test("a photographed sheet is read into the same cards, and only the pages are sent", async ({
    page,
  }) => {
    // The delay keeps the three-step progress line on screen long enough to be observed.
    const log = await mockRead(page, "hk_en", { delayMs: 800 });
    const expected = expectedCards("hk_en");

    await uploadFixture(page, "hk_en.png");
    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();

    await expect(page.getByText(UI.hant["progress.step2"], { exact: true })).toBeVisible();

    await expect(cards(page)).toHaveCount(expected.length);
    expect(await cardTitles(page)).toEqual(expected.map((card) => cardTitle(card.type, "hant")));
    await expect(cards(page).nth(3).getByText("Amlodipine", { exact: true })).toBeVisible();

    // Privacy is structural (FR-019, SC-009): the body carries the pixels and nothing else.
    expect(log.count).toBe(1);
    const body = log.bodies[0];
    expect(Object.keys(body)).toEqual(["images"]);
    const images = body.images as Record<string, unknown>[];
    expect(images).toHaveLength(1);
    expect(Object.keys(images[0]).sort()).toEqual(["base64", "mediaType"]);
    expect(images[0].mediaType).toBe("image/jpeg");

    await expectNoHorizontalScroll(page);
  });

  test("a photo that is not a discharge sheet is declined and produces no cards", async ({
    page,
  }) => {
    await mockRead(page, "unknown");

    await uploadFixture(page, "not_a_sheet.jpg");
    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();

    await expect(
      page.getByRole("heading", { name: UI.hant["notASheet.title"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UI.hant["notASheet.body"], { exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });
});

test.describe("Ask the sheet (V5)", () => {
  // Reading a sheet and asking about it is now one screen (`/read`): the questions append to the
  // same thread the sheet lives in, and the voice bar is pinned there. `/ask` still redirects in.
  test.beforeEach(async ({ page }) => {
    await seedReading(page, "hk_en");
  });

  test("the old /ask link redirects into the one-screen conversation", async ({ page }) => {
    await page.goto("/ask");

    await expect(page).toHaveURL(/\/read$/);
    // The way to ask is on the same screen as the sheet now, not a separate route.
    await expect(
      page.getByRole("textbox", { name: UI.hant["ask.placeholder"], exact: true }),
    ).toBeVisible();
  });

  test("a question about changing a medicine is refused, and no request is made", async ({
    page,
  }) => {
    // The mock is armed on purpose: the point is that the client gate answers first (FR-011).
    const log = await mockAsk(page, "answered");
    await page.goto("/read");

    await askQuestion(page, "可唔可以唔食？");

    await expect(
      page.getByRole("heading", { name: UI.hant["ask.refused"], exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(toScript(REFUSED_MEDICINE_CHANGE.yue, "hant"), { exact: true }),
    ).toBeVisible();
    // FR-011: the refusal shows the contact line the sheet printed, verbatim.
    await expect(page.getByText("Ward enquiries: 2xxx xxxx", { exact: true })).toBeVisible();
    expect(log.count).toBe(0);

    await expectNoHorizontalScroll(page);
  });

  test("a question containing a crisis phrase shows the referral card, and no request is made", async ({
    page,
  }) => {
    const log = await mockAsk(page, "answered");
    await page.goto("/read");

    await askQuestion(page, "我想自殺");

    await expect(
      page.getByRole("heading", { name: UI.hant["ask.referral"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(REFERRAL.yue, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /2389 2222/ })).toBeVisible();
    expect(log.count).toBe(0);
  });

  test("a question the sheet answers cites its card and shows the source quote", async ({
    page,
  }) => {
    const log = await mockAsk(page, "answered");
    await page.goto("/read");

    await askQuestion(page, "白色嗰粒係朝早定夜晚食？");

    await expect(
      page.getByRole("heading", { name: UI.hant["ask.answered"], exact: true }),
    ).toBeVisible();
    // The chip names the card the answer came from.
    const citedTitle = cardTitle(expectedCard("hk_en", MOCK_CITED_CARD_ID).type, "hant");
    await expect(
      page.getByText(`${UI.hant["ask.answeredFrom"]} · ${citedTitle}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(toScript(MOCK_ANSWER.yue, "hant"), { exact: true })).toBeVisible();
    // The AI note rides on the answer. On this one screen the sheet's own cards each carry the same
    // chip, so the assertion is scoped to the answer message (the "答案" region) rather than the page.
    const answerMessage = page.getByRole("region", { name: UI.hant["ask.answered"], exact: true });
    await expect(answerMessage.getByText(UI.hant.aiChip, { exact: true })).toBeVisible();

    await page
      .getByRole("button", {
        name: `${UI.hant["card.sourceLink"]}：${UI.hant["ask.answered"]}`,
        exact: true,
      })
      .click();
    const sheet = page.getByRole("dialog", { name: UI.hant["source.title"], exact: true });
    await expect(
      sheet.getByText(expectedSource("hk_en", MOCK_CITED_CARD_ID).quote, { exact: true }),
    ).toBeVisible();

    // SC-009: the ask request carries the reading, the question and the dialect. Nothing else.
    expect(log.count).toBe(1);
    expect(Object.keys(log.bodies[0]).sort()).toEqual(["dialect", "question", "reading"]);
  });

  test("a model outage shows the calm state, with the cards still correct", async ({ page }) => {
    await mockAsk(page, { status: 502 });
    await page.goto("/read");

    await askQuestion(page, "白色嗰粒係朝早定夜晚食？");

    await expect(
      page.getByRole("heading", { name: ANSWER_UNAVAILABLE_TITLE, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(ANSWER_UNAVAILABLE_BODY, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: ANSWER_RETRY, exact: true })).toBeVisible();
  });
});

test.describe("The script toggle (V1)", () => {
  test("switches the on-screen text to simplified while the quote stays verbatim", async ({
    page,
  }) => {
    await seedConsent(page);
    // The mainland sheet's quotes are printed in simplified characters, so a converted quote
    // would be visible: that is exactly what must not happen (FR-003).
    const expected = expectedCards("cn_zh");
    const warning = expected[0];
    const source = expectedSource("cn_zh", warning.id);
    expect(toScript(source.quote, "hant")).not.toBe(source.quote);

    await page.goto("/read?sample=cn_zh");
    await expect(cards(page)).toHaveCount(expected.length);

    expect(await cardTitles(page)).toEqual(expected.map((card) => cardTitle(card.type, "hant")));
    await expect(
      cards(page).first().getByText(toScript(warning.body.yue, "hant"), { exact: true }),
    ).toBeVisible();

    // The header control is now the three-way interface-language switch (繁 / 简 / EN); picking a
    // Chinese option converts the card text to that script as the old script toggle did.
    await page
      .getByRole("group", { name: "Interface language" })
      .getByRole("button", { name: "简体中文", exact: true })
      .click();

    expect(await cardTitles(page)).toEqual(expected.map((card) => cardTitle(card.type, "hans")));
    await expect(
      cards(page).first().getByText(toScript(warning.body.yue, "hans"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UI.hans["cards.sampleBanner"], { exact: true })).toBeVisible();

    // The quote is page text, so it is unchanged by the toggle.
    await cards(page)
      .first()
      .getByRole("button", {
        name: `${UI.hans["card.sourceLink"]}：${cardTitle("warning", "hans")}`,
        exact: true,
      })
      .click();
    const sheet = page.getByRole("dialog", { name: UI.hans["source.title"], exact: true });
    await expect(sheet.getByText(source.quote, { exact: true })).toBeVisible();
  });
});
