/**
 * The bottom of the chat screen: how much of the phone it takes, and how it behaves under a thumb.
 *
 * Kevin used this on his own iPhone and said the bar plus the disclaimer took a quarter of the
 * screen, and that he had to aim at a small microphone to get back to talking. Both of those are
 * measurable in a browser, so both are measured here rather than argued about.
 *
 *   · **Size.** At 375×812 — the smallest phone this demo has to work on — the bar and the footer
 *     together must come to well under a quarter of the screen, and the press target inside the
 *     bar must still clear the 48 px floor `app/globals.css` sets for every tap target.
 *
 *   · **One control.** Voice mode has exactly one thing to press and it is the whole width of the
 *     phone. Hold it and the microphone opens; slide the thumb clean off it and the microphone
 *     STAYS open — that is the pointer-capture fix in `components/chat/ChatBar.tsx`, and it fixed
 *     a real bug where the bar's own reflow killed the gesture a frame after the press. Let go and
 *     what was heard goes into the thread. Tap it instead and the keyboard comes up.
 *
 * Headless Chrome has no `SpeechRecognition`, which is the honest keyboard-only path `chat-briefing`
 * covers. To drive the hold gesture at all this file installs a fake one — the smallest object
 * `lib/speech/stt.ts` will talk to — so the thing under test is the bar, not the engine.
 */
import { expect, test, type Page } from "@playwright/test";
import { UI } from "../../lib/i18n/ui";
import { mockAsk, seedConsent } from "./helpers";

/** The phone Kevin complained about: the shortest screen the demo has to survive. */
const PHONE = { width: 375, height: 812 };

/** Copy that lives in `components/chat/ChatBar.tsx`, word for word from the v1 voice bar. */
const NO_MIC = "而家聽唔到你講嘢，打字問就得。";

/** Comfortably past ChatBar's 220 ms hold threshold, and short enough that a test is not a wait. */
const PAST_THRESHOLD = 600;

/** What the fake microphone hears. Short, on-sheet, and nothing a rule gate would intercept. */
const SPOKEN = "白色嗰粒係做咩用？";

/**
 * Installs a `SpeechRecognition` that hears one fixed sentence.
 *
 * It implements only what `listenWithBrowser` in `lib/speech/stt.ts` actually touches: a partial
 * result a moment after `start()`, a final result on `stop()`, and `onend` after it. `abort()`
 * ends with nothing, which is the hard-cancel path.
 */
async function fakeMicrophone(page: Page, said: string): Promise<void> {
  await page.addInitScript((heard: string) => {
    const result = (text: string, isFinal: boolean) => ({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal, 0: { transcript: text } } },
    });

    class FakeRecognition extends EventTarget {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: ReturnType<typeof result>) => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
      onend: (() => void) | null = null;
      private timer: ReturnType<typeof setTimeout> | null = null;

      start(): void {
        // A partial after a beat, the way a real engine dribbles words out — which is what the
        // page draws in the reader's own bubble while they are still speaking.
        this.timer = setTimeout(() => this.onresult?.(result(heard.slice(0, 3), false)), 100);
      }

      stop(): void {
        if (this.timer) clearTimeout(this.timer);
        this.onresult?.(result(heard, true));
        this.onend?.();
      }

      abort(): void {
        if (this.timer) clearTimeout(this.timer);
        this.onend?.();
      }
    }

    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    delete (window as unknown as Record<string, unknown>).MediaRecorder;
  }, said);
}

/** The bar's own box, and the footer's, as the browser lays them out. */
async function bottomSize(page: Page): Promise<{
  bar: number;
  footer: number;
  total: number;
  share: number;
  barPaddingBottom: string;
}> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const kids = main ? Array.from(main.children) : [];
    const bar = kids[kids.length - 1] as HTMLElement | undefined;
    const footer = document.querySelector("footer[role='note']");
    const height = (el: Element | null | undefined) =>
      el ? el.getBoundingClientRect().height : 0;
    const barHeight = height(bar);
    const footerHeight = height(footer);
    return {
      bar: barHeight,
      footer: footerHeight,
      total: barHeight + footerHeight,
      share: (barHeight + footerHeight) / window.innerHeight,
      barPaddingBottom: bar ? getComputedStyle(bar).paddingBottom : "",
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Size                                                                       */
/* -------------------------------------------------------------------------- */

test.describe("the bottom of the screen is furniture, not the product", () => {
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("the bar and the disclaimer together stay well under a quarter of a 375×812 phone", async ({
    page,
  }) => {
    await page.goto("/chat?sample=hk_en");
    await expect(page.getByRole("button", { name: UI.hant["bar.hold"] })).toBeVisible();

    const size = await bottomSize(page);
    // A quarter of 812 is 203 px. Before this was rebuilt it measured 158.5 px here and 206.5 px
    // on a notched iPhone, where the safe-area inset landed on both boxes. The ceiling is set at a
    // fifth so there is real headroom left for that inset rather than a number that only passes
    // on a desktop browser.
    expect(
      size.total,
      `bar ${size.bar.toFixed(1)}px + disclaimer ${size.footer.toFixed(1)}px = ${size.total.toFixed(1)}px, ${(size.share * 100).toFixed(1)}% of the screen`,
    ).toBeLessThan(PHONE.height * 0.2);
  });

  test("the bar does not reserve the home indicator a second time", async ({ page }) => {
    await page.goto("/chat?sample=hk_en");
    await expect(page.getByRole("button", { name: UI.hant["bar.hold"] })).toBeVisible();

    // The fixed disclaimer footer is what sits on the home indicator, and `<main>` is sized
    // `100dvh` minus its measured height — so the bar's own bottom padding is a flat, small
    // number on every phone. A padding that grows with the inset means the double-count is back.
    const { barPaddingBottom } = await bottomSize(page);
    expect(Number.parseFloat(barPaddingBottom)).toBeLessThanOrEqual(12);
  });

  test("the press target is the whole width of the phone and clears 48 px", async ({ page }) => {
    await page.goto("/chat?sample=hk_en");
    const control = page.getByRole("button", { name: UI.hant["bar.hold"] });
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    expect(box.height, "the hold target must clear the 48 px floor").toBeGreaterThanOrEqual(48);
    // Not "a big button somewhere on the bar": the bar IS the button, edge to edge bar its gutters.
    expect(box.width).toBeGreaterThan(PHONE.width * 0.9);
  });

  test("the whole mandated disclaimer is on the screen, not clipped by the smaller type", async ({
    page,
  }) => {
    await page.goto("/chat?sample=hk_en");
    const footer = page.locator("footer[role='note']");
    await expect(footer.getByText(UI.hant.disclaimer, { exact: true })).toBeVisible();

    // Visible is not enough on its own — a paragraph can be visible and still have its last line
    // cut off by a box that is shorter than its own text. Nothing may overflow.
    const overflow = await footer.evaluate((node) => {
      const paragraph = node.querySelector("p");
      if (!paragraph) return null;
      return {
        scrollHeight: paragraph.scrollHeight,
        clientHeight: paragraph.clientHeight,
        footerScroll: node.scrollHeight,
        footerClient: node.clientHeight,
      };
    });
    expect(overflow).not.toBeNull();
    if (!overflow) return;
    expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight + 1);
    expect(overflow.footerScroll).toBeLessThanOrEqual(overflow.footerClient + 1);
  });
});

/* -------------------------------------------------------------------------- */
/* The gesture                                                                */
/* -------------------------------------------------------------------------- */

test.describe("one control: hold it to talk, tap it to type", () => {
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
    await fakeMicrophone(page, SPOKEN);
  });

  test("in voice mode there is nothing smaller than the bar to aim at", async ({ page }) => {
    await page.goto("/chat?sample=hk_en");
    const bar = page.getByRole("button", { name: UI.hant["bar.hold"] });
    await expect(bar).toBeVisible();

    // Kevin's complaint, as an assertion: no microphone button, no keyboard toggle, no send arrow
    // sitting beside the bar. One control, and it is the one his thumb is already on.
    await expect(page.locator("main > div:last-child button")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: UI.hant["bar.backToVoice"], exact: true }),
    ).toHaveCount(0);
  });

  test("a quick tap opens the keyboard, and the way back is not a small target", async ({
    page,
  }) => {
    await page.goto("/chat?sample=hk_en");
    await page.getByRole("button", { name: UI.hant["bar.hold"] }).click({ delay: 30 });

    const field = page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true });
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();

    const back = page.getByRole("button", { name: UI.hant["bar.backToVoice"], exact: true });
    const box = await back.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    // Wider than the 48 px circle it replaced, and still the full tap height. It is the one thing
    // in this component a thumb has to aim at, so it is bigger than the floor rather than at it.
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThan(48);

    // And a tap on it puts the keyboard away again.
    await back.click({ delay: 30 });
    await expect(page.getByRole("button", { name: UI.hant["bar.hold"] })).toBeVisible();
  });

  test("holding past the threshold opens the microphone; a thumb sliding off keeps it open", async ({
    page,
  }) => {
    await mockAsk(page, "answered");
    await page.goto("/chat?sample=hk_en");

    const bar = page.getByRole("button", { name: UI.hant["bar.hold"] });
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(PAST_THRESHOLD);

    // The bar says it is listening, in words, on the bar itself.
    const listening = page.getByRole("button", { name: UI.hant["bar.listening"] });
    await expect(listening).toBeVisible();
    await expect(listening).toHaveAttribute("aria-pressed", "true");

    // Now the bug this file exists to keep fixed: drag the pointer clean off the control — past
    // the bar, past the footer, into the thread — and the microphone must still be open. Without
    // `setPointerCapture` the bar's own reflow ended the hold a frame after the press and the
    // gesture killed itself.
    await page.mouse.move(box.x + box.width / 2, box.y - 220, { steps: 10 });
    await page.waitForTimeout(200);
    await expect(page.getByRole("button", { name: UI.hant["bar.listening"] })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Letting go anywhere sends what was heard, and it lands in the thread as the reader's own
    // message — off the bar, where a message being composed belongs.
    await page.mouse.up();
    await expect(page.getByText(SPOKEN, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: UI.hant["bar.hold"] })).toBeVisible();
  });

  test("the way back to voice is itself hold-to-talk, so no mode has to be found first", async ({
    page,
  }) => {
    await mockAsk(page, "answered");
    await page.goto("/chat?sample=hk_en");
    await page.getByRole("button", { name: UI.hant["bar.hold"] }).click({ delay: 30 });

    const back = page.getByRole("button", { name: UI.hant["bar.backToVoice"], exact: true });
    const box = await back.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(PAST_THRESHOLD);
    // Holding it talks rather than switching modes — and the field stays put underneath, because
    // pointer capture lives on this element and unmounting it mid-hold would strand the gesture
    // with the microphone still open.
    await expect(back).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true }),
    ).toBeVisible();

    await page.mouse.up();
    await expect(page.getByText(SPOKEN, { exact: true })).toBeVisible({ timeout: 30_000 });
  });

  test("with no speech input at all the bar is a keyboard and says so", async ({ page }) => {
    // The one state that is not a choice: no engine, so no microphone is offered anywhere.
    await page.addInitScript(() => {
      const globalWindow = window as unknown as Record<string, unknown>;
      delete globalWindow.SpeechRecognition;
      delete globalWindow.webkitSpeechRecognition;
      delete globalWindow.MediaRecorder;
    });
    await page.goto("/chat?sample=hk_en");

    // `visible: true` because the desktop composer carries its own copy of this sentence and is
    // in the DOM at every width, hidden by `lg:block`. The claim here is about what the reader on
    // a phone SEES, so the hidden twin is filtered out rather than asserted about.
    await expect(page.getByText(NO_MIC, { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: UI.hant["bar.hold"] })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: UI.hant["bar.backToVoice"], exact: true }),
    ).toHaveCount(0);

    // Even carrying the extra sentence, the bottom of the screen stays inside its budget.
    const size = await bottomSize(page);
    expect(size.total, `${size.total.toFixed(1)}px`).toBeLessThan(PHONE.height * 0.25);
  });
});
