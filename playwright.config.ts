import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the live path. Tests mock /api/read and /api/ask from fixtures so they run
 * without any API key (see tests/e2e/*.spec.ts). Viewport is phone-sized per plan.md.
 *
 * The dev server port is configurable (`E2E_PORT`, default 3000) because other projects on the
 * same machine often hold 3000; `E2E_BASE_URL` overrides the whole base URL for a remote target.
 */
const port = process.env.E2E_PORT ?? "3000";
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

/**
 * Where the browser comes from.
 *
 * On Kevin's Mac there is a real Google Chrome and `channel: "chrome"` finds it. In a container
 * there is not, and Playwright's own download lives at a path the runner already knows — so
 * `E2E_CHROME` points at it and takes precedence. Setting one clears the other: passing both a
 * channel and an executablePath is an error.
 */
const executablePath = process.env.E2E_CHROME;
// `--mute-audio`: the suite runs with TTS_PROVIDER=browser, so every briefing line would otherwise
// be spoken by macOS speechSynthesis through the Mac's speakers while the tests run. The specs
// assert DOM state, never sound.
const browser = executablePath
  ? { launchOptions: { executablePath, args: ["--mute-audio"] } }
  : { channel: "chrome" as const, launchOptions: { args: ["--mute-audio"] } };

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "zh-HK",
  },
  // Playwright's bundled Chromium hangs on launch on this machine (see fixtures/sheets/render.ts),
  // so both phone profiles run on the locally installed Google Chrome via `channel: "chrome"`.
  // The iPhone profile is a Chromium emulation of the iPhone 14 viewport, not WebKit.
  projects: [
    {
      name: "iphone",
      use: {
        ...devices["Pixel 7"],
        ...browser,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        userAgent: devices["iPhone 14"].userAgent,
      },
    },
    {
      name: "android",
      use: { ...devices["Pixel 7"], ...browser, viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      TTS_PROVIDER: "browser",
      // No key, so `/api/stt` answers 503 and the hybrid falls back to the browser engine -
      // which is the point. The MODE stays "cloud" because that is what production runs, and
      // every spec that holds the bar deletes `MediaRecorder` anyway, so what these tests
      // exercise is `listenHybrid` degrading to browser-only rather than a path nobody ships.
      STT_PROVIDER: "browser",
      NEXT_PUBLIC_STT_MODE: "cloud",
    },
  },
});
