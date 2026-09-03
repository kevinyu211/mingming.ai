/**
 * T040 — Story 2 end to end (quickstart V8 and V9).
 *
 * The five acceptance scenarios of "Remember who she cooks for, and confirm the follow-up plan",
 * driven through the real screens on a phone viewport:
 *
 *   1. a first launch writes a profile holding a relationship label and a dialect, and nothing else;
 *   2. the plan repeats the sheet's own words, and saves nothing until 確認;
 *   3. once the follow-up date is past, the notice appears and the plan is untouched;
 *   4. "delete everything" leaves no key behind and offers a fresh setup;
 *   5. the privacy line is on every setup screen.
 *
 * Plus V9's inspection with the fullest state the phone ever holds: a profile, a confirmed plan
 * and a reading on the device, and requests that still carry none of it.
 */
import { expect, test, type Page } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import { toScript } from "../../lib/i18n/script";
import { expiryNotice } from "../../lib/rules/plan-from-reading";
import { KEY } from "../../lib/storage/local";
import {
  MOCK_ANSWER,
  acceptConsent,
  askQuestion,
  expectCaptureScreen,
  expectNoHorizontalScroll,
  mockAsk,
  mockRead,
  seedProfile,
  seedReading,
  storedReading,
  uploadFixture,
} from "./helpers";

/** The label the setup flow writes when 阿媽 is tapped. */
const LABEL = UI.hant["setup.chip.mother"];

/** Copy that lives in the page files, not in `lib/i18n/ui.ts`. */
const PLAN_LINK = "計劃";
const READ_A_SHEET = "去讀張紙";

/** The follow-up date the rules parse from "2/52": the read date plus two weeks, never the clock. */
const READ_AT = storedReading("hk_en").readAt;
const FOLLOW_UP_DATE = new Date(Date.parse(READ_AT) + 14 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

/** Well past the follow-up date in any plausible device zone, so "expired" is unambiguous. */
const AFTER_FOLLOW_UP = new Date("2026-09-20T12:00:00.000Z");

interface StoredPlan {
  items: { kind: string; label: string; when: string }[];
  confirmedAt: string | null;
  followUpDate: string | null;
}

interface StoredShape {
  version: number;
  consentedAt: string | null;
  profile?: { label: string; dialect: string; script: string };
  plan?: StoredPlan;
  reading?: { readAt: string };
}

/** Everything the phone is holding, straight out of the one localStorage key. */
async function stored(page: Page): Promise<StoredShape | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredShape) : null;
  }, KEY);
}

async function confirmedAt(page: Page): Promise<string | null> {
  return (await stored(page))?.plan?.confirmedAt ?? null;
}

/* -------------------------------------------------------------------------- */
/* V8.1, V8.2 — setup                                                         */
/* -------------------------------------------------------------------------- */

test.describe("First launch (V8, Story 2 scenarios 1 and 5)", () => {
  test("consent leads to setup, and two taps write a label and a dialect and nothing else", async ({
    page,
  }) => {
    await page.goto("/");
    await acceptConsent(page);

    // 你煮飯畀邊個？ — the first screen, with no session-language question in front of it.
    await expect(
      page.getByRole("heading", { name: UI.hant["setup.labelQuestion"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UI.hant["setup.privacy"], { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: LABEL, exact: true }).click();

    // 佢聽咩話？ — and scenario 5: the privacy line is on this screen too.
    await expect(
      page.getByRole("heading", { name: UI.hant["setup.dialectQuestion"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UI.hant["setup.privacy"], { exact: true })).toBeVisible();

    await page.getByRole("button", { name: UI.hant["language.yue"], exact: true }).click();

    // Back on the way in, with the capture screen as the first thing there.
    await expectCaptureScreen(page);

    // FR-016: a relationship label and a dialect. No name, no age, no diagnosis, nothing else.
    const state = await stored(page);
    expect(state?.profile?.label).toBe("阿媽");
    expect(Object.keys(state?.profile ?? {}).sort()).toEqual(["dialect", "label", "script"]);
    expect(state?.profile?.dialect).toBe("yue");
    expect(state?.profile?.script).toBe("hant");
    expect(state?.plan).toBeUndefined();
    expect(state?.reading).toBeUndefined();
  });

  test("the free-text label asks for a word, never a name, and stops at 12 characters", async ({
    page,
  }) => {
    await page.goto("/");
    await acceptConsent(page);

    await page.getByRole("button", { name: UI.hant["setup.chip.other"], exact: true }).click();

    const field = page.getByLabel(UI.hant["setup.otherPlaceholder"], { exact: true });
    await expect(field).toBeVisible();
    // data-model.md: `label` is at most 12 characters, enforced by the field itself.
    await expect(field).toHaveAttribute("maxlength", "12");

    // FR-016 in the copy: the prompt asks for a word for someone, never for their name, and it
    // does not invite the browser to autofill one either.
    const placeholder = await field.getAttribute("placeholder");
    expect(placeholder).toBe(UI.hant["setup.otherPlaceholder"]);
    for (const forbidden of ["名", "name", "Name"]) {
      expect(placeholder ?? "").not.toContain(forbidden);
    }
    await expect(field).toHaveAttribute("autocomplete", "off");
    await expect(field).not.toHaveAttribute("name", /.*/);

    await field.fill("阿嫲");
    await page.getByRole("button", { name: UI.hant["setup.next"], exact: true }).click();
    await page.getByRole("button", { name: UI.hant["language.cmn"], exact: true }).click();

    const state = await stored(page);
    expect(state?.profile?.label).toBe("阿嫲");
    expect(state?.profile?.dialect).toBe("cmn");
    // Mandarin brings simplified characters with it unless the reader says otherwise.
    expect(state?.profile?.script).toBe("hans");
  });
});

/* -------------------------------------------------------------------------- */
/* V8.3, V8.4 — the plan                                                      */
/* -------------------------------------------------------------------------- */

test.describe("The plan (V8, Story 2 scenarios 2 and 3)", () => {
  test("repeats the sheet's own words and saves nothing until 確認", async ({ page }) => {
    await seedReading(page, "hk_en");
    await page.goto("/plan");

    const reading = storedReading("hk_en");
    const frequencies = reading.medicines
      .map((medicine) => medicine.frequency)
      .filter((frequency): frequency is string => typeof frequency === "string");
    expect(frequencies).toEqual(["daily", "BD with meals", "nocte"]);

    const rows = page.getByRole("listitem");
    await expect(rows).toHaveCount(1 + frequencies.length);

    // The appointment, in the sheet's own shorthand: "2/52", not a date this app worked out.
    const appointment = rows.first();
    await expect(appointment.getByText(UI.hant["plan.appointment"], { exact: true })).toBeVisible();
    await expect(appointment.getByText("SOPD · fasting bloods", { exact: true })).toBeVisible();
    await expect(appointment.getByText("2/52", { exact: true })).toBeVisible();
    expect(reading.followUp[0].when).toBe("2/52");

    // Every medicine row carries its printed frequency verbatim (FR-003, FR-020).
    for (const [index, frequency] of frequencies.entries()) {
      const row = rows.nth(index + 1);
      await expect(row.getByText(UI.hant["plan.medicineTime"], { exact: true })).toBeVisible();
      await expect(row.getByText(frequency, { exact: true })).toBeVisible();
    }

    // Every row traces to a line (principle IV): the quote is verbatim page text.
    await appointment.getByRole("button", { name: /^睇張紙點寫：/ }).click();
    const sheet = page.getByRole("dialog", { name: UI.hant["source.title"], exact: true });
    await expect(sheet.getByText(reading.followUp[0].source.quote, { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: UI.hant["source.close"], exact: true }).click();

    // FR-020: it is a draft, and a draft is not on the phone.
    await expect(page.getByText(UI.hant["plan.draftNote"], { exact: true })).toBeVisible();
    expect((await stored(page))?.plan).toBeUndefined();
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: UI.hant["plan.confirm"], exact: true }).click();

    await expect.poll(() => confirmedAt(page)).not.toBeNull();
    const saved = (await stored(page))?.plan;
    expect(saved?.followUpDate).toBe(FOLLOW_UP_DATE);
    expect(saved?.followUpDate).toBe("2026-09-16");
    expect(saved?.items.map((item) => item.when)).toEqual(["2/52", ...frequencies]);

    // Confirmed: the rows stay, marked, and the calendar becomes an option.
    await expect(page.getByRole("button", { name: UI.hant["plan.confirm"] })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: UI.hant["plan.addToCalendar"], exact: true }),
    ).toBeVisible();
    await expect(rows).toHaveCount(1 + frequencies.length);
    await expect(page.getByText("已確認").first()).toBeVisible();
  });

  test("a follow-up date in the past shows the notice and changes nothing (FR-021)", async ({
    page,
  }) => {
    await seedReading(page, "hk_en");
    await page.goto("/plan");
    await page.getByRole("button", { name: UI.hant["plan.confirm"], exact: true }).click();
    await expect.poll(() => confirmedAt(page)).not.toBeNull();

    const before = (await stored(page))?.plan;
    const notice = page.getByText(expiryNotice().yue, { exact: true });
    await expect(notice).toHaveCount(0);

    // The day moves past the follow-up visit. Nothing else about the phone changes.
    await page.clock.setFixedTime(AFTER_FOLLOW_UP);
    await page.reload();

    await expect(notice).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(before?.items.length ?? 0);
    await expect(page.getByText("2/52", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: UI.hant["plan.addToCalendar"], exact: true }),
    ).toBeVisible();

    // "changes nothing on its own" (FR-021), field for field.
    expect((await stored(page))?.plan).toEqual(before);
    await expectNoHorizontalScroll(page);
  });

  test("is reached from the reading", async ({ page }) => {
    await seedProfile(page, "hk_en");
    await page.goto("/read");

    await page.getByRole("link", { name: PLAN_LINK, exact: true }).click();

    await expect(
      page.getByRole("heading", { name: UI.hant["plan.title"], exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(4);
  });

  test("with no sheet read, offers the way to read one instead of an empty list", async ({
    page,
  }) => {
    await seedProfile(page);
    await page.goto("/plan");

    await expect(page.getByRole("listitem")).toHaveCount(0);
    await expect(page.getByRole("link", { name: READ_A_SHEET, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: UI.hant["plan.confirm"] })).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* V8.5 — delete everything                                                   */
/* -------------------------------------------------------------------------- */

test.describe("Delete everything (V8, Story 2 scenario 4)", () => {
  test("removes the key and offers a fresh setup", async ({ page }) => {
    await seedProfile(page, "hk_en");
    // A confirmed plan on the phone as well, so all three things FR-017 names are there to go.
    await page.addInitScript(
      (payload: { key: string }) => {
        try {
          const raw = window.localStorage.getItem(payload.key);
          if (!raw) return;
          const state = JSON.parse(raw) as Record<string, unknown>;
          if (state.plan) return;
          state.plan = {
            items: [
              {
                kind: "appointment",
                label: "SOPD · fasting bloods",
                when: "2/52",
                source: {
                  section: "Discharge Medication(s) & Follow-up Plan",
                  lineIndex: 3,
                  quote: "FU SOPD 2/52 with fasting bloods",
                },
              },
            ],
            confirmedAt: "2026-09-02T09:20:00.000Z",
            followUpDate: "2026-09-16",
          };
          window.localStorage.setItem(payload.key, JSON.stringify(state));
        } catch {
          // No storage on this origin; nothing to add.
        }
      },
      { key: KEY },
    );

    await page.goto("/settings");

    const before = await stored(page);
    expect(before?.profile?.label).toBe("阿媽");
    expect(before?.plan?.confirmedAt).not.toBeNull();
    expect(before?.reading?.readAt).toBe(READ_AT);

    // The whole data statement is on the screen, not behind a disclosure (research.md R13).
    await expect(
      page.getByRole("heading", { name: UI.hant["settings.dataStatement"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UI.hant["agentLimits.cannot"], { exact: true })).toBeVisible();

    await page.getByRole("button", { name: UI.hant["settings.delete"], exact: true }).click();

    const confirm = page.getByRole("dialog", {
      name: UI.hant["settings.deleteConfirmTitle"],
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByText(UI.hant["settings.deleteConfirmBody"], { exact: true }),
    ).toBeVisible();

    // The cancel path first: a destructive sheet you cannot back out of is a trap.
    await confirm.getByRole("button", { name: UI.hant["settings.cancel"], exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect((await stored(page))?.profile?.label).toBe("阿媽");

    await page.getByRole("button", { name: UI.hant["settings.delete"], exact: true }).click();
    await page
      .getByRole("dialog", { name: UI.hant["settings.deleteConfirmTitle"], exact: true })
      .getByRole("button", { name: UI.hant["settings.deleteConfirm"], exact: true })
      .click();

    // FR-017: profile, plan and reading are gone because the one key is gone.
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), KEY))
      .toBeNull();

    // And the phone is back where it started: the notice, then setup.
    await expect(
      page.getByRole("dialog", { name: UI.hant["consent.title"], exact: true }),
    ).toBeVisible();
    await acceptConsent(page);
    await expect(
      page.getByRole("heading", { name: UI.hant["setup.labelQuestion"], exact: true }),
    ).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* V9 — privacy inspection with a profile on the phone                        */
/* -------------------------------------------------------------------------- */

test.describe("Privacy with a profile on the phone (V9, SC-009)", () => {
  test("the ask request carries the reading, the question and the dialect, and no label", async ({
    page,
  }) => {
    const log = await mockAsk(page, "answered");
    await seedProfile(page, "hk_en");

    await page.goto("/ask");
    await askQuestion(page, "白色嗰粒係朝早定夜晚食？");
    await expect(page.getByText(toScript(MOCK_ANSWER.yue, "hant"), { exact: true })).toBeVisible();

    expect(log.count).toBe(1);
    const body = log.bodies[0];
    expect(Object.keys(body).sort()).toEqual(["dialect", "question", "reading"]);

    const serialised = JSON.stringify(body);
    for (const forbidden of [LABEL, "label", "profile", "plan", "confirmedAt", "followUpDate"]) {
      expect(serialised, `the ask request must not carry "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test("the reading is addressed to the label, which no request has seen", async ({ page }) => {
    const readLog = await mockRead(page, "hk_en");
    const askLog = await mockAsk(page, "answered");
    await seedProfile(page);

    await page.goto("/");
    await uploadFixture(page, "hk_en.png");
    await page.getByRole("button", { name: UI.hant["capture.start"], exact: true }).click();
    await expect(page.getByRole("article").first()).toBeVisible();

    // T039: 讀畀阿媽聽, resolved on the client from the on-device profile.
    await expect(
      page.getByText(UI.hant["cards.forLabel"].replace("{label}", LABEL), { exact: true }),
    ).toBeVisible();

    expect(readLog.count).toBe(1);
    expect(Object.keys(readLog.bodies[0])).toEqual(["images"]);
    expect(JSON.stringify(readLog.bodies[0])).not.toContain(LABEL);
    expect(askLog.count).toBe(0);
    await expectNoHorizontalScroll(page);
  });
});
