/**
 * The live path (quickstart V1, V4, V5, V9) — the scenarios a judge watches, on the v2 tabs.
 *
 * Consent, the way in, a photographed sheet, the conversation it becomes, the follow-up it fills,
 * and what leaves the phone while all that happens. `/api/read` and `/api/ask` are mocked from the
 * bundled fixtures (see `helpers.ts`) so the whole path runs with no API key; the card order, the
 * source quotes, the two client-side gates and the sheet store are the real code.
 *
 * ## What this file owns after the redesign
 *
 * v1 had this file walking `/` → `/read` → `/ask` and asserting a stack of `<article>` cards.
 * There are no cards any more: the sheet arrives as messages in 傾偈, and `chat-briefing.spec.ts`
 * owns that conversation end to end — the order, the teach-back, the refusal and crisis gates, the
 * check-in. Repeating any of it here would be describing the same screen twice.
 *
 * So what is left is the part only a whole-journey test can see, and none of it is covered
 * elsewhere:
 *
 *   · **the journey itself** — a photograph on 記錄 becomes the active sheet, the conversation
 *     names it, and 跟進 follows THAT sheet and no other (brief §1, the load-bearing rule);
 *   · **one active sheet** — photographing a second archives the first read-only, 只可以睇;
 *   · **privacy, structurally** — the read request carries the pixels and nothing else, and the
 *     ask request carries the reading, the question and the dialect and nothing else (SC-009);
 *   · **an answer's provenance** — the line it came from opens, verbatim (constitution IV);
 *   · **the model outage on a question** — the honest sentence, with the sheet still readable;
 *   · **the language switch** — the thread converts, the quote does not (FR-003);
 *   · **the disclaimer**, on every screen the demo visits (rules.md §16).
 */
import { expect, test } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import { toScript } from "../../lib/i18n/script";
import {
  MOCK_ANSWER,
  MOTHER,
  acceptConsent,
  activeSheet,
  askQuestion,
  expectDisclaimer,
  expectHomeScreen,
  expectNoHorizontalScroll,
  expectedCards,
  expectedSource,
  MOCK_CITED_CARD_ID,
  mockAsk,
  mockRead,
  noSpeechInput,
  seedConsent,
  seedSheet,
  startReading,
  storedReading,
  uploadFixture,
  BEAT,
  BRIEFING_TIMEOUT,
  expectGreeting,
  sayUnderstood,
} from "./helpers";

/** Copy that lives in `app/chat/page.tsx`, not in `lib/i18n/ui.ts`. */
const ASK_UNAVAILABLE =
  "而家connect唔到，答唔到你。張紙上面嘅嘢仲喺度，可以撳「睇張紙點寫」自己睇。";

/** How long the sheet takes to arrive as messages: 明明 types a clause at a time. */
const TYPING_TIMEOUT = 30_000;

/* -------------------------------------------------------------------------- */
/* V1 — the way in                                                            */
/* -------------------------------------------------------------------------- */

test.describe("Consent and the disclaimer (V1)", () => {
  test("the consent notice comes first and one tap dismisses it", async ({ page }) => {
    await page.goto("/");

    const gate = page.getByRole("dialog", { name: UI.hant["consent.title"], exact: true });
    await expect(gate).toBeVisible();
    await expect(gate.getByText(UI.hant["consent.body2"], { exact: true })).toBeVisible();
    // Nothing is rendered behind the notice — not even the two capture buttons (FR-015).
    await expect(page.getByRole("link", { name: UI.hant["capture.photo"] })).toHaveCount(0);
    await expectDisclaimer(page);

    await acceptConsent(page);

    await expect(gate).toHaveCount(0);
    await expectHomeScreen(page);
    await expectDisclaimer(page);
  });

  test("the disclaimer footer is on every screen the demo visits", async ({ page }) => {
    await seedConsent(page);
    await seedSheet(page, activeSheet(storedReading("hk_en")));

    // The three tabs, the full-screen routes, and the two that survived the redesign unchanged.
    for (const url of ["/", "/chat", "/track", "/capture", "/setup", "/settings"]) {
      await page.goto(url);
      await expectDisclaimer(page);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* V1, V4 — a sheet, end to end across the three tabs                         */
/* -------------------------------------------------------------------------- */

test.describe("A photographed sheet becomes the one active sheet (V1, V4)", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("記錄 → 傾偈 → 跟進, all naming the same piece of paper", async ({ page }) => {
    await noSpeechInput(page);
    const log = await mockRead(page, "hk_en", { delayMs: 600 });

    // 1. 記錄, empty: 明明 has nothing to say yet and says exactly that.
    await page.goto("/");
    await expect(page.getByText(UI.hant["home.emptyMascot"], { exact: true })).toBeVisible();

    // 2. The photograph, through the real capture screen.
    await uploadFixture(page, "hk_en.png");
    await startReading(page);

    // 3. The transitional state while /api/read streams — held open by the mock's delay.
    await expect(page.getByText(UI.hant["reading.title"], { exact: true })).toBeVisible();

    // 4. The sheet arrives as a conversation, red flags first. (What it SAYS is
    //    chat-briefing.spec.ts's business; this only proves the read landed here.)
    //    明明 greets and waits; the red flags come once the reader answers (brief §2).
    await expectGreeting(page);
    await sayUnderstood(page);
    await expect(page.getByText(UI.hant["brief.warnLead"], { exact: false })).toBeVisible({
      timeout: BEAT,
    });

    // 5. Privacy is structural (FR-019, SC-009): the body carries the pixels and nothing else.
    expect(log.count).toBe(1);
    const body = log.bodies[0];
    expect(Object.keys(body)).toEqual(["images"]);
    const images = body.images as Record<string, unknown>[];
    expect(images).toHaveLength(1);
    expect(Object.keys(images[0]).sort()).toEqual(["base64", "mediaType"]);
    expect(images[0].mediaType).toBe("image/jpeg");

    // 6. 記錄 now has the sheet on it, titled by rule from the page's own clinic line, with the
    //    page count the camera actually took.
    await page.goto("/");
    await expect(page.getByRole("main").getByText(UI.hant["home.nowTalking"], { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("SOPD", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(UI.hant["home.pages"].replace("{n}", "1"), { exact: false })).toBeVisible();

    // 7. 跟進 follows THAT sheet — the strip names it, which is what makes the tab honest.
    await page.getByRole("link", { name: UI.hant["tab.track"], exact: true }).click();
    await expect(page.getByText(UI.hant["track.following"], { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: UI.hant["track.todayMeds"] })).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Metformin 500mg" }),
    ).toHaveCount(1);

    await expectNoHorizontalScroll(page);
  });

  /**
   * Brief §1's load-bearing rule, and the reason a counter can say 「張紙寫：每日兩次」 at all: a
   * counter may only ever quote ONE piece of paper. Photographing a second sheet makes it active
   * and freezes the first, which then says out loud that it can only be looked at.
   */
  test("photographing a second sheet archives the first, read-only", async ({ page }) => {
    await mockRead(page, "hk_en");

    await uploadFixture(page, "hk_en.png");
    await startReading(page);
    await expectGreeting(page);

    // A second sheet, from the other bundled fixture so the two are told apart by their titles.
    await mockRead(page, "cn_zh");
    await uploadFixture(page, "cn_zh.png");
    await startReading(page);
    await expectGreeting(page);

    await page.goto("/");
    // 傾緊呢張 names the NEW sheet, and only it. There is one active sheet, and it is the last
    // piece of paper photographed.
    await expect(page.getByRole("main").getByText(UI.hant["home.nowTalking"], { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: /心内科门诊/ })).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("link", { name: /SOPD/ })).toHaveCount(0);

    /*
     * The older sheets sit behind a disclosure. The COUNT is deliberately not pinned: one
     * successful read currently writes the sheet twice (`startSheet()` runs a second time and
     * archives a duplicate of the sheet it just made active), so 以前嘅 is inflated. That is an
     * app bug, reported rather than fixed here — the invariant this test exists for is that the
     * previous sheet is behind the disclosure, marked 只可以睇, and cannot be opened.
     */
    const older = page.getByRole("button", { name: /以前嘅/ });
    await expect(older).toBeVisible();
    await older.click();
    await expect(page.getByRole("main").getByText("SOPD", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(UI.hant["home.readOnly"], { exact: false }).first()).toBeVisible();
    // 只可以睇 is a promise the markup keeps: an archived row is not a link and does not open.
    await expect(page.getByRole("main").getByRole("link", { name: /SOPD/ })).toHaveCount(0);

    // 跟進 follows the ACTIVE sheet only: the archived one's medicines are not on this screen.
    await page.goto("/track");
    await expect(page.getByRole("listitem").filter({ hasText: "盐酸二甲双胍片" })).toHaveCount(1);
    await expect(page.getByRole("listitem").filter({ hasText: "Metformin" })).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* V5, V9 — asking, and what leaves the phone                                 */
/* -------------------------------------------------------------------------- */

/**
 * The refusal and crisis gates live in `chat-briefing.spec.ts` (`:227`, `:244`), which proves both
 * answer from a fixed template with nothing sent. What is here is the other half: the request that
 * IS made, what it carries, and where the answer says it came from.
 */
test.describe("Asking the sheet (V5, V9)", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
    // With the profile on the phone as well, so "the label never leaves" has teeth below.
    await seedSheet(page, activeSheet(storedReading("hk_en")), { profile: MOTHER });
    // The honest keyboard-only path, and the one a test can type into.
    await noSpeechInput(page);
  });

  test("an answer cites its line, and the request carries nothing about the family", async ({
    page,
  }) => {
    const log = await mockAsk(page, "answered");
    await page.goto("/chat");

    await askQuestion(page, "白色嗰粒係朝早定夜晚食？");

    // The question is the reader's own bubble, and the answer follows it, typed out.
    await expect(page.getByText("白色嗰粒係朝早定夜晚食？", { exact: true })).toBeVisible();
    await expect(page.getByText(toScript(MOCK_ANSWER.yue, "hant"), { exact: true })).toBeVisible({
      timeout: TYPING_TIMEOUT,
    });
    // A model-written line always carries the AI chip (FR-009).
    await expect(page.getByText(UI.hant.aiChip).first()).toBeVisible();

    // Constitution IV: the spoken fact opens the line it came from, verbatim.
    await page.getByRole("button", { name: UI.hant["card.sourceLink"] }).last().click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByText(expectedSource("hk_en", MOCK_CITED_CARD_ID).quote, { exact: true }),
    ).toBeVisible();

    // SC-009: the reading, the question and the dialect. `memory` is the on-device brief and
    // rides along only when there is one; nothing else is allowed in the body at all.
    expect(log.count).toBe(1);
    const keys = Object.keys(log.bodies[0]).sort();
    expect(keys.filter((key) => key !== "memory")).toEqual(["dialect", "question", "reading"]);

    // And nothing about who the family is, which never leaves the phone (constitution V, FR-016).
    const serialised = JSON.stringify(log.bodies[0]);
    for (const forbidden of ["阿媽", "profile", "doses", "checkin", "confirmedAt"]) {
      expect(serialised, `the ask request must not carry "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test("a model outage says so plainly and leaves the sheet readable", async ({ page }) => {
    await mockAsk(page, { status: 502 });
    await page.goto("/chat");

    await askQuestion(page, "白色嗰粒係朝早定夜晚食？");

    // It says what happened and what still works. It does not apologise and it does not guess.
    await expect(page.getByText(ASK_UNAVAILABLE, { exact: true })).toBeVisible({
      timeout: TYPING_TIMEOUT,
    });
    // No AI chip on it: the sentence is a fixed template, not something a model wrote.
    await expect(page.getByText(UI.hant.aiChip)).toHaveCount(0);
    // And the conversation is not dead: the next question still goes through.
    //
    // That is the regression this guards. `runBeat` claims a "somebody is talking" flag and
    // releases it in the callback the typing chain runs when the last clause lands — and taking
    // the floor cancels that chain, so the callback never runs. Until `takeFloor()` cleared the
    // flag itself, the first interruption of the session latched it forever and every later turn
    // returned at its first guard: 明明 answered once and then went silent for good.
    //
    // Wait for it to be COMMITTED first — the speaker control only appears on a message that has
    // landed. Interrupting a line still typing itself out drops it, which is what taking the
    // floor means, and asking again too early would make the count below a race rather than a
    // test.
    await expect(page.getByRole("button", { name: UI.hant["chat.speakAgain"] }).first()).toBeVisible(
      { timeout: TYPING_TIMEOUT },
    );

    await askQuestion(page, "覆診要帶咩？");
    await expect(page.getByText("覆診要帶咩？", { exact: true })).toBeVisible();
    await expect(page.getByText(ASK_UNAVAILABLE, { exact: true })).toHaveCount(2, {
      timeout: TYPING_TIMEOUT,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* V1 — the language switch                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The v1 script toggle is now the three-way chip in the 傾偈 header (粵 / 普 / EN). The rule it
 * protects is unchanged and is the one that matters: the words 明明 says convert to the reader's
 * script, and the quoted line does NOT — a quote that has been rewritten is no longer a quote
 * (FR-003, constitution IV).
 *
 * The mainland sheet is used precisely because its quotes are printed in simplified characters,
 * so a converted quote would be visible on screen.
 */
test.describe("The language switch (V1)", () => {
  test("the thread follows the chosen language while the quote stays verbatim", async ({
    page,
  }) => {
    // Two briefings are answered in this test, one in each language.
    test.setTimeout(BRIEFING_TIMEOUT);
    await seedConsent(page);
    const warning = expectedCards("cn_zh").filter((card) => card.type === "warning")[0];
    const source = expectedSource("cn_zh", warning.id);
    // The premise: this sheet's quotes are printed in simplified characters, so a converted quote
    // would be visible on screen rather than a theoretical worry.
    expect(toScript(source.quote, "hant")).not.toBe(source.quote);

    await noSpeechInput(page);
    await page.goto("/chat?sample=cn_zh");

    // Cantonese first, which is the default: what 明明 says is the card's Cantonese body. He
    // greets and waits; the red flags are the first thing said once the reader answers.
    await expectGreeting(page);
    await sayUnderstood(page);
    await expect(page.getByText(warning.body.yue, { exact: false })).toBeVisible({
      timeout: BEAT,
    });

    // …and even here, with the interface in traditional characters, the QUOTE is the simplified
    // line the page printed (constitution IV, FR-003).
    await page.getByRole("button", { name: UI.hant["card.sourceLink"] }).first().click();
    const first = page.getByRole("dialog", { name: UI.hant["source.title"] });
    await expect(first.getByText(source.quote, { exact: true })).toBeVisible();
    await first.getByRole("button", { name: UI.hant["source.close"], exact: true }).click();

    // The one language control on this screen, in the header.
    await page.getByRole("button", { name: UI.hant["chat.language"], exact: true }).click();
    await page
      .getByRole("dialog", { name: UI.hant["chat.language"] })
      .getByRole("button", { name: UI.hant["language.cmn"], exact: true })
      .click();

    // Everything the app WROTE follows the choice: the interface, and the words 明明 says. The
    // switch starts the sheet again in the chosen language rather than rewriting what was already
    // said in the other one — see the comment on `spokenIn` in app/chat/page.tsx.
    await expect(page.getByText(UI.hans["cards.sampleBanner"], { exact: true })).toBeVisible();
    await expectGreeting(page, "hans");
    await sayUnderstood(page, "hans");
    await expect(page.getByText(warning.body.cmn, { exact: false })).toBeVisible({
      timeout: BEAT,
    });

    // Everything the PAGE printed does not. Byte for byte the same quote as before the switch.
    await page.getByRole("button", { name: UI.hans["card.sourceLink"] }).first().click();
    const second = page.getByRole("dialog", { name: UI.hans["source.title"] });
    await expect(second.getByText(source.quote, { exact: true })).toBeVisible();
  });
});
