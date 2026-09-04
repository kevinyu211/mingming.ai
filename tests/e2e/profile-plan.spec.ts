/**
 * 跟進, and the profile behind it (quickstart V8 and V9, brief §7).
 *
 * The v1 version of this file drove `/plan`: a draft you read, confirmed with 確認, and which
 * saved nothing until you did. That screen is gone — `/plan` is a redirect now — and the follow-up
 * is a tab showing the ONE active sheet's appointment, medicines and warning signs, with no draft
 * and no confirmation step. So the *scenarios* survive and the screen underneath them changed:
 *
 *   · the plan repeats the sheet's own words        → the dose cards' 「張紙寫：」 blocks
 *   · a follow-up date the rules could read         → the appointment card's countdown
 *   · a follow-up line they could not               → the printed words, and NO countdown
 *   · the profile is a label and a dialect, no more → unchanged, `/setup`
 *   · delete everything leaves no key behind        → unchanged, `/settings`
 *
 * And three v2 rules that had no browser coverage at all: a `stopped` medicine gets no counter
 * and no 食咗 anywhere, 食咗 counts *times left today* and survives a reload, and nothing on this
 * screen ever names a clock time or a part of the day (brief §2, rules 7 and 8).
 *
 * Everything here runs off a seeded sheet rather than a photograph, because what is being tested
 * is what the screen does with a reading — not how the reading arrived, which `fallbacks.spec.ts`
 * and `chat-briefing.spec.ts` own.
 */
import { expect, test, type Page } from "@playwright/test";
import { formatYmd } from "../../components/home/format";
import { UI } from "../../lib/i18n/ui";
import { doseTargets } from "../../lib/rules/doses";
import { KEY } from "../../lib/storage/local";
import {
  MOTHER,
  acceptConsent,
  activeSheet,
  archivedSheet,
  expectHomeScreen,
  expectNoClockTime,
  expectNoHorizontalScroll,
  seedConsent,
  seedProfile,
  seedSheet,
  storedReading,
  withFollowUpWhen,
  withStoppedMedicine,
} from "./helpers";

/** The label the setup flow writes when 阿媽 is tapped. */
const LABEL = UI.hant["setup.chip.mother"];

/** Copy that lives in `components/track/TrackScreen.tsx`, not in `lib/i18n/ui.ts`. */
const NO_SHEET = "仲未讀過出院紙，所以未有嘢跟進。拍張紙先。";

/**
 * 「日之後」 — the words the appointment card puts AFTER the big numeral (`track.daysAfter` is
 * 「{n} 日之後」, so the count comes first and only the tail is a fixed string).
 *
 * Pulled off the template rather than typed out, because its absence is what "no countdown" means
 * in the test below: a hard-coded copy here would keep asserting a sentence the interface no
 * longer says.
 */
const DAYS_AFTER = UI.hant["track.daysAfter"].split("{n}")[1].trim();

/**
 * What 跟進 is allowed to say about each medicine on the Hong Kong sheet — asked of the rules
 * rather than written out here.
 *
 * Deliberately derived. Which printed clauses `timesPerDay` recognises is a live decision that has
 * already moved once (`daily` and `nocte` were refused, then admitted as one a day), and a list of
 * literals here would either go stale silently or pin the rules in place from the test suite. What
 * this file is actually protecting is the *shape* of the answer: a clause the rules read gets a
 * count and a 食咗, a clause they did not gets the printed words and nothing else, and either way
 * the clause reaches the screen verbatim.
 */
const TARGETS = doseTargets(storedReading("hk_en"));
const COUNTABLE = TARGETS.filter((t) => !t.stopped && !t.asNeeded && t.total > 0);
const UNCOUNTABLE = TARGETS.filter((t) => t.stopped || t.asNeeded || t.total <= 0);

/** The medicine to count down, chosen so there is more than one dose to press through. */
const COUNTED = COUNTABLE.find((t) => t.total >= 2) ?? COUNTABLE[0];

interface StoredShape {
  version: number;
  consentedAt: string | null;
  profile?: { label: string; dialect: string; script: string };
  sheets?: { active: { doses?: Record<string, { taken: number; day: string }> } | null };
}

/** Everything the phone is holding, straight out of the one localStorage key. */
async function stored(page: Page): Promise<StoredShape | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredShape) : null;
  }, KEY);
}

/** The 跟進 card for one medicine, found by the name printed at the top of it. */
function doseCard(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

/* -------------------------------------------------------------------------- */
/* V8.1, V8.2 — the profile                                                   */
/* -------------------------------------------------------------------------- */

test.describe("First launch (V8, Story 2 scenarios 1 and 5)", () => {
  test("consent leads to 記錄, not to a questionnaire", async ({ page }) => {
    await page.goto("/");

    const gate = page.getByRole("dialog", { name: UI.hant["consent.title"], exact: true });
    await expect(gate).toBeVisible();
    await acceptConsent(page);

    // v2 turned this around: 記錄 is the way in and a phone with no profile is not held at a
    // form before it can photograph anything. The interface language and the dialect both have
    // defaults, and Cantonese is the one a first run gets.
    await expectHomeScreen(page);
    await expect(page.getByText(UI.hant["home.emptyMascot"], { exact: true })).toBeVisible();
    // Nothing has been written about anybody yet.
    expect((await stored(page))?.profile).toBeUndefined();
    await expectNoHorizontalScroll(page);
  });

  test("two taps write a label and a dialect, and nothing else", async ({ page }) => {
    await seedConsent(page);
    // `/setup` is reached by URL here because nothing in v2 links to it — see the report. The
    // screen itself is unchanged, and it is still where FR-016's one and only profile is written.
    await page.goto("/setup");

    await expect(
      page.getByRole("heading", { name: UI.hant["setup.labelQuestion"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UI.hant["setup.privacy"], { exact: true })).toBeVisible();

    await page.getByRole("button", { name: LABEL, exact: true }).click();

    // 佢聽咩話？ — and scenario 5: the privacy line is on this screen too.
    await expect(
      page.getByRole("heading", { name: UI.hant["setup.dialectQuestion"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UI.hant["setup.privacy"], { exact: true })).toBeVisible();

    await page.getByRole("button", { name: UI.hant["language.yue"], exact: true }).click();

    // Setup hands back to 記錄, which is the way in now rather than a camera screen.
    await expectHomeScreen(page);

    // FR-016: a relationship label and a dialect. No name, no age, no diagnosis, nothing else.
    const state = await stored(page);
    expect(state?.profile?.label).toBe("阿媽");
    expect(Object.keys(state?.profile ?? {}).sort()).toEqual(["dialect", "label", "script"]);
    expect(state?.profile?.dialect).toBe("yue");
    expect(state?.profile?.script).toBe("hant");
  });

  test("the free-text label asks for a word, never a name, and stops at 12 characters", async ({
    page,
  }) => {
    await seedConsent(page);
    await page.goto("/setup");

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
/* 跟進 — the medicines                                                        */
/* -------------------------------------------------------------------------- */

test.describe("跟進 repeats the sheet's own words (V8, Story 2 scenario 2)", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
    await seedSheet(page, activeSheet(storedReading("hk_en")));
  });

  test("one card per medicine, each quoting its printed clause verbatim", async ({ page }) => {
    await page.goto("/track");

    // The strip that makes the tab honest: 跟進 is not a global list, it is THIS sheet's follow-up.
    await expect(page.getByText(UI.hant["track.following"], { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: UI.hant["track.todayMeds"] })).toBeVisible();

    for (const target of TARGETS) {
      const card = doseCard(page, target.name);
      await expect(card, `跟進 must show a card for ${target.name}`).toHaveCount(1);
      // FR-003: the printed frequency reaches the screen unchanged, inside the one wrapper the
      // interface uses for page text.
      await expect(
        card.getByText(UI.hant["card.printed"].replace("{text}", target.printed), { exact: true }),
      ).toBeVisible();
    }

    // A clause the rules read gets a count of times remaining today and a way to record one…
    for (const target of COUNTABLE) {
      const card = doseCard(page, target.name);
      await expect(
        card.getByText(UI.hant["dose.left"].replace("{n}", String(target.total)), { exact: true }),
      ).toBeVisible();
      await expect(
        card.getByRole("button", { name: UI.hant["dose.take"], exact: true }),
      ).toBeVisible();
    }

    // …and a clause they could not read gets neither. A number invented from a line the rules
    // declined to parse would be worse than the line itself, which is right there on the card.
    for (const target of UNCOUNTABLE) {
      await expect(
        doseCard(page, target.name).getByRole("button", { name: UI.hant["dose.take"] }),
      ).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: UI.hant["dose.take"], exact: true })).toHaveCount(
      COUNTABLE.length,
    );

    // 危險訊號, always present, because the red-flag slot is never empty (constitution II).
    await expect(
      page.getByRole("button", { name: UI.hant["track.warnings"].replace("{n}", "3") }),
    ).toBeVisible();

    await expectNoHorizontalScroll(page);
  });

  test("食咗 counts times left today, and the count survives a reload", async ({ page }) => {
    expect(COUNTED, "hk_en must print at least one clause the rules can count").toBeTruthy();
    await page.goto("/track");

    const card = () => doseCard(page, COUNTED.name);
    const take = () => card().getByRole("button", { name: UI.hant["dose.take"], exact: true });
    const left = (n: number) =>
      card().getByText(UI.hant["dose.left"].replace("{n}", String(n)), { exact: true });

    await take().click();
    await expect(left(COUNTED.total - 1)).toBeVisible();

    // The count is on the phone, under the sheet it belongs to, with the calendar day it counts
    // for — which is what makes tomorrow start again at the full number rather than carrying over.
    const doses = (await stored(page))?.sheets?.active?.doses ?? {};
    expect(doses[COUNTED.key]?.taken).toBe(1);
    expect(doses[COUNTED.key]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.reload();
    await expect(left(COUNTED.total - 1)).toBeVisible();

    // Pressing through the rest of the day finishes it: the card says so, and the button stops
    // accepting taps rather than counting into negative numbers.
    for (let n = 1; n < COUNTED.total; n += 1) await take().click();
    await expect(card().getByText(UI.hant["dose.done"], { exact: true })).toBeVisible();
    await expect(take()).toBeDisabled();
  });

  /**
   * Brief §2, rule 7. The sheet prints 「每日兩次，隨餐」 — a frequency, not an hour — so a counter
   * that said "8am / 8pm" or 「夜晚仲有一次」 would be the app writing a prescription the page did
   * not. The whole screen is swept rather than the counter alone: a time that leaked into a card
   * heading is exactly as wrong as one inside the count.
   *
   * `nocte` on this sheet makes it a real test rather than a formality. The rules now read that as
   * one dose a day, so the card has to show a count next to the Latin for "at night" without
   * turning it into a time of day anywhere on the screen.
   */
  test("nothing on 跟進 names a clock time or a part of the day", async ({ page }) => {
    await page.goto("/track");
    await expect(doseCard(page, TARGETS[0].name)).toBeVisible();

    // Expand the warning signs too, so the sweep covers the text a tap reveals.
    await page.getByRole("button", { name: UI.hant["track.warnings"].replace("{n}", "3") }).click();
    await expect(page.getByRole("link", { name: UI.hant["track.saySigns"] })).toBeVisible();

    await expectNoClockTime(page);

    // And again after a dose is counted, which is the moment the design canvas gets wrong.
    await doseCard(page, COUNTED.name)
      .getByRole("button", { name: UI.hant["dose.take"], exact: true })
      .click();
    await expect(
      doseCard(page, COUNTED.name).getByText(
        UI.hant["dose.left"].replace("{n}", String(COUNTED.total - 1)),
        { exact: true },
      ),
    ).toBeVisible();
    await expectNoClockTime(page);
  });
});

/* -------------------------------------------------------------------------- */
/* 跟進 — a medicine the page withdrew                                         */
/* -------------------------------------------------------------------------- */

/**
 * Brief §2, rule 8 — and `tests/eval/stress.md`'s "worst single miss".
 *
 * None of the checked-in fixtures prints a withdrawn drug, so the state is constructed from a real
 * reading: a medicine the rules WOULD otherwise count is marked `stopped`, which is the dangerous
 * case rather than the easy one. It must stay on the screen — the family needs to know the page
 * names the drug — and it must have no way at all to be counted or ticked off.
 *
 * Two sheets, because both halves matter: one withdrawn medicine among current ones proves the
 * absence is about that drug's status rather than about the screen being broken, and a sheet with
 * every medicine withdrawn proves there is no counter left anywhere.
 */
test.describe("A stopped medicine is never a dose (brief §2 rule 8)", () => {
  /** The first medicine the rules can count, withdrawn. The others are untouched. */
  const ONE_WITHDRAWN = withStoppedMedicine(storedReading("hk_en"), TARGETS.indexOf(COUNTED));
  /** Every medicine on the sheet withdrawn, so nothing is countable at all. */
  const ALL_WITHDRAWN = TARGETS.reduce(
    (reading, _target, index) => withStoppedMedicine(reading, index),
    storedReading("hk_en"),
  );

  test("it is shown, marked as ended, and carries no 食咗 and no counter", async ({ page }) => {
    await seedSheet(page, activeSheet(ONE_WITHDRAWN));
    await page.goto("/track");

    const card = doseCard(page, COUNTED.name);
    // Still on the page, with the clause the sheet printed for it, verbatim.
    await expect(card).toHaveCount(1);
    await expect(
      card.getByText(UI.hant["card.printed"].replace("{text}", COUNTED.printed), { exact: true }),
    ).toBeVisible();
    // Visibly ended, in the app's own words.
    await expect(card.getByText(UI.hant["dose.stopped"], { exact: true })).toBeVisible();

    // No way to record a dose of it, and no number beside it — not even 今日食晒, which would
    // read as "you have finished today's" for a drug that has no today.
    await expect(card.getByRole("button", { name: UI.hant["dose.take"] })).toHaveCount(0);
    await expect(card.getByText(UI.hant["dose.done"], { exact: true })).toHaveCount(0);
    for (let n = 0; n <= 6; n += 1) {
      await expect(
        card.getByText(UI.hant["dose.left"].replace("{n}", String(n)), { exact: true }),
      ).toHaveCount(0);
    }

    // The rest of the sheet is untouched, which is what makes the absence above meaningful.
    await expect(page.getByRole("button", { name: UI.hant["dose.take"], exact: true })).toHaveCount(
      COUNTABLE.length - 1,
    );
  });

  test("with every medicine withdrawn there is no counter anywhere on the screen", async ({
    page,
  }) => {
    await seedSheet(page, activeSheet(ALL_WITHDRAWN));
    await page.goto("/track");

    // Every drug the page names is still listed…
    for (const target of TARGETS) {
      await expect(doseCard(page, target.name)).toHaveCount(1);
    }
    await expect(page.getByText(UI.hant["dose.stopped"], { exact: true })).toHaveCount(
      TARGETS.length,
    );

    // …and nothing on the screen counts, offers to count, or says a day has been finished.
    await expect(page.getByRole("button", { name: UI.hant["dose.take"], exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText(UI.hant["dose.done"], { exact: true })).toHaveCount(0);
    for (let n = 0; n <= 6; n += 1) {
      await expect(
        page.getByText(UI.hant["dose.left"].replace("{n}", String(n)), { exact: true }),
      ).toHaveCount(0);
    }
    await expectNoClockTime(page);
  });

  test("and 明明 never asks whether a withdrawn medicine was taken", async ({ page }) => {
    // The check-in is the one place a number about a medicine is spoken, so a withdrawn drug must
    // not be able to produce one. `CheckinNotice` refuses on the same rule the counter does: with
    // nothing countable there is no verbatim clause to quote, so the block does not render at all.
    // Seeded as `pending` deliberately — the one state the notice would otherwise appear in.
    await seedSheet(page, activeSheet(ALL_WITHDRAWN, { checkin: "pending" }));
    await page.goto("/");

    await expect(page.getByText(UI.hant["home.nowTalking"], { exact: true })).toBeVisible();
    // No question about a medicine the page has withdrawn…
    await expect(page.getByText(UI.hant["checkin.question"].split("{name}")[0])).toHaveCount(0);
    // …and no dose line, on either of the two branches it collapses into.
    for (let n = 0; n <= 6; n += 1) {
      await expect(
        page.getByText(UI.hant["home.dosesLeft"].replace("{n}", String(n))),
      ).toHaveCount(0);
    }
    await expect(page.getByText(UI.hant["home.dosesDone"], { exact: true })).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 跟進 — the appointment                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The one place in the product where a date may appear, and the one rule that governs it: a date
 * and a countdown exist **only when `plan.followUpDate` parsed**.
 *
 * `lib/rules/plan-from-reading.ts` returns null for everything hedged, everything ambiguous and
 * everything it does not recognise. Rendering "13 days" from a line the rules refused to read
 * would be this app deciding a medical date on the family's behalf.
 */
test.describe("The appointment counts down only from a date it could read (V8 scenario 3)", () => {
  const READ_SHEET = activeSheet(storedReading("hk_en"));
  /** "2026-09-16" — the read date plus the two weeks "2/52" prints. Worked out by the rules. */
  const FOLLOW_UP_DATE = READ_SHEET.plan.followUpDate;
  /** 「9月16日」 — the same date as the card renders it, through the rule the card itself uses. */
  const FOLLOW_UP_DAY = formatYmd(FOLLOW_UP_DATE, "hant");

  test("a printed form the rules read gives a date and a countdown", async ({ page }) => {
    expect(FOLLOW_UP_DATE, "the hk_en sheet prints 2/52, which the rules do read").not.toBeNull();
    if (!FOLLOW_UP_DATE) return;

    // Exactly a week out, pinned, so the number on screen is a fact rather than whatever day the
    // suite happens to run on. Noon UTC so the local calendar date is the same in every zone.
    const today = new Date(`${FOLLOW_UP_DATE}T12:00:00.000Z`);
    today.setUTCDate(today.getUTCDate() - 7);

    await seedConsent(page);
    await seedSheet(page, READ_SHEET);
    await page.clock.setFixedTime(today);
    await page.goto("/track");

    const card = page.getByRole("button").filter({ hasText: UI.hant["track.nextVisit"] });
    await expect(card).toHaveCount(1);
    // The days between here and there, as the big numeral beside the fixed words that frame it.
    await expect(card.getByText("7", { exact: true })).toBeVisible();
    await expect(card.getByText(DAYS_AFTER, { exact: true })).toBeVisible();
    // The date the rules worked out from "2/52", and the label the page printed beside it.
    await expect(card.getByText(FOLLOW_UP_DAY, { exact: true })).toBeVisible();
    await expect(card.getByText("SOPD · fasting bloods", { exact: true })).toBeVisible();

    // Every row traces to a line (constitution IV): opening it shows verbatim page text.
    await card.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("FU SOPD 2/52 with fasting bloods", { exact: false })).toBeVisible();
  });

  test("a line the rules refused to read shows the printed words and counts nothing", async ({
    page,
  }) => {
    // 「大約兩個星期後」 — 約 makes the whole line ambiguous, so `parseFollowUpDate` returns null.
    // A person reads it fine; this app is not allowed to turn it into a number.
    const hedged = withFollowUpWhen(storedReading("hk_en"), "大約兩個星期後");
    const sheet = activeSheet(hedged);
    expect(sheet.plan.followUpDate).toBeNull();

    await seedConsent(page);
    await seedSheet(page, sheet);
    await page.goto("/track");

    await expect(page.getByText(UI.hant["track.nextVisit"], { exact: true })).toBeVisible();
    // The sheet's own words, behind 「張紙寫：」, in the place the date would have been.
    await expect(
      page.getByText(UI.hant["card.printed"].replace("{text}", "大約兩個星期後"), { exact: true }),
    ).toBeVisible();
    // And no countdown: no numeral, and not the fixed words that frame one.
    await expect(page.getByText(DAYS_AFTER)).toHaveCount(0);
    await expect(page.getByText(UI.hant["plan.expired"], { exact: true })).toHaveCount(0);

    await expectNoHorizontalScroll(page);
  });

  test("a visit already past keeps its date and changes nothing on its own (FR-021)", async ({
    page,
  }) => {
    if (!FOLLOW_UP_DATE) return;
    const after = new Date(`${FOLLOW_UP_DATE}T12:00:00.000Z`);
    after.setUTCDate(after.getUTCDate() + 4);

    await seedConsent(page);
    await seedSheet(page, READ_SHEET);
    await page.clock.setFixedTime(after);
    await page.goto("/track");

    // FR-021's fixed sentence, in place of the countdown. Nothing is extended or rescheduled.
    await expect(page.getByText(UI.hant["plan.expired"], { exact: true })).toBeVisible();
    await expect(page.getByText(DAYS_AFTER)).toHaveCount(0);
    // The date itself is not withdrawn: nothing is rescheduled, extended or removed.
    await expect(page.getByText(FOLLOW_UP_DAY, { exact: true })).toBeVisible();
    // The medicines and their counters are untouched by a date going past.
    await expect(
      doseCard(page, "Metformin 500mg").getByRole("button", { name: UI.hant["dose.take"], exact: true }),
    ).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* The empty tab, and the old route                                           */
/* -------------------------------------------------------------------------- */

test.describe("跟進 with nothing to follow", () => {
  test("says so and offers the way to photograph a sheet", async ({ page }) => {
    await seedProfile(page);
    await page.goto("/track");

    await expect(page.getByText(NO_SHEET, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: UI.hant["capture.photo"] })).toBeVisible();
    // Nothing to take, and nothing pretending there is.
    await expect(page.getByRole("button", { name: UI.hant["dose.take"] })).toHaveCount(0);
    await expect(page.getByRole("listitem")).toHaveCount(0);
  });

  test("/plan redirects into 跟進", async ({ page }) => {
    await seedConsent(page);
    await seedSheet(page, activeSheet(storedReading("hk_en")));

    await page.goto("/plan");

    await expect(page).toHaveURL(/\/track$/);
    await expect(page.getByRole("heading", { name: UI.hant["track.title"], exact: true })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* V8.5 — delete everything                                                   */
/* -------------------------------------------------------------------------- */

test.describe("Delete everything (V8, Story 2 scenario 4)", () => {
  test("removes the key and puts the phone back where it started", async ({ page }) => {
    // The fullest state the phone ever holds: a profile, an active sheet with a counted dose, and
    // a read-only sheet behind it — so everything FR-017 names is there to go.
    const active = activeSheet(storedReading("hk_en"), {
      doses: { m1: { key: "m1", taken: 1, day: "2026-09-02" } },
    });
    await seedSheet(page, active, {
      profile: MOTHER,
      archive: [archivedSheet(active, "2026-09-02T10:00:00.000Z")],
    });

    await page.goto("/settings");

    const before = await stored(page);
    expect(before?.profile?.label).toBe("阿媽");
    expect(before?.sheets?.active).not.toBeNull();

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

    // FR-017: the profile, the sheet, its thread and its counters are gone because the one key is.
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), KEY))
      .toBeNull();

    // And the phone is back where it started: the notice, then 記錄 with no sheet on it.
    await expect(
      page.getByRole("dialog", { name: UI.hant["consent.title"], exact: true }),
    ).toBeVisible();
    await acceptConsent(page);
    await expectHomeScreen(page);
    await expect(page.getByText(UI.hant["home.emptyMascot"], { exact: true })).toBeVisible();
  });
});
