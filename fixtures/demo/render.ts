/**
 * Renders the three demo discharge sheets under `fixtures/demo/`.
 *
 *   env -u NODE_OPTIONS ./node_modules/.bin/tsx fixtures/demo/render.ts
 *
 * Same recipe as `fixtures/sheets/render.ts` and `fixtures/stress/render.ts`: A4
 * at 150 dpi (1240x1754), a local Google Chrome first because the cached
 * chromium build on this machine is version-mismatched with playwright-core.
 *
 * These are DEMO assets, not test fixtures. `fixtures/sheets/` was built to test
 * the reader and `fixtures/stress/` to break it; these are built to be projected
 * at a hackathon, so they are typeset the way ward paperwork actually is and each
 * one exists to show one thing on stage:
 *
 *   hk_stack_page1.png  medicines, and a follow-up line that points at page 2
 *   hk_stack_page2.png  the 覆診紙 and the 抽血紙 — both appointment dates, no drugs
 *   hk_stopped.png      a "not to be taken after discharge" block styled like any other
 *   cn_zh_clinic.png    a mainland 出院指导单 whose row 5 the dose counter must refuse
 *   demo_en.png         the live-demo English sheet: 4 medicines, 1 stopped, 3 warning
 *                       signs with one action, a clinic date and a fasting blood test (2x)
 *   demo_zh_hant.png    the same skeleton as a Hong Kong Traditional Chinese 出院摘要 (2x)
 *
 * Every sheet is synthetic: fictional hospital, fictional patient, placeholder
 * identifiers, and a visible "SYNTHETIC — NOT A REAL MEDICAL RECORD /
 * 合成樣張，非真實病歷" stamp in the letterhead and in the footer.
 */
import { chromium, type Browser } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const A4 = { width: 1240, height: 1754 };
const CHROME_MAC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The page images, in the order they are printed and photographed.
 *
 * `scale` is the deviceScaleFactor: 1 keeps the original four at 1240x1754, exactly as they were
 * first rendered, so their answer keys and any photograph taken of them stay valid. The two
 * live-demo sheets render at 2 (2480x3508) so a projected page and a phone upload both start
 * from the sharpest text we can make — `tests/eval/demo.ts` checks the size per sheet.
 */
export const DEMO_PAGES = [
  { name: "hk_stack_page1", scale: 1 },
  { name: "hk_stack_page2", scale: 1 },
  { name: "hk_stopped", scale: 1 },
  { name: "cn_zh_clinic", scale: 1 },
  { name: "demo_en", scale: 2 },
  { name: "demo_zh_hant", scale: 2 },
] as const;

/** `channel: "chrome"` first, then the same binary by path; the bundled chromium last. */
async function launch(): Promise<{ browser: Browser; how: string }> {
  const attempts: Array<[string, () => Promise<Browser>]> = [
    ['channel: "chrome"', () => chromium.launch({ channel: "chrome", timeout: 30_000 })],
  ];
  if (existsSync(CHROME_MAC)) {
    attempts.push([
      "local Google Chrome (executablePath)",
      () => chromium.launch({ executablePath: CHROME_MAC, timeout: 30_000 }),
    ]);
  }
  attempts.push(["playwright bundled chromium", () => chromium.launch({ timeout: 30_000 })]);

  const errors: string[] = [];
  for (const [how, run] of attempts) {
    try {
      return { browser: await run(), how };
    } catch (error) {
      errors.push(`  - ${how}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  throw new Error(`No usable browser. Tried:\n${errors.join("\n")}`);
}

/** width x height straight out of the PNG IHDR. */
function dims(file: string): string {
  const b = readFileSync(file);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  }
  return "?";
}

function report(file: string): void {
  const size = statSync(file).size;
  console.log(
    `  ${path.relative(ROOT, file).padEnd(36)} ${dims(file).padEnd(11)} ${(size / 1024).toFixed(0)} KB`,
  );
}

async function main(): Promise<void> {
  const { browser, how } = await launch();
  console.log(`browser: ${how}\n`);

  for (const { name, scale } of DEMO_PAGES) {
    const page = await browser.newPage({ viewport: A4, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(path.join(HERE, `${name}.html`)).href, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);
    // A sheet that has overflowed its A4 box would be silently cropped by the
    // screenshot, and a cropped medicine is a missing medicine.
    const overflow = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
    if (overflow > 0) {
      console.warn(`  ! ${name}.html overflows the A4 page by ${overflow}px — content is cut off`);
    }
    const out = path.join(HERE, `${name}.png`);
    await page.screenshot({ path: out, type: "png", omitBackground: false });
    await page.close();
    report(out);
  }

  await browser.close();
  console.log("\ndone.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
