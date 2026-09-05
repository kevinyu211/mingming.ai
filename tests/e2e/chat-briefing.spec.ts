/**
 * `/chat` — the conversation with 明明, end to end (v2 build brief §6).
 *
 * What is worth proving in a browser rather than in a unit test is the *sequence*: that the red
 * flags are said before anything else, that the script plays itself to the end with no button to
 * press, that what the microphone hears appears in the thread before it is sent, that a refusal
 * lands in the thread instead of on another screen, and that a question never reaches the network
 * when a rule has already answered it.
 *
 * The read-failure cases at the bottom are the ones `tests/e2e/fallbacks.spec.ts` covered on the
 * v1 `/read` screen. They are re-covered here because that screen is gone: `/read` redirects, and
 * the pages the camera left behind are now read by `/chat`. The pages are seeded straight into
 * `sessionStorage` — the same key `components/Capture.tsx` writes — so these cases stand up
 * without the capture flow, which another agent is rebuilding in parallel.
 *
 * `/api/read` and `/api/ask` are mocked from the same fixtures the unit tests parse. `/api/tts`
 * is left alone: it answers 503 for real here (`TTS_PROVIDER=browser`), and with no cloud voice
 * and no device voice in headless Chrome, `speak()` returns `text-only` — which is exactly the
 * state the screen has to keep working in.
 */
import { expect, test, type Page } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import {
  expectedCards,
  expectedSource,
  mockAsk,
  mockRead,
  noSpeechInput,
  noVoiceOutput,
  seedConsent,
  BEAT,
  BRIEFING_TIMEOUT,
  answerUntil,
  helloOpens,
  sayUnderstood,
} from "./helpers";

/** `components/Capture.tsx`'s hand-off key. Not imported: that file is another agent's. */
const PENDING_IMAGES_KEY = "fitornot.pending-images";

/** Copy that lives in `components/DeclineState.tsx`, not in `lib/i18n/ui.ts`. */
const INVALID_TITLE = "讀唔到呢張紙";

/** Copy that lives in `components/chat/ChatBar.tsx`, word for word from the v1 voice bar. */
const NO_MIC = "而家聽唔到你講嘢，打字問就得。";

const cards = expectedCards("hk_en");
const warnings = cards.filter((c) => c.type === "warning");
const pieces = cards.filter((c) => c.type !== "warning" && c.type !== "noWarnings");

/** The half of the greeting after the counts: the offer of where to start. */
const OFFERS_A_CHOICE = UI.hant["brief.summary"].split("{parts}")[1];
const HELLO_OPENS = helloOpens();

/**
 * Puts one real JPEG into the hand-off slot, as if the camera had just downscaled a page.
 *
 * A real encode rather than a stub string: the 413 path re-decodes these bytes and re-encodes
 * them smaller, so a placeholder would make the retry silently not happen and the test would
 * pass for the wrong reason.
 */
async function seedPendingPage(page: Page, count = 1): Promise<void> {
  await page.goto("/settings");
  await page.evaluate(
    ({ key, n }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1200;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000000";
      ctx.font = "64px sans-serif";
      ctx.fillText("DISCHARGE SUMMARY", 60, 160);
      const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      const pages = Array.from({ length: n }, () => ({ mediaType: "image/jpeg", base64 }));
      window.sessionStorage.setItem(key, JSON.stringify(pages));
    },
    { key: PENDING_IMAGES_KEY, n: count },
  );
}

/* -------------------------------------------------------------------------- */
/* The briefing                                                               */
/* -------------------------------------------------------------------------- */

test.describe("The sheet arrives as a conversation, red flags first", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("opens with a greeting, then the red flags, then one teach-back question", async ({
    page,
  }) => {
    test.setTimeout(BRIEFING_TIMEOUT);
    await noSpeechInput(page);
    // Since f12f5f1 a line ends when its voice has finished, not when its typing has. This test
    // checks order and structure, not sound, so it runs without a voice; the device-voice path
    // is exercised by the speaker-toggle test and the gate has its own unit test.
    await noVoiceOutput(page);
    await page.goto("/chat?sample=hk_en");

    // 1. 明明 greets, says what is ON the page, and offers a choice of where to start — one
    //    bubble, all of it fixed template. Then he waits for an answer.
    const opening = page.getByText(HELLO_OPENS, { exact: false });
    await expect(opening).toBeVisible({ timeout: BEAT });
    await expect(page.getByText(OFFERS_A_CHOICE, { exact: false })).toBeVisible({ timeout: BEAT });
    // Nothing from the sheet has been said yet: the red flags wait for the reader, not a timer.
    await expect(page.getByText(warnings[0].body.yue, { exact: false })).toHaveCount(0);

    // 2. The red flags come next — before any medicine, diet or follow-up line, and never behind
    //    a tap (constitution II). One bubble: the app's own lead-in, the page's bodies, and the
    //    question, so each is matched as a part of that bubble rather than as a bubble of its own.
    await sayUnderstood(page);
    await expect(page.getByText(UI.hant["brief.warnLead"], { exact: false })).toBeVisible({
      timeout: BEAT,
    });
    for (const warning of warnings) {
      await expect(page.getByText(warning.body.yue, { exact: false })).toBeVisible({
        timeout: BEAT,
      });
    }
    // Nothing from the rest of the sheet has been said yet.
    await expect(page.getByText(pieces[0].body.yue, { exact: false })).toHaveCount(0);
    // Each red flag traces to its own printed line (constitution IV).
    await expect(
      page.getByRole("button", { name: UI.hant["card.sourceLink"] }).first(),
    ).toBeVisible();

    // 3. Teach-back is asked ONCE, in words, inside the same bubble, and there is no button to
    //    press to make it continue — the reader answers in the bar.
    await expect(page.getByText(UI.hant["ask.warn"], { exact: false })).toBeVisible({
      timeout: BEAT,
    });
    await expect(page.getByText(UI.hant["ask.warn"], { exact: false })).toHaveCount(1);
    for (const gone of ["brief.understand", "brief.repeat"] as const) {
      await expect(page.getByRole("button", { name: UI.hant[gone], exact: true })).toHaveCount(0);
    }
    // And still nothing past the red flags until that answer comes.
    await expect(page.getByText(pieces[0].body.yue, { exact: false })).toHaveCount(0);
  });

  test("nothing on the screen is a play button", async ({ page }) => {
    await page.goto("/chat?sample=hk_en");
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible();

    // The v1 controls are gone: 明明 speaks on his own and the only voice control is the toggle.
    for (const gone of ["cards.playAll", "cards.play", "cards.stop"] as const) {
      await expect(page.getByRole("button", { name: UI.hant[gone], exact: true })).toHaveCount(0);
    }
    await expect(
      page.getByRole("button", { name: UI.hant["chat.muteSpeaker"], exact: true }),
    ).toBeVisible();
  });

  test("the script reaches the end one answered section at a time, with nothing to press", async ({
    page,
  }) => {
    test.setTimeout(BRIEFING_TIMEOUT * 2);
    await noSpeechInput(page);
    await page.goto("/chat?sample=hk_en");

    // Every section arrives only after the one before it was answered, in the sheet's order.
    for (const piece of pieces) {
      await answerUntil(page, page.getByText(piece.body.yue, { exact: false }));
    }
    await answerUntil(page, page.getByText(UI.hant["brief.end"], { exact: false }));

    // Each medicine is its own turn and is numbered as such: 第1隻藥（總共3隻）, 第2隻, 第3隻 —
    // one lead per medicine, never one per run and never one that is missing.
    const medicines = pieces.filter((card) => card.type === "medicine");
    for (const [index] of medicines.entries()) {
      const lead = UI.hant["lead.medicineNth"]
        .replace("{n}", String(index + 1))
        .replace("{total}", String(medicines.length));
      await expect(page.getByText(lead, { exact: false })).toHaveCount(1);
    }
    // There is no button that continues the script; only the reader's answer does.
    for (const gone of ["brief.understand", "brief.repeat"] as const) {
      await expect(page.getByRole("button", { name: UI.hant[gone], exact: true })).toHaveCount(0);
    }

    // Every bubble that quotes printed lines still offers them (constitution IV). A bubble is a
    // section now: the red flags share one, so their three quotes sit behind one button, and
    // every piece that quotes the page has its own.
    const quotingBubbles =
      (warnings.some((card) => card.source !== null) ? 1 : 0) +
      pieces.filter((card) => card.source !== null).length;
    await expect(page.getByRole("button", { name: UI.hant["card.sourceLink"] })).toHaveCount(
      quotingBubbles,
    );

    // The 睇「跟進」 offer appears exactly once, under the last medicine.
    await expect(page.getByRole("button", { name: UI.hant["brief.trackLink"] })).toHaveCount(1);
  });

  test("a spoken fact opens the line it came from", async ({ page }) => {
    test.setTimeout(BRIEFING_TIMEOUT);
    await noSpeechInput(page);
    await page.goto("/chat?sample=hk_en");
    await answerUntil(page, page.getByText(warnings[0].body.yue, { exact: false }));

    await page.getByRole("button", { name: UI.hant["card.sourceLink"] }).first().click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: UI.hant["source.title"] })).toBeVisible();
    // Verbatim page text: never converted, never translated, never trimmed.
    await expect(sheet.getByText(expectedSource("hk_en", "warning-0").quote)).toBeVisible();
  });

  test("what has been said survives a reload, and the rest still arrives", async ({ page }) => {
    test.setTimeout(BRIEFING_TIMEOUT * 2);
    await noSpeechInput(page);
    await page.goto("/chat?sample=hk_en");
    await answerUntil(page, page.getByText(pieces[0].body.yue, { exact: false }));

    await page.reload();

    // What was already said is still in the thread, exactly once…
    await expect(page.getByText(pieces[0].body.yue, { exact: false })).toHaveCount(1, {
      timeout: BEAT,
    });
    await expect(page.getByText(warnings[0].body.yue, { exact: false })).toHaveCount(1);
    // …and the script picks itself up where it stopped — still waiting for the reader — rather
    // than starting over or giving up.
    await answerUntil(page, page.getByText(UI.hant["brief.end"], { exact: false }));
    await expect(page.getByText(pieces[0].body.yue, { exact: false })).toHaveCount(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The bar and the questions                                                  */
/* -------------------------------------------------------------------------- */

test.describe("Questions go into the same thread", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
    // Headless Chrome has no SpeechRecognition, which is the honest keyboard-only path and also
    // the one a test can drive.
    await page.addInitScript(() => {
      const globalWindow = window as unknown as Record<string, unknown>;
      delete globalWindow.SpeechRecognition;
      delete globalWindow.webkitSpeechRecognition;
      delete globalWindow.MediaRecorder;
    });
  });

  test("with no microphone the bar is a keyboard and says so", async ({ page }) => {
    await page.goto("/chat?sample=hk_en");
    // The desktop composer carries its own copy of this sentence and is in the DOM at every
    // width behind `lg:block`. The claim is about what a reader on a phone SEES.
    await expect(page.getByText(NO_MIC, { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: UI.hant["bar.hold"] }),
    ).toHaveCount(0);
  });

  test("an answer arrives as a message, with the line it came from", async ({ page }) => {
    const log = await mockAsk(page, "answered");
    await page.goto("/chat?sample=hk_en");
    // Wait for 明明 to finish his opening line, so the thread order is the one a reader sees.
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible();

    const field = page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true });
    await field.fill("白色嗰粒係朝早定夜晚食？");
    await page.getByRole("button", { name: UI.hant["bar.send"], exact: true }).click();

    // The question is in the thread as the reader's own bubble…
    await expect(page.getByText("白色嗰粒係朝早定夜晚食？", { exact: true })).toBeVisible();
    // …and the answer follows it, typed out, with the AI label a model-written line must carry.
    await expect(
      page.getByText("張紙寫住 Amlodipine 5mg 每日一次，冇分朝早定夜晚。", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(UI.hant["aiChip"]).first()).toBeVisible();
    expect(log.count).toBe(1);
  });

  test("a question about changing a medicine is refused in the thread, with no model call", async ({
    page,
  }) => {
    const log = await mockAsk(page, "answered");
    await page.goto("/chat?sample=hk_en");
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible();

    const field = page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true });
    await field.fill("可唔可以食多啲？");
    await page.getByRole("button", { name: UI.hant["bar.send"], exact: true }).click();

    // Styled by outcome, in the thread — not a separate screen (brief §6).
    await expect(page.getByRole("heading", { name: UI.hant["ask.refused"] })).toBeVisible();
    // The gate runs before any network call, so nothing was sent (constitution III, FR-011).
    expect(log.count).toBe(0);
  });

  test("a crisis question answers from the fixed list and sends nothing", async ({ page }) => {
    const log = await mockAsk(page, "answered");
    await page.goto("/chat?sample=hk_en");
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible();

    const field = page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true });
    await field.fill("我想死");
    await page.getByRole("button", { name: UI.hant["bar.send"], exact: true }).click();

    await expect(page.getByRole("heading", { name: UI.hant["ask.referral"] })).toBeVisible();
    // The referral keeps its resource list.
    await expect(page.getByRole("link", { name: UI.hant["ask.referralCall"] }).first()).toBeVisible();
    expect(log.count).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Redirects and the read failure paths                                       */
/* -------------------------------------------------------------------------- */

test.describe("The old routes still land somewhere sensible", () => {
  test("/read and /ask redirect into the conversation", async ({ page }) => {
    await seedConsent(page);

    await page.goto("/read?sample=hk_en");
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible();

    await page.goto("/ask");
    // No sheet parameter this time, but one is already active, so the conversation is still here.
    await expect(page).toHaveURL(/\/chat$/);
  });
});

test.describe("The reading service is down or refuses, on /chat", () => {
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("502 offers the bundled sample sheet, and the sample reads", async ({ page }) => {
    await mockRead(page, { status: 502 });
    await seedPendingPage(page);
    await page.goto("/chat");

    await expect(
      page.getByRole("heading", { name: UI.hant["fallback.modelUnavailable"], exact: true }),
    ).toBeVisible();

    // One tap out (SC-007): the sample is bundled, so it works with the route still failing.
    await page.getByRole("button", { name: UI.hant["capture.sample"], exact: true }).click();
    await expect(page.getByText(UI.hant["cards.sampleBanner"], { exact: true })).toBeVisible();
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("422 shows the couldn't-read state", async ({ page }) => {
    await mockRead(page, { status: 422 });
    await seedPendingPage(page);
    await page.goto("/chat");

    await expect(page.getByRole("heading", { name: INVALID_TITLE, exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: UI.hant["capture.sample"], exact: true }),
    ).toBeVisible();
  });

  test("413 re-downscales and retries exactly once", async ({ page }) => {
    const log = await mockRead(page, { status: 413 });
    await seedPendingPage(page);
    await page.goto("/chat");

    await expect(page.getByRole("heading", { name: INVALID_TITLE, exact: true })).toBeVisible();
    // contracts/api-read.md: the original pages, then the smaller re-encode. Never a third.
    expect(log.count).toBe(2);
  });

  test("a photo that is not a discharge sheet is declined, not summarised", async ({ page }) => {
    await mockRead(page, "unknown");
    await seedPendingPage(page);
    await page.goto("/chat");

    await expect(
      page.getByRole("heading", { name: UI.hant["notASheet.title"], exact: true }),
    ).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* The daily check-in                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The one place a number about a medicine reaches the screen, and therefore the one place this
 * product can do real harm. Three things are asserted that the design canvas gets wrong:
 *
 *   · the question quotes the printed frequency VERBATIM and names no time of day;
 *   · 食咗 counts *times left today*, never 「夜晚仲有一次」;
 *   · 未食 quotes the page back and stops — no instruction, and no promise of a second ask,
 *     because there are no notifications in this product.
 *
 * All three medicines on the Hong Kong sheet are countable — "daily", "BD with meals" and
 * "nocte" each state a number of doses a day, so each gets a counter. What none of them may ever
 * produce is a time: `remaining()` returns an integer, and the card prints the clause verbatim
 * beside it. A clause that states an interval rather than a count (「每四小時一次」) or a ceiling
 * ("up to 4 times a day") still gets no counter at all.
 *
 * The check-in asks about the FIRST countable medicine in the order the page lists them, which is
 * why the name and clause below are the first row of the medicines table rather than a chosen one.
 */
test.describe("The check-in counts times, never clock times", () => {
  const NAME = "Amlodipine 5mg";
  const PRINTED = "daily";
  const QUESTION = UI.hant["checkin.question"]
    .replace("{name}", NAME)
    .replace("{printed}", PRINTED);

  test("asks after the briefing, quotes the page, and counts down", async ({ page }) => {
    test.setTimeout(BRIEFING_TIMEOUT * 2);
    await seedConsent(page);
    await noSpeechInput(page);
    await page.goto("/chat?sample=hk_en");

    // The script is answered through to the end; the check-in becomes available only once it
    // is over.
    await answerUntil(page, page.getByText(UI.hant["brief.end"], { exact: false }));

    // Only now does the in-app check-in become available (brief §6).
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (JSON.parse(window.localStorage.getItem("fitornot.v1") ?? "{}") as {
              sheets?: { active?: { checkin?: string } };
            }).sheets?.active?.checkin ?? null,
        ),
      )
      .toBe("pending");
    // (poll: the phase change and the check-in flag land in the same write.)

    // 未食 first: it must quote the page and say nothing else.
    await page.goto("/chat?checkin=1");
    await expect(page.getByText(QUESTION, { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: UI.hant["checkin.notYet"], exact: true }).click();
    await expect(
      page.getByText(UI.hant["checkin.notYetReply"].replace("{printed}", PRINTED), { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    // The canvas's 「記得飯後食一粒。我陣間再問你。」 is an instruction and a promise of a
    // notification that cannot exist. Neither may appear.
    await expect(page.getByText("我陣間再問你")).toHaveCount(0);
    await expect(page.getByText("記得飯後食一粒")).toHaveCount(0);

    // 食咗 on the other branch: one dose down, counted in times, never in hours.
    await page.evaluate(() => {
      const raw = JSON.parse(window.localStorage.getItem("fitornot.v1") ?? "{}") as {
        sheets?: { active?: { checkin?: string } };
      };
      if (raw.sheets?.active) raw.sheets.active.checkin = "open";
      window.localStorage.setItem("fitornot.v1", JSON.stringify(raw));
    });
    await page.goto("/chat");
    await expect(page.getByText(QUESTION, { exact: true }).last()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: UI.hant["checkin.took"], exact: true }).click();
    // Amlodipine prints "daily" — one dose a day — so the single 食咗 finishes it and the reply is
    // the all-done one. Both branches still count in TIMES: `checkin.tookReply` says 「今日仲有 N
    // 次」 and never an hour, and neither string may name a part of the day.
    await expect(
      page.getByText(UI.hant["checkin.tookReplyAll"], { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    for (const clock of ["夜晚仲有", "夜晚", "朝早", "晚上", "上午", "下午"]) {
      await expect(page.getByText(clock)).toHaveCount(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The bar as a gesture, and the one voice control                            */
/* -------------------------------------------------------------------------- */

/**
 * A stand-in for `SpeechRecognition`, so the hold gesture can be driven end to end. Headless
 * Chrome ships none, which is a real state the bar handles (the keyboard-only tests above) but
 * makes the gesture itself untestable — and the gesture is the whole bottom of the screen.
 */
async function stubRecognition(page: Page, transcript: string): Promise<void> {
  await page.addInitScript((said: string) => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      private heard = false;

      start(): void {
        // A partial first, then the whole thing — the shape a real recogniser reports in, and the
        // only way to prove the transcript reaches the thread BEFORE anything is sent.
        window.setTimeout(() => {
          const half = said.slice(0, Math.max(1, Math.ceil(said.length / 2)));
          const partial = Object.assign([{ transcript: half }], { isFinal: false });
          this.onresult?.({ resultIndex: 0, results: [partial] });
        }, 40);
        window.setTimeout(() => {
          const result = Object.assign([{ transcript: said }], { isFinal: true });
          this.heard = true;
          this.onresult?.({ resultIndex: 0, results: [result] });
        }, 140);
      }
      stop(): void {
        // A real recogniser delivers whatever it has settled on BEFORE it ends. Without this the
        // stub loses the transcript on any release that beats its own final-result timer — which
        // is every release a person would actually make.
        window.setTimeout(() => {
          if (!this.heard) {
            this.heard = true;
            const result = Object.assign([{ transcript: said }], { isFinal: true });
            this.onresult?.({ resultIndex: 0, results: [result] });
          }
          this.onend?.();
        }, 10);
      }
      abort(): void {
        this.heard = false;
        window.setTimeout(() => this.onend?.(), 10);
      }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    delete (window as unknown as Record<string, unknown>).MediaRecorder;
  }, transcript);
}

test.describe("The bar is one control: hold to talk, tap to type", () => {
  test("what the microphone hears appears in the thread before anything is sent", async ({
    page,
  }) => {
    const log = await mockAsk(page, "answered");
    await seedConsent(page);
    await stubRecognition(page, "覆診要帶咩？");
    await page.goto("/chat?sample=hk_en");
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible({
      timeout: BEAT,
    });

    const bar = page.getByRole("button", { name: UI.hant["bar.hold"] });
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Past 220 ms the microphone opens and the bar says what it is doing.
    await expect(page.getByText(UI.hant["bar.listeningSub"], { exact: true })).toBeVisible();
    // …and the words land on the reader's own side of the thread as they are heard. This is the
    // bug the first build had: the transcript was drawn inside the button, in a clipped 72 px box,
    // where nobody was looking and half of it did not fit.
    await expect(page.getByText(UI.hant["chat.listening"], { exact: true })).toBeVisible();
    await expect(page.getByText("覆診要", { exact: true })).toBeVisible();
    // Nothing has been sent yet: the reader sees what was heard before it goes anywhere (R6).
    expect(log.count).toBe(0);

    await page.mouse.up();
    await expect(page.getByText("覆診要帶咩？", { exact: true })).toBeVisible();
    expect(log.count).toBe(1);
  });

  test("a thumb that drifts off the bar keeps recording", async ({ page }) => {
    const log = await mockAsk(page, "answered");
    await seedConsent(page);
    await stubRecognition(page, "覆診要帶咩？");
    await page.goto("/chat?sample=hk_en");
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible({
      timeout: BEAT,
    });

    const bar = page.getByRole("button", { name: UI.hant["bar.hold"] });
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByText(UI.hant["bar.listeningSub"], { exact: true })).toBeVisible();

    // Off the bar entirely. The old build bound `onPointerLeave` to the release handler, and the
    // bar reflows the moment a hold starts — so a press routinely ended itself a frame later and
    // the question was lost with no error anywhere. Pointer capture is what fixed it.
    await page.mouse.move(box.x + box.width / 2, box.y - 220);
    await expect(page.getByText(UI.hant["bar.listeningSub"], { exact: true })).toBeVisible();

    await page.mouse.up();
    await expect(page.getByText("覆診要帶咩？", { exact: true })).toBeVisible();
    expect(log.count).toBe(1);
  });

  test("a tap under the threshold opens the keyboard instead", async ({ page }) => {
    await seedConsent(page);
    await stubRecognition(page, "覆診要帶咩？");
    await page.goto("/chat?sample=hk_en");

    const bar = page.getByRole("button", { name: UI.hant["bar.hold"] });
    await bar.click();
    await expect(
      page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true }),
    ).toBeFocused();
    // Nothing was heard and nothing was sent.
    await expect(page.getByText(UI.hant["bar.listeningSub"], { exact: true })).toHaveCount(0);
  });
});

test.describe("The speaker toggle is the only voice control", () => {
  test("silencing stops the sound and the text keeps typing", async ({ page }) => {
    test.setTimeout(BRIEFING_TIMEOUT);
    await seedConsent(page);
    await noSpeechInput(page);
    await page.goto("/chat?sample=hk_en");

    // The 讀住 indicator is status: it is there while there is sound, and it is not a button.
    const reading = page.getByText(UI.hant["chat.reading"], { exact: true });
    await expect(reading.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: UI.hant["chat.reading"] })).toHaveCount(0);

    await page.getByRole("button", { name: UI.hant["chat.muteSpeaker"], exact: true }).click();
    await expect(reading).toHaveCount(0);
    // The label flips to the way back, and the words carry on arriving.
    await expect(
      page.getByRole("button", { name: UI.hant["chat.unmuteSpeaker"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(HELLO_OPENS, { exact: false })).toBeVisible({
      timeout: BEAT,
    });
    // With the sound off the conversation carries on: answer the opening and the red flags still
    // reach the thread, typed out, sound or no sound.
    await answerUntil(page, page.getByText(warnings[0].body.yue, { exact: false }));
  });
});
