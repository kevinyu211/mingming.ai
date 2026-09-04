/**
 * Shared plumbing for the browser suite, on the v2 information architecture.
 *
 * No API key exists in this environment, so `/api/read` and `/api/ask` are fulfilled here from
 * the same fixtures the unit tests parse: the mocked stream is built by running the *real* rules
 * (`applyDietRules` then `buildCards`) over `fixtures/sheets/<id>.expected.json`, so what the
 * browser renders is exactly what the route would have streamed. `/api/tts` is left alone — it
 * answers 503 for real (`TTS_PROVIDER=browser`), which is the browser-speech signal, not a
 * failure.
 *
 * ## What moved in v2, and what did not
 *
 * The mocks, the fixture readers and the consent seeding are unchanged, which is why
 * `chat-briefing.spec.ts` and `capture-ceiling.spec.ts` import them without knowing this file was
 * rewritten. What changed is everything that named a v1 screen:
 *
 *   · `/` is 記錄 now and never redirects to `/setup`, so there is no "complete setup, then reach
 *     the camera" step to help with. A first run defaults to Cantonese. `expectHomeScreen` waits
 *     for the tab instead, and `chooseCantonese()` is gone.
 *   · the camera lives on its own route, so `expectCaptureScreen` waits for `/capture`'s
 *     viewfinder and `uploadFixture` drives `/capture` rather than a tile on the home screen.
 *   · questions go into the 傾偈 thread through the one bar at the bottom, so `askQuestion` types
 *     into `bar.typePlaceholder` rather than the v1 ask screen's own field.
 *   · nothing renders `<article>` any more (`components/CardStack.tsx` is orphaned), so the
 *     `cards()` / `cardTitles()` pair went with the screen it described.
 *
 * `seedSheet` is the new one that matters: it writes the ONE active sheet the whole product is
 * shaped around (brief §1) straight into `fitornot.v1`, built by the same pure rules
 * `lib/sheets/store.ts` uses. That is how a test reaches a state the fixtures cannot produce —
 * a withdrawn medicine, a follow-up line the date rules refused to read — without a model call.
 *
 * Everything here is deliberately import-light: only pure modules from `lib/` are pulled in, and
 * they are reached by relative path so the Playwright loader never has to resolve the `@/` alias.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type {
  Card,
  SheetReading,
  SourceReference,
  Speakable,
  StoredReading,
} from "../../lib/domain/schemas";
import { UI } from "../../lib/i18n/ui";
import { buildCards } from "../../lib/rules/card-order";
import { applyDietRules } from "../../lib/rules/diet-line";
import { draftPlan } from "../../lib/rules/plan-from-reading";
import { sheetTitle } from "../../lib/sheets/title";
import type { CheckinState, DoseState, Sheet, ThreadMessage } from "../../lib/sheets/types";
import { KEY } from "../../lib/storage/local";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

export const FIXTURE_DIR = path.resolve(__dirname, "..", "..", "fixtures", "sheets");

/** The two bundled sheets these specs read. */
export type FixtureId = "hk_en" | "cn_zh";

const readingCache = new Map<FixtureId, SheetReading>();

function fixture(id: FixtureId): SheetReading {
  const cached = readingCache.get(id);
  if (cached) return cached;
  const parsed = JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, `${id}.expected.json`), "utf8"),
  ) as SheetReading;
  readingCache.set(id, parsed);
  return parsed;
}

/**
 * The reading as `/api/read` returns it: `recognisedType` set by the diet rules (the route's job,
 * not the model's), and no `readAt` — the client stamps that itself and never sends it anywhere.
 */
export function wireReading(id: FixtureId): Omit<StoredReading, "readAt"> {
  const raw = fixture(id);
  return { ...raw, dietLine: applyDietRules(raw) };
}

/** The reading as it sits in `localStorage` after a read. The timestamp is fixed for stability. */
export function storedReading(id: FixtureId): StoredReading {
  return { ...wireReading(id), readAt: "2026-09-02T09:00:00.000Z" };
}

/** The cards the app must render for a fixture, in the rulebook's fixed order. */
export function expectedCards(id: FixtureId): Card[] {
  return buildCards(storedReading(id));
}

/** One card of a fixture by id, e.g. `medicine-0`. */
export function expectedCard(id: FixtureId, cardId: string): Card {
  const card = expectedCards(id).find((entry) => entry.id === cardId);
  if (!card) throw new Error(`fixture ${id} has no card ${cardId}`);
  return card;
}

/** The source line of one card. Verbatim page text — never converted, never translated. */
export function expectedSource(id: FixtureId, cardId: string): SourceReference {
  const source = expectedCard(id, cardId).source;
  if (!source) throw new Error(`card ${cardId} of fixture ${id} carries no source`);
  return source;
}

/* -------------------------------------------------------------------------- */
/* Readings the fixtures do not contain                                       */
/* -------------------------------------------------------------------------- */

/**
 * The same reading with one medicine marked as withdrawn by the page.
 *
 * None of the three checked-in sheets prints a stopped drug, and it is the single most dangerous
 * thing this product can get wrong (`tests/eval/stress.md`, "The worst single miss"): a medicine
 * the hospital stopped, counted down as if it were due. So the state is constructed rather than
 * waited for, from a real reading, changing exactly one field.
 */
export function withStoppedMedicine(reading: StoredReading, index: number): StoredReading {
  const medicines = reading.medicines.map((medicine, i) =>
    i === index ? { ...medicine, status: "stopped" as const } : medicine,
  );
  return { ...reading, medicines };
}

/**
 * The same reading with the first follow-up line printed differently.
 *
 * Both bundled sheets print a form the date rules CAN read ("2/52", 「2周后」), so the branch where
 * `plan.followUpDate` is null — the one where 跟進 must show the printed words and count nothing —
 * has no fixture at all. Passing a hedged line such as 「大約兩個星期後」 reaches it honestly:
 * `parseFollowUpDate` refuses anything with 約 in it, exactly as it would on a real page.
 */
export function withFollowUpWhen(reading: StoredReading, when: string): StoredReading {
  const followUp = reading.followUp.map((entry, i) => (i === 0 ? { ...entry, when } : entry));
  return { ...reading, followUp };
}

/* -------------------------------------------------------------------------- */
/* Route mocks                                                                */
/* -------------------------------------------------------------------------- */

const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/** Every request one mocked route saw. `bodies` has image bytes elided so failures stay readable. */
export interface RouteLog {
  count: number;
  bodies: Record<string, unknown>[];
}

/** What `/api/read` should do: read a fixture, decline, or fail with one of the contract's codes. */
export type ReadMock = FixtureId | "unknown" | { status: 413 | 422 | 502 };

/** What `/api/ask` should do: answer citing `medicine-0`, or fail the way the contract says. */
export type AskMock = "answered" | { status: 502 };

/** The names `contracts/api-read.md` pairs with each status. */
const READ_ERRORS: Record<413 | 422 | 502, string> = {
  413: "too_large",
  422: "invalid_reading",
  502: "model_unavailable",
};

function ndjson(events: unknown[]): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Replaces the base64 pages with their length: a logged body must stay printable on failure. */
function elideImages(body: Record<string, unknown>): Record<string, unknown> {
  const images = body.images;
  if (!Array.isArray(images)) return body;
  return {
    ...body,
    images: images.map((image: unknown) => {
      if (typeof image !== "object" || image === null) return image;
      const entry = image as Record<string, unknown>;
      return typeof entry.base64 === "string"
        ? { ...entry, base64: `<${entry.base64.length} base64 chars>` }
        : entry;
    }),
  };
}

function record(log: RouteLog, postData: string | null): void {
  log.count += 1;
  if (postData === null) return;
  try {
    log.bodies.push(elideImages(JSON.parse(postData) as Record<string, unknown>));
  } catch {
    log.bodies.push({ unparseable: postData.length });
  }
}

/**
 * Fulfils `POST /api/read`. Returns the log so a test can assert what was sent and how often.
 *
 * `delayMs` holds the response back so the 讀住你張紙… state is observable; without it a mocked
 * stream can arrive before the first paint.
 */
export async function mockRead(
  page: Page,
  outcome: ReadMock,
  options: { delayMs?: number } = {},
): Promise<RouteLog> {
  const log: RouteLog = { count: 0, bodies: [] };

  await page.route("**/api/read", async (route) => {
    record(log, route.request().postData());
    if (options.delayMs) await sleep(options.delayMs);

    if (typeof outcome === "object") {
      await route.fulfill({
        status: outcome.status,
        contentType: "application/json",
        body: JSON.stringify({ error: READ_ERRORS[outcome.status] }),
      });
      return;
    }

    if (outcome === "unknown") {
      // FR-006: not a discharge sheet, so one event and no cards at all.
      await route.fulfill({
        status: 200,
        contentType: NDJSON_CONTENT_TYPE,
        body: ndjson([{ event: "status", phase: "reading" }, { event: "unknown" }]),
      });
      return;
    }

    const reading = wireReading(outcome);
    await route.fulfill({
      status: 200,
      contentType: NDJSON_CONTENT_TYPE,
      body: ndjson([
        { event: "status", phase: "reading" },
        ...buildCards(reading).map((card) => ({ event: "card", card })),
        { event: "done", reading, filter: { regenerated: 0, templated: 0 } },
      ]),
    });
  });

  return log;
}

/** The answer the mocked `/api/ask` gives, cited to `medicine-0` of the Hong Kong sheet. */
export const MOCK_ANSWER: Speakable = {
  yue: "張紙寫住 Amlodipine 5mg 每日一次，冇分朝早定夜晚。",
  cmn: "纸上写着 Amlodipine 5mg 每天一次，没有分早上还是晚上。",
  en: "The sheet says Amlodipine 5mg once a day. It does not say morning or night.",
};

/** The card the mocked answer cites. */
export const MOCK_CITED_CARD_ID = "medicine-0";

/** Fulfils `POST /api/ask`. Returns the log, which is how "no model call" is proved. */
export async function mockAsk(page: Page, outcome: AskMock): Promise<RouteLog> {
  const log: RouteLog = { count: 0, bodies: [] };

  await page.route("**/api/ask", async (route) => {
    record(log, route.request().postData());

    if (typeof outcome === "object") {
      await route.fulfill({
        status: outcome.status,
        contentType: "application/json",
        body: JSON.stringify({ error: "model_unavailable" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: NDJSON_CONTENT_TYPE,
      body: ndjson([
        {
          event: "outcome",
          outcome: "answered",
          citedCardId: MOCK_CITED_CARD_ID,
          source: expectedSource("hk_en", MOCK_CITED_CARD_ID),
        },
        { event: "answer", answer: MOCK_ANSWER },
        { event: "done" },
      ]),
    });
  });

  return log;
}

/* -------------------------------------------------------------------------- */
/* Session state                                                              */
/* -------------------------------------------------------------------------- */

/** `components/ConsentGate.tsx`: the per-session half of the consent mark. */
export const CONSENT_SESSION_KEY = "fitornot.consent.session";

/** `components/Capture.tsx`'s hand-off slot — the one transient home for image bytes. */
export const PENDING_IMAGES_KEY = "fitornot.pending-images";

interface SeedPayload {
  key: string;
  sessionKey: string;
  state: string;
}

/** The on-device profile: a relationship label and a dialect, and nothing else (FR-016). */
export interface SeedProfile {
  label: string;
  dialect: "yue" | "cmn";
  script: "hant" | "hans";
}

/** The profile the setup flow writes when 阿媽 is tapped. The only one any spec needs. */
export const MOTHER: SeedProfile = { label: "阿媽", dialect: "yue", script: "hant" };

/** Everything a test may want on the phone before the first paint. All of it optional. */
interface SeedState {
  reading?: StoredReading;
  profile?: SeedProfile;
  sheets?: { active: Sheet | null; archive: Sheet[] };
}

async function seedState(page: Page, seed: SeedState = {}): Promise<void> {
  const state: Record<string, unknown> = {
    version: 1,
    consentedAt: "2026-09-02T08:00:00.000Z",
  };
  if (seed.reading) state.reading = seed.reading;
  if (seed.profile) state.profile = seed.profile;
  if (seed.sheets) state.sheets = seed.sheets;

  await page.addInitScript((payload: SeedPayload) => {
    try {
      const raw = window.localStorage.getItem(payload.key);
      const seeded = JSON.parse(payload.state) as Record<string, unknown>;
      if (raw === null) {
        window.localStorage.setItem(payload.key, payload.state);
      } else {
        // Fill in only what is MISSING, never overwrite. Two things follow from that, and both
        // matter. Within one load, `seedConsent()` then `seedSheet()` compose instead of the
        // second silently losing to the first — an init script cannot see the ones registered
        // after it, so merging is the only way a beforeEach and a test body can both seed. And
        // across loads nothing is restored: a reload that quietly reset localStorage would hide
        // exactly the bugs a reload is for (a counted dose surviving one, say). This models a
        // real phone — storage persists, and what the app wrote wins.
        const current = JSON.parse(raw) as Record<string, unknown>;
        let changed = false;
        for (const [field, value] of Object.entries(seeded)) {
          if (field in current) continue;
          current[field] = value;
          changed = true;
        }
        if (changed) window.localStorage.setItem(payload.key, JSON.stringify(current));
      }
      window.sessionStorage.setItem(payload.sessionKey, "1");
    } catch {
      // An opaque origin (about:blank) has no storage; nothing to seed there.
    }
  }, { key: KEY, sessionKey: CONSENT_SESSION_KEY, state: JSON.stringify(state) } satisfies SeedPayload);
}

/** Marks the session as consented before the first paint, for tests that are not about the gate. */
export async function seedConsent(page: Page): Promise<void> {
  await seedState(page);
}

/**
 * Puts a fixture's reading in `fitornot.v1` under the pre-v2 top-level key.
 *
 * Deliberately still the OLD shape: `lib/sheets/store.ts` migrates a stored `reading` into the
 * active sheet on first load, and that migration is a real path a phone upgraded from v1 takes.
 * A test that only wants "there is a sheet on this phone" is better served by `seedSheet`.
 */
export async function seedReading(page: Page, id: FixtureId): Promise<void> {
  await seedState(page, { reading: storedReading(id) });
}

/**
 * Puts a profile on the phone before the first paint, for tests that are not about setup.
 * `label` is deliberately the same 阿媽 the setup flow writes, so the two paths agree.
 */
export async function seedProfile(page: Page, id?: FixtureId): Promise<void> {
  await seedState(page, {
    reading: id ? storedReading(id) : undefined,
    profile: MOTHER,
  });
}

/**
 * One sheet, shaped exactly as `startSheet()` would have written it.
 *
 * `plan` and `title` come from the same pure rules the store calls (`draftPlan`, `sheetTitle`),
 * never from literals: a hand-written plan in a test would keep passing after the rule that
 * builds the real one changed underneath it.
 *
 * The default `briefing.phase` is `end` because most callers want a sheet that is simply *there*
 * — on 跟進, or on 記錄 — without 明仔 starting to talk over the assertions. A spec about the
 * briefing itself passes `{ briefing: { phase: "idle", step: 0 } }`.
 */
export function activeSheet(reading: StoredReading, overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: "sheet-e2e",
    capturedAt: reading.readAt,
    pageCount: 1,
    title: sheetTitle(reading, "hant"),
    reading,
    plan: draftPlan(reading),
    thread: [],
    doses: {},
    briefing: { phase: "end", step: 0 },
    checkin: "none",
    archivedAt: null,
    ...overrides,
  };
}

/**
 * Puts the ONE active sheet — and optionally the read-only history behind it — on the phone
 * before the first paint (brief §1, §5).
 *
 * This is the seam every v2 screen reads through: 記錄, 傾偈 and 跟進 all render `sheets.active`
 * and nothing else, so seeding it is the whole of "this family has photographed a sheet".
 *
 * Composes with `seedConsent` / `seedProfile`: they fill in different fields of the same stored
 * state and nothing overwrites anything, so a `beforeEach` and a test body can each seed a part.
 */
export async function seedSheet(
  page: Page,
  sheet: Sheet,
  options: { archive?: Sheet[]; profile?: SeedProfile } = {},
): Promise<void> {
  await seedState(page, {
    sheets: { active: sheet, archive: options.archive ?? [] },
    profile: options.profile,
  });
}

/** A sheet already archived: read-only, counters frozen, 只可以睇 (brief §1). */
export function archivedSheet(sheet: Sheet, archivedAt: string): Sheet {
  return { ...sheet, id: `${sheet.id}-old`, archivedAt };
}

/**
 * Puts `n` real JPEGs into `components/Capture.tsx`'s hand-off slot, as if the camera had just
 * downscaled that many pages, and leaves the browser on `/settings` ready to navigate to `/chat`.
 *
 * A real canvas encode rather than a stub string, because the 413 path re-decodes these bytes and
 * re-encodes them smaller: a placeholder would make the retry silently not happen and the test
 * would pass for the wrong reason. `/settings` is the parking spot only because the bytes have to
 * be written from a page on the same origin that is not itself going to read them.
 */
export async function seedPendingPages(page: Page, count = 1): Promise<void> {
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

/** Taps through the consent notice. Expects the gate to be on screen. */
export async function acceptConsent(page: Page): Promise<void> {
  const accept = page.getByRole("button", { name: UI.hant["consent.button"], exact: true });
  await accept.click();
  await expect(accept).toHaveCount(0);
}

/* -------------------------------------------------------------------------- */
/* Devices that cannot speak or listen                                        */
/* -------------------------------------------------------------------------- */

/**
 * A phone with no speech input at all — no Web Speech API, no recorder to fall back to.
 *
 * Headless Chrome ships `webkitSpeechRecognition`, so the honest keyboard-only state has to be
 * asked for. It is also the only state in which the chat bar's text field exists from the first
 * paint, which is why every spec that types a question starts here.
 */
export async function noSpeechInput(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const globalWindow = window as unknown as Record<string, unknown>;
    delete globalWindow.SpeechRecognition;
    delete globalWindow.webkitSpeechRecognition;
    delete globalWindow.MediaRecorder;
  });
}

/**
 * A phone with no voice at all: no cloud voice and no device voice.
 *
 * Both halves are needed. `/api/tts` already answers 503 under `TTS_PROVIDER=browser`, but a suite
 * pointed at a dev server configured for a cloud provider would get audio, so the route is forced;
 * deleting `speechSynthesis` removes the device voice. With neither, `lib/speech/tts.ts` returns
 * `text-only`, which is the state the screen has to keep working in.
 */
export async function noVoiceOutput(page: Page): Promise<void> {
  await page.route("**/api/tts", (route) => route.fulfill({ status: 503 }));
  await page.addInitScript(() => {
    // Window interface members are own properties of the global object, so this really removes
    // them: `lib/speech/tts.ts` then falls through the cloud path (503) to text-only.
    const globalWindow = window as unknown as Record<string, unknown>;
    delete globalWindow.speechSynthesis;
    delete globalWindow.SpeechSynthesisUtterance;
  });
}

/* -------------------------------------------------------------------------- */
/* Page actions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Gets one bundled page as far as the review screen, through the real `/capture` route.
 *
 * v1 had the camera on `/`; v2 gives it a full-screen route of its own, so this navigates. The
 * camera input is first in the DOM and the photo-library input second (`components/Capture.tsx`);
 * on desktop Chrome the `capture` attribute is ignored, so both open the same picker and either
 * can be driven here. The caller is left on the review grid, one tap from 講俾我聽.
 */
export async function uploadFixture(
  page: Page,
  file: string,
  source: "camera" | "library" = "camera",
): Promise<void> {
  await page.goto(source === "camera" ? "/capture" : "/capture?pick=1");

  const inputs = page.locator('input[type="file"]');
  await inputs.first().waitFor({ state: "attached" });

  if (source === "camera") {
    await inputs.first().setInputFiles(path.join(FIXTURE_DIR, file));
    // The viewfinder shows a COUNT, not the picture: the photograph itself is on the review screen
    // one 完成 away. Waiting on the count is also what proves the file was decoded and downscaled.
    // 6 is `MAX_PAGES` in `components/Capture.tsx`, written out here rather than imported: that
    // module is a client component and pulling it in would drag React and next/navigation into
    // the Playwright loader. `capture-ceiling.spec.ts` writes it out for the same reason.
    await expect(page.getByText("1/6", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: UI.hant["camera.done"], exact: true }).click();
  } else {
    await inputs.last().setInputFiles(path.join(FIXTURE_DIR, file));
    // The picker sits OVER the review grid, so for a moment the page is drawn in both. Closing it
    // on 用揀好嘅 1 張 leaves the one copy that matters.
    await page
      .getByRole("button", { name: UI.hant["pick.use"].replace("{n}", "1"), exact: true })
      .click();
  }

  // By exact alt text rather than by role alone: the dev overlay contributes an image of its own.
  await expect(page.getByRole("img", { name: "第 1 頁", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: UI.hant["review.start"], exact: true })).toBeVisible();
}

/** 講俾我聽 — hands the pages to `/chat`, which owns the read and every one of its failures. */
export async function startReading(page: Page): Promise<void> {
  await page.getByRole("button", { name: UI.hant["review.start"], exact: true }).click();
}

/**
 * Types one question into the 傾偈 bar and sends it.
 *
 * Requires the bar to be in keyboard mode, which on a device with a microphone means either a tap
 * on the bar or `noSpeechInput(page)` before the load. There is no separate ask screen any more:
 * the question goes into the same thread the sheet arrived in (brief §6).
 */
export async function askQuestion(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: UI.hant["bar.typePlaceholder"], exact: true }).fill(text);
  await page.getByRole("button", { name: UI.hant["bar.send"], exact: true }).click();
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Waits for 記錄, the way in (brief §1).
 *
 * The heading and the two tiles, not one particular tile: whether the big one says 拍張紙 or opens
 * the picker is `/capture`'s business one tap later, and every caller here only needs to know the
 * app has finished landing.
 */
export async function expectHomeScreen(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: UI.hant["home.title"], exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: UI.hant["capture.photo"] })).toBeVisible();
  await expect(page.getByRole("link", { name: UI.hant["capture.upload"] })).toBeVisible();
}

/**
 * Waits for `/capture`'s viewfinder.
 *
 * Both phone profiles report touch, so `components/Capture.tsx` opens on the camera; the laptop
 * branch (no touch, desktop UA) opens on the review grid instead and is asserted where it belongs,
 * in `fallbacks.spec.ts`.
 */
export async function expectCaptureScreen(page: Page): Promise<void> {
  await expect(
    page.getByRole("button", { name: UI.hant["camera.shutter"], exact: true }),
  ).toBeVisible();
  await expect(page.getByText(UI.hant["camera.hintFirst"], { exact: true })).toBeVisible();
}

/** rules.md §16: the disclaimer footer is on every screen. */
export async function expectDisclaimer(page: Page): Promise<void> {
  await expect(page.getByText(UI.hant.disclaimer, { exact: true })).toBeVisible();
}

/** design.md: a phone screen never scrolls sideways. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const measured = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    measured.scrollWidth,
    `document.documentElement.scrollWidth (${measured.scrollWidth}) must not exceed window.innerWidth (${measured.innerWidth})`,
  ).toBeLessThanOrEqual(measured.innerWidth);
}

/**
 * Nothing anywhere on the screen names a clock time or a part of the day (brief §2 rule 7).
 *
 * The sheet prints *frequencies*, so a counter that said "8am" or 「夜晚仲有一次」 would be the app
 * prescribing. This walks the rendered text rather than one element, because the rule is about the
 * whole screen: a time that leaked into a card heading is as wrong as one inside a counter.
 *
 * `allowed` is for the timestamps that are legitimately times — 明仔's in-app message stamp on 記錄
 * is the only one, and it is a fact about the thread, not about a medicine.
 */
export async function expectNoClockTime(page: Page, allowed: RegExp[] = []): Promise<void> {
  const text = ((await page.locator("body").textContent()) ?? "").replace(/\s+/g, " ");
  const cleaned = allowed.reduce((rest, pattern) => rest.replace(pattern, " "), text);

  const forbidden: { name: string; pattern: RegExp }[] = [
    { name: "a clock time (12:30, 8am, 8 pm)", pattern: /\d{1,2}\s*[:：]\s*\d{2}|\b\d{1,2}\s*[ap]\.?m\.?/i },
    { name: "上午 / 下午 / AM / PM", pattern: /上午|下午|凌晨|[^A-Za-z](AM|PM)[^A-Za-z]/ },
    { name: "a part of the day (朝早 / 夜晚 / 晚上 / morning / evening)", pattern: /朝早|夜晚|晚上|早上|morning|evening|night-?time/i },
    { name: "N 點 / N 时 as an hour", pattern: /\d{1,2}\s*[點点]鐘?|\d{1,2}\s*[時时]\s*(?:正|開始)?/ },
  ];

  for (const { name, pattern } of forbidden) {
    const hit = cleaned.match(pattern);
    expect(hit, `the screen must not name ${name} — it printed ${JSON.stringify(hit?.[0])}`).toBeNull();
  }
}

/** Re-exported so a spec can build a thread or a counter without reaching into `lib/`. */
export type { CheckinState, DoseState, Sheet, ThreadMessage };
