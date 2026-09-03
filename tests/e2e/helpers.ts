/**
 * T033 — shared plumbing for the two end-to-end specs.
 *
 * No API key exists in this environment, so `/api/read` and `/api/ask` are fulfilled here from
 * the same fixtures the unit tests parse: the mocked stream is built by running the *real* rules
 * (`applyDietRules` then `buildCards`) over `fixtures/sheets/<id>.expected.json`, so the cards the
 * browser renders are exactly the cards the route would have streamed. `/api/tts` is left alone —
 * it answers 503 for real (`TTS_PROVIDER=browser`), which is the browser-speech signal, not a
 * failure.
 *
 * Everything here is deliberately import-light: only pure modules from `lib/` are pulled in, and
 * they are reached by relative path so the Playwright loader never has to resolve the `@/` alias.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { Card, SheetReading, SourceReference, Speakable, StoredReading } from "../../lib/domain/schemas";
import { UI } from "../../lib/i18n/ui";
import { buildCards } from "../../lib/rules/card-order";
import { applyDietRules } from "../../lib/rules/diet-line";
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
 * `delayMs` holds the response back so the three-step progress line is observable; without it a
 * mocked stream can arrive before the first paint.
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

async function seedState(
  page: Page,
  reading?: StoredReading,
  profile?: SeedProfile,
): Promise<void> {
  const state: Record<string, unknown> = {
    version: 1,
    consentedAt: "2026-09-02T08:00:00.000Z",
  };
  if (reading) state.reading = reading;
  if (profile) state.profile = profile;

  await page.addInitScript((payload: SeedPayload) => {
    try {
      // Only when the phone is empty. An init script re-runs on every document load, and a
      // reload that silently reset localStorage would hide exactly the bugs a reload is for
      // (a confirmed plan surviving one, say). This models a real phone: storage persists.
      if (window.localStorage.getItem(payload.key) === null) {
        window.localStorage.setItem(payload.key, payload.state);
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

/** Puts a fixture's reading in `fitornot.v1` so `/read` and `/ask` render from storage. */
export async function seedReading(page: Page, id: FixtureId): Promise<void> {
  await seedState(page, storedReading(id));
}

/** Taps through the consent notice. Expects the gate to be on screen. */
export async function acceptConsent(page: Page): Promise<void> {
  const accept = page.getByRole("button", { name: UI.hant["consent.button"], exact: true });
  await accept.click();
  await expect(accept).toHaveCount(0);
}

/* -------------------------------------------------------------------------- */
/* Page actions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Puts one bundled page through the hidden file input `components/Capture.tsx` renders.
 *
 * The camera input is first in the DOM and the photo-library input second; on desktop Chrome the
 * `capture` attribute is ignored, so both open the same picker and either can be driven here.
 */
export async function uploadFixture(
  page: Page,
  file: string,
  source: "camera" | "library" = "camera",
): Promise<void> {
  const inputs = page.locator('input[type="file"]');
  const input = source === "camera" ? inputs.first() : inputs.last();
  await input.setInputFiles(path.join(FIXTURE_DIR, file));
  // The downscaled preview and the start button only appear once the file has been decoded.
  await expect(page.getByRole("button", { name: UI.hant["capture.start"], exact: true })).toBeVisible();
}

/**
 * Completes first-launch setup as 阿媽 · 廣東話 and waits for the capture tile.
 *
 * Since Story 2 (T035) `/` sends a phone with no profile to `/setup`, so the session-language
 * tap that used to live on the home screen is now the second of two setup questions. The name
 * stays because the outcome is the same: Cantonese chosen, camera on screen.
 */
export async function chooseCantonese(page: Page): Promise<void> {
  await page.getByRole("button", { name: UI.hant["setup.chip.mother"], exact: true }).click();
  await page.getByRole("button", { name: UI.hant["language.yue"], exact: true }).click();
  await expectCaptureScreen(page);
}

/**
 * Waits for the capture screen on `/`.
 *
 * The landmark, not the tile: the tile is named 影低張出院紙 or 相簿揀相 depending on whether the
 * browser supports the `capture` attribute (desktop Chrome here does not), and which of those is
 * on screen is `fallbacks.spec.ts`'s business, not every caller's.
 */
export async function expectCaptureScreen(page: Page): Promise<void> {
  await expect(page.getByRole("region", { name: UI.hant["capture.title"], exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: UI.hant["capture.sample"], exact: true }),
  ).toBeVisible();
}

/**
 * Puts a profile on the phone before the first paint, for tests that are not about setup.
 * `label` is deliberately the same 阿媽 the setup flow writes, so the two paths agree.
 */
export async function seedProfile(page: Page, id?: FixtureId): Promise<void> {
  await seedState(page, id ? storedReading(id) : undefined, {
    label: "阿媽",
    dialect: "yue",
    script: "hant",
  });
}

/** Types one question into the ask screen and sends it. */
export async function askQuestion(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: UI.hant["ask.placeholder"], exact: true }).fill(text);
  await page.getByRole("button", { name: UI.hant["ask.send"], exact: true }).click();
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

/** Every card on screen, as `<article>` elements in document order. */
export function cards(page: Page) {
  return page.getByRole("article");
}

/** The heading of every card on screen, in order. */
export async function cardTitles(page: Page): Promise<string[]> {
  return cards(page).locator("h2").allTextContents();
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
