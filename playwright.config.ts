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
        channel: "chrome",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        userAgent: devices["iPhone 14"].userAgent,
      },
    },
    {
      name: "android",
      use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      TTS_PROVIDER: "browser",
      STT_PROVIDER: "browser",
      NEXT_PUBLIC_STT_MODE: "browser",
    },
  },
});
