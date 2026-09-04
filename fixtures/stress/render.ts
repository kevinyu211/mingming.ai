/**
 * Renders the four deliberately hard discharge sheets under `fixtures/stress/`.
 *
 *   env -u NODE_OPTIONS ./node_modules/.bin/tsx fixtures/stress/render.ts
 *
 * Same recipe as `fixtures/sheets/render.ts`: A4 at 150 dpi (1240x1754) for the
 * typeset pages, a 1100x1500 JPEG for the "photographed badly" one, and a local
 * Google Chrome rather than Playwright's bundled chromium (the cached build on
 * this machine is version-mismatched, so `chromium.launch()` fails outright).
 *
 * Outputs (all synthetic — fictional patients, fictional hospitals):
 *   fixtures/stress/dense.png        two columns, 8 medicines, small tight type
 *   fixtures/stress/messy.jpg        dense.png rotated 8deg, shadowed, blurred, thumb on the table
 *   fixtures/stress/handwritten.png  typeset form with ink annotations and an illegible remarks box
 *   fixtures/stress/mixed.png        bilingual sheet with a lab table above the medicines
 *
 * It also prints the page-pixel boxes of the medicine-table rows in dense.png.
 * `messy.html` hard-codes the numbers this prints, so re-run it after any edit to
 * `dense.html` and check the thumb still lands on rows 6-7 of the table.
 */
import { chromium, type Browser } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const A4 = { width: 1240, height: 1754 };
const PHOTO = { width: 1100, height: 1500 };
const CHROME_MAC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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

/** width x height straight out of the PNG IHDR / JPEG SOF header. */
function dims(file: string): string {
  const b = readFileSync(file);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`;
      }
      i += 2 + len;
    }
  }
  return "?";
}

function report(file: string): void {
  const size = statSync(file).size;
  console.log(
    `  ${path.relative(ROOT, file).padEnd(34)} ${dims(file).padEnd(11)} ${(size / 1024).toFixed(0)} KB`,
  );
}

async function main(): Promise<void> {
  const { browser, how } = await launch();
  console.log(`browser: ${how}\n`);

  for (const name of ["dense", "handwritten", "mixed"]) {
    const page = await browser.newPage({ viewport: A4, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(HERE, `${name}.html`)).href, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(HERE, `${name}.png`);
    await page.screenshot({ path: out, type: "png", omitBackground: false });

    if (name === "dense") {
      const rows = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll("table.rx tr")) as HTMLElement[];
        return trs.map((tr, i) => {
          const r = tr.getBoundingClientRect();
          return {
            i,
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            left: Math.round(r.left),
            right: Math.round(r.right),
          };
        });
      });
      console.log("  medicine-table row boxes in dense.png (row 0 is the header, page px):");
      for (const r of rows) {
        console.log(`    [${r.i}] top ${r.top} bottom ${r.bottom} left ${r.left} right ${r.right}`);
      }
    }
    await page.close();
    report(out);
  }

  const page = await browser.newPage({ viewport: PHOTO, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(HERE, "messy.html")).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const jpg = path.join(HERE, "messy.jpg");
  await page.screenshot({ path: jpg, type: "jpeg", quality: 55 });
  await page.close();
  report(jpg);

  await browser.close();
  console.log("\ndone.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
