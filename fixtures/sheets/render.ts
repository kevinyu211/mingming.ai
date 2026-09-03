/**
 * T005 — render the synthetic discharge-sheet fixtures.
 *
 *   npx tsx fixtures/sheets/render.ts
 *
 * Outputs (all synthetic, fictional patients and hospitals — see constitution
 * "Hackathon Compliance Constraints"):
 *   fixtures/sheets/hk_en.png          A4 @150dpi, 1240x1754
 *   fixtures/sheets/cn_zh.png          A4 @150dpi, 1240x1754
 *   fixtures/sheets/cn_zh_photo.jpg    bad phone photo of cn_zh.png, 1100x1500, q70
 *   fixtures/sheets/not_a_sheet.jpg    restaurant menu (negative fixture), 1100x1500, q70
 *   public/icons/icon-192.png          app icon from public/icons/icon.svg
 *   public/icons/icon-512.png
 *
 * Browser: prefers Playwright's bundled chromium; falls back to a local
 * Google Chrome install so no browser download is needed.
 */
import { chromium, type Browser } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ICONS = path.join(ROOT, 'public', 'icons');

const A4 = { width: 1240, height: 1754 }; // A4 at 150 dpi
const PHOTO = { width: 1100, height: 1500 };

const CHROME_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Browser order. A local Google Chrome is preferred, with Playwright's bundled
 * chromium as the fallback, because the browser cache on this machine holds
 * chromium build 1223 while playwright-core 1.62.1 wants build 1234 — so
 * `chromium.launch()` fails immediately ("Executable doesn't exist ... run
 * npx playwright install"). Chrome renders these fixtures with no download.
 * Once `npx playwright install chromium` has been run, the bundled browser
 * works too and the fallback below picks it up; either order is fine, since
 * a wrong first choice costs milliseconds.
 */
async function launch(): Promise<{ browser: Browser; how: string }> {
  const attempts: Array<[string, () => Promise<Browser>]> = [];
  if (existsSync(CHROME_MAC)) {
    attempts.push([
      'local Google Chrome (executablePath)',
      () => chromium.launch({ executablePath: CHROME_MAC, timeout: 30_000 }),
    ]);
  }
  attempts.push(["channel: 'chrome'", () => chromium.launch({ channel: 'chrome', timeout: 30_000 })]);
  attempts.push(['playwright bundled chromium', () => chromium.launch({ timeout: 30_000 })]);

  const errors: string[] = [];
  for (const [how, run] of attempts) {
    try {
      const browser = await run();
      return { browser, how };
    } catch (err) {
      errors.push(`  - ${how}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(
    'No usable browser. Tried:\n' +
      errors.join('\n') +
      '\nRun `npx playwright install chromium` or install Google Chrome.',
  );
}

function report(file: string) {
  const size = statSync(file).size;
  console.log(`  ${path.relative(ROOT, file).padEnd(34)} ${dims(file).padEnd(11)} ${(size / 1024).toFixed(0)} KB`);
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
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`;
      }
      i += 2 + len;
    }
  }
  return '?';
}

async function main() {
  const { browser, how } = await launch();
  console.log(`browser: ${how}\n`);

  // --- 1. the two clean sheets ------------------------------------------------
  for (const name of ['hk_en', 'cn_zh']) {
    const page = await browser.newPage({ viewport: A4, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(HERE, `${name}.html`)).href, {
      waitUntil: 'networkidle',
    });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(HERE, `${name}.png`);
    await page.screenshot({ path: out, type: 'png', omitBackground: false });

    if (name === 'cn_zh') {
      // Geometry of the numbered 出院医嘱 lines, so photo.html can put the thumb
      // on line 8 only. Logged for maintenance; photo.html hard-codes the result.
      const rects = await page.evaluate(() => {
        const lines = Array.from(
          document.querySelectorAll('.sec.orders .ln'),
        ) as HTMLElement[];
        return lines.map((el, i) => {
          const r = el.getBoundingClientRect();
          return { i, top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) };
        });
      });
      console.log('  出院医嘱 line boxes (0-based, page px):');
      for (const r of rects) console.log(`    [${r.i}] top ${r.top} bottom ${r.bottom} right ${r.right}`);
    }
    await page.close();
    report(out);
  }

  // --- 2. the bad phone photo + the negative fixture ---------------------------
  for (const [src, out] of [
    ['photo.html', 'cn_zh_photo.jpg'],
    ['menu.html', 'not_a_sheet.jpg'],
  ] as const) {
    const page = await browser.newPage({ viewport: PHOTO, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(HERE, src)).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(HERE, out);
    await page.screenshot({ path: file, type: 'jpeg', quality: 70 });
    await page.close();
    report(file);
  }

  // --- 3. app icons from public/icons/icon.svg --------------------------------
  const svg = readFileSync(path.join(ICONS, 'icon.svg'), 'utf8');
  for (const size of [192, 512]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
       svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      { waitUntil: 'load' },
    );
    const file = path.join(ICONS, `icon-${size}.png`);
    await page.screenshot({ path: file, type: 'png', omitBackground: false });
    await page.close();
    report(file);
  }

  await browser.close();
  console.log('\ndone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
