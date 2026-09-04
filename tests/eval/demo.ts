/**
 * The demo runner (T-demo) — does the reader actually read the sheets we will project?
 *
 *   # both checks, one live read per sheet
 *   env -u NODE_OPTIONS ./node_modules/.bin/tsx tests/eval/demo.ts --model claude-opus-5 --runs 1
 *
 *   # answer keys and images only, no model, no key needed
 *   env -u NODE_OPTIONS ./node_modules/.bin/tsx tests/eval/demo.ts --offline
 *
 * `reading.ts` scores the clean fixtures and `stress.ts` the deliberately hard ones. This one
 * scores the three DEMO sheets in `fixtures/demo/` against `fixtures/demo/*.expected.json`, an
 * answer key written from the HTML that produced each image and never from a model reply.
 *
 * It exists because a demo asset is only an asset if the reader gets it right on stage, and each
 * of these three sheets is on stage to show one specific thing. So beyond the ordinary
 * `diffReading` scoring it asks the three questions the demo actually rests on:
 *
 *   1. MULTI-PAGE — `hk_stack` is two images sent as one document, medicines on page 1 and both
 *      appointment dates on page 2. Every follow-up in the answer key must come back, which can
 *      only happen if page 2 was read. This is the six-page-capture argument, measured.
 *   2. STOPPED — every medicine the page prints under "not to be taken after discharge" must come
 *      back with `status` other than "current", and must not appear in the plan `draftPlan`
 *      drafts. A withdrawn drug scheduled as a dose is the worst failure this app has.
 *   3. UNCOUNTABLE — a frequency that states an interval or a ceiling ("每4小时一次，每日不超过4次")
 *      must be REFUSED by `timesPerDay`, so the card shows the printed clause and no number. A
 *      count invented from a ceiling would tell a family to take doses the page never asked for.
 *
 * Privacy: the sheets are synthetic, but the console still prints ids, counts and timings, plus
 * the offending strings when something is wrong — which is the only way a wrong sheet gets fixed.
 * `--dump <dir>` writes whole returned readings to local files and is opt-in.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SheetReadingSchema, type Medicine, type SheetReading } from "../../lib/domain/schemas";
import { doseTargets, timesPerDay } from "../../lib/rules/doses";
import { draftPlan } from "../../lib/rules/plan-from-reading";
import { diffReading, scanBanned, type ReadingDiff } from "./diff";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const DEMO_DIR = join(REPO_ROOT, "fixtures", "demo");

/** A whole read, including one server-side retry, must fit inside this. */
const REQUEST_TIMEOUT_MS = 240_000;

/* -------------------------------------------------------------------------- */
/* The three demo sheets                                                      */
/* -------------------------------------------------------------------------- */

interface DemoSheet {
  id: string;
  /** Page images in page order. More than one means they are read as a single document. */
  pages: string[];
  /** The HTML each page was typeset from, in the same order, for the verbatim-quote check. */
  html: string[];
  expected: string;
  /** What this sheet is on stage to prove. Printed with the result. */
  shows: string;
  /**
   * Printed frequency clauses `timesPerDay` must refuse — an interval, a ceiling, a range. Each
   * entry names the medicine and the clause exactly as the answer key prints it.
   */
  uncountable: Array<{ name: string; frequency: string }>;
}

const SHEETS: DemoSheet[] = [
  {
    id: "hk_stack",
    pages: ["hk_stack_page1.png", "hk_stack_page2.png"],
    html: ["hk_stack_page1.html", "hk_stack_page2.html"],
    expected: "hk_stack.expected.json",
    shows: "medicines on page 1, both appointment dates on page 2 — why multi-page capture exists",
    uncountable: [],
  },
  {
    id: "hk_stopped",
    pages: ["hk_stopped.png"],
    html: ["hk_stopped.html"],
    expected: "hk_stopped.expected.json",
    shows: "a 'not to be taken after discharge' block styled like every other block",
    uncountable: [],
  },
  {
    id: "cn_zh_clinic",
    pages: ["cn_zh_clinic.png"],
    html: ["cn_zh_clinic.html"],
    expected: "cn_zh_clinic.expected.json",
    shows: "a mainland 出院指导单 whose row 5 frequency the dose counter must refuse to count",
    uncountable: [
      { name: "对乙酰氨基酚片", frequency: "疼痛时口服，每4小时一次，每日不超过4次" },
    ],
  },
];

function loadExpected(sheet: DemoSheet): SheetReading {
  const raw: unknown = JSON.parse(readFileSync(join(DEMO_DIR, sheet.expected), "utf8"));
  const parsed = SheetReadingSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
      .join(" | ");
    throw new Error(`${sheet.expected} is not a valid SheetReading — ${where}`);
  }
  return parsed.data;
}

/* -------------------------------------------------------------------------- */
/* Offline checks: the answer keys and the images, with no model in the loop   */
/* -------------------------------------------------------------------------- */

/**
 * The printed text of an HTML page, near enough for a containment test: tags become spaces so
 * table cells do not run together, and the handful of entities these fixtures use are decoded.
 */
function printedText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/&middot;/g, "·")
    .replace(/&sup2;/g, "²")
    .replace(/&micro;/g, "µ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Whitespace is dropped from both sides before comparing.
 *
 * A quote off a ruled table row ("1 Frusemide 20mg 1 tab Daily 28 days") is assembled from six
 * cells, and a quote off a bilingual line has an inline span in the middle of it, so the spacing
 * in the HTML source and the spacing a reader sees are not the same string. What this check is
 * for is the mistake that matters — an answer key quoting words the page does not print.
 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, "");
}

function everyQuote(reading: SheetReading): string[] {
  const quotes: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.quote === "string" && record.quote.length > 0) quotes.push(record.quote);
    Object.values(record).forEach(walk);
  };
  walk(reading);
  return [...new Set(quotes)];
}

/** width x height straight out of the PNG IHDR. */
function pngDims(file: string): [number, number] | null {
  const b = readFileSync(file);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  return null;
}

interface OfflineResult {
  id: string;
  problems: string[];
  quotes: number;
  speakables: number;
}

function checkOffline(sheet: DemoSheet, expected: SheetReading): OfflineResult {
  const problems: string[] = [];

  // 1. every image exists at A4 150dpi and carries enough ink to be a rendered sheet
  for (const page of sheet.pages) {
    const file = join(DEMO_DIR, page);
    if (!existsSync(file)) {
      problems.push(`${page} is missing — run fixtures/demo/render.ts`);
      continue;
    }
    const dims = pngDims(file);
    const bytes = statSync(file).size;
    if (!dims || dims[0] !== 1240 || dims[1] !== 1754) {
      problems.push(`${page} is ${dims ? dims.join("x") : "not a PNG"}, want 1240x1754`);
    }
    if (bytes < 40_000) problems.push(`${page} is only ${(bytes / 1024).toFixed(0)} KB — is it blank?`);
  }

  // 2. the synthetic stamp is on every page, in both languages
  for (const page of sheet.html) {
    const html = readFileSync(join(DEMO_DIR, page), "utf8");
    const text = printedText(html);
    if (!text.includes("SYNTHETIC — NOT A REAL MEDICAL RECORD")) {
      problems.push(`${page} does not print the English synthetic stamp`);
    }
    if (!/合成樣張，非真實病歷|合成样张，非真实病历/.test(text)) {
      problems.push(`${page} does not print the Chinese synthetic stamp`);
    }
  }

  // 3. every quote in the answer key is text the page actually prints
  const pages = sheet.html.map((file) => squeeze(printedText(readFileSync(join(DEMO_DIR, file), "utf8"))));
  const quotes = everyQuote(expected);
  for (const quote of quotes) {
    if (!pages.some((page) => page.includes(squeeze(quote)))) {
      problems.push(`quote not printed on any page: "${quote.slice(0, 72)}"`);
    }
  }

  // 4. nothing the app would say aloud carries a banned term
  const banned = scanBanned(expected, []);
  for (const [i, term] of banned.terms.entries()) {
    problems.push(`banned term "${term}" at ${banned.where[i] ?? "?"}`);
  }

  // 5. the sheet's uncountable clauses are in the answer key AND are refused
  for (const { name, frequency } of sheet.uncountable) {
    const medicine = expected.medicines.find((m) => m.name === name);
    if (!medicine) {
      problems.push(`answer key has no medicine named "${name}" to carry the uncountable clause`);
      continue;
    }
    if (medicine.frequency !== frequency) {
      problems.push(`"${name}" frequency is "${medicine.frequency}", expected "${frequency}"`);
    }
    const parsed = timesPerDay(frequency);
    if (parsed.total !== 0 || parsed.asNeeded) {
      problems.push(
        `timesPerDay counted "${frequency}" as ${parsed.total}${parsed.asNeeded ? " as-needed" : ""} — the demo needs it refused`,
      );
    }
  }

  return { id: sheet.id, problems, quotes: quotes.length, speakables: countSpeakables(expected) };
}

function countSpeakables(reading: SheetReading): number {
  return (
    reading.warningSigns.length * 2 +
    reading.medicines.length +
    reading.followUp.length +
    (reading.dietLine ? 1 : 0) +
    (reading.activityLine ? 1 : 0) +
    (reading.hospitalContact ? 1 : 0)
  );
}

/* -------------------------------------------------------------------------- */
/* Live scoring                                                               */
/* -------------------------------------------------------------------------- */

/** Folds width, case and whitespace. For MATCHING only, never for scoring a field. */
function loose(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function statusOf(medicine: Medicine): string {
  const value = medicine.status;
  return typeof value === "string" && value.length > 0 ? value : "current";
}

/** Matches a returned medicine to an expected one by drug name, so a dropped row costs one miss. */
function findByName(returned: readonly Medicine[], name: string): Medicine | undefined {
  const want = loose(name);
  return (
    returned.find((m) => loose(m.name) === want) ??
    returned.find((m) => loose(m.name).includes(want) || want.includes(loose(m.name)))
  );
}

interface LiveScore {
  /** The repo's own scorer, index-aligned, the same one `reading.ts` uses. */
  diff: ReadingDiff;
  medicinesExpected: number;
  medicinesReturned: number;
  missing: string[];
  invented: string[];
  /** `status` of every medicine the page prints as stopped, as it came back. */
  stopped: Array<{ name: string; status: string }>;
  /** A stopped drug returned as "current", or one that reached the drafted plan. Never acceptable. */
  dangerous: string[];
  /** Follow-ups in the answer key whose `when` did not come back at all. */
  followUpMissing: string[];
  /** Frequency clauses that had to be refused, and what `timesPerDay` did with what came back. */
  counted: Array<{ name: string; frequency: string; total: number; asNeeded: boolean; ok: boolean }>;
  bannedHits: number;
  bannedTerms: string[];
  ms: number;
}

function score(expected: SheetReading, actual: SheetReading, sheet: DemoSheet, ms: number): LiveScore {
  const missing: string[] = [];
  const stopped: Array<{ name: string; status: string }> = [];
  const dangerous: string[] = [];
  const matched = new Set<Medicine>();

  for (const want of expected.medicines) {
    const got = findByName(actual.medicines, want.name);
    if (!got) {
      missing.push(`${want.name} ${want.strength ?? ""}`.trim());
      continue;
    }
    matched.add(got);
    const wantStatus = want.status;
    const gotStatus = statusOf(got);
    if (wantStatus !== "current") {
      stopped.push({ name: want.name, status: gotStatus });
      if (gotStatus === "current") {
        dangerous.push(
          `"${want.name}" is printed under a stopped heading but came back status "current"`,
        );
      }
    } else if (gotStatus !== "current") {
      dangerous.push(
        `"${want.name}" is on the discharge list but came back status "${gotStatus}" — it would be dropped from the plan`,
      );
    }
  }
  const invented = actual.medicines
    .filter((m) => !matched.has(m))
    .map((m) => `${m.name} ${m.strength ?? ""}`.trim());

  // A stopped drug must also never reach the plan the rules draft from this reading.
  const dosesPlanned = draftPlan(actual)
    .items.filter((item) => item.kind === "medicineTime")
    .map((item) => loose(item.label));
  for (const want of expected.medicines) {
    if (want.status === "current") continue;
    if (dosesPlanned.some((label) => label.includes(loose(want.name)))) {
      dangerous.push(`"${want.name}" is printed as stopped but appears in the drafted plan`);
    }
  }
  // Belt and braces: whatever the plan holds, no target built off a stopped medicine may carry a
  // count or a taken button.
  for (const target of doseTargets(actual)) {
    if (!target.stopped) continue;
    if (target.total > 0 || target.asNeeded) {
      dangerous.push(`stopped target "${target.name}" carries a counter (${target.total})`);
    }
  }

  const followUpMissing = expected.followUp
    .filter((want) => {
      const key = loose(want.when);
      if (key.length === 0) return false;
      return !actual.followUp.some(
        (got) => loose(got.when).includes(key) || key.includes(loose(got.when)),
      );
    })
    .map((want) => `${want.clinic ?? "?"} @ ${want.when ?? "?"}`);

  const counted = sheet.uncountable.map(({ name, frequency }) => {
    const got = findByName(actual.medicines, name);
    const parsed = timesPerDay(got?.frequency ?? frequency);
    return {
      name,
      frequency: got?.frequency ?? "(medicine not returned)",
      total: parsed.total,
      asNeeded: parsed.asNeeded,
      ok: parsed.total === 0 && !parsed.asNeeded,
    };
  });

  const banned = scanBanned(actual, []);
  return {
    diff: diffReading(expected, actual),
    medicinesExpected: expected.medicines.length,
    medicinesReturned: actual.medicines.length,
    missing,
    invented,
    stopped,
    dangerous,
    followUpMissing,
    counted,
    bannedHits: banned.hits,
    bannedTerms: banned.terms,
    ms,
  };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function flag(argv: string[], name: string): string | undefined {
  const i = argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  const arg = argv[i];
  return arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[i + 1];
}

function has(argv: string[], name: string): boolean {
  return argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
}

/** `.env.local` is not loaded for a plain `tsx` run, and the live read needs the API key. */
function loadEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(join(REPO_ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

interface Reader {
  readSheet(images: Array<{ mediaType: "image/png" | "image/jpeg"; base64: string }>): Promise<{
    reading: SheetReading;
    usage: { ms: number; inputTokens: number; outputTokens: number; model: string };
  }>;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const offline = has(argv, "offline");
  const model = flag(argv, "model") ?? "claude-opus-5";
  const runs = Number(flag(argv, "runs") ?? 1);
  const dump = flag(argv, "dump");
  const wanted = (flag(argv, "sheets") ?? "all").trim();
  const sheets = wanted === "all" ? SHEETS : SHEETS.filter((s) => wanted.split(",").includes(s.id));
  if (sheets.length === 0) {
    console.error(`Unknown sheet(s): ${wanted}. Known: ${SHEETS.map((s) => s.id).join(", ")}, or "all".`);
    process.exit(2);
  }
  if (dump) mkdirSync(dump, { recursive: true });

  console.log("");
  console.log(`Demo sheets — ${sheets.length} sheet(s), ${offline ? "offline only" : `${runs} live run(s) on ${model}`}`);
  console.log("");

  // ---- offline -------------------------------------------------------------
  const expectations = new Map<string, SheetReading>();
  let failures = 0;
  for (const sheet of sheets) {
    const expected = loadExpected(sheet);
    expectations.set(sheet.id, expected);
    const result = checkOffline(sheet, expected);
    const ok = result.problems.length === 0;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${sheet.id.padEnd(13)} ${sheet.pages.length} page(s), ` +
        `${expected.medicines.length} medicines, ${expected.followUp.length} follow-up(s), ` +
        `${result.quotes} quotes, ${result.speakables * 3} spoken strings`,
    );
    for (const problem of result.problems) console.log(`        - ${problem}`);
  }
  if (offline) {
    console.log("");
    console.log(failures === 0 ? "offline checks: all pass." : `offline checks: ${failures} sheet(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  }

  // ---- live ----------------------------------------------------------------
  loadEnvLocal();
  const { GatewayProvider } = await import("@/lib/model/client");
  const reader = new GatewayProvider({ modelRead: model }) as Reader;

  let liveFailures = 0;
  for (const sheet of sheets) {
    const expected = expectations.get(sheet.id) as SheetReading;
    const images = sheet.pages.map((page) => ({
      mediaType: "image/png" as const,
      base64: readFileSync(join(DEMO_DIR, page)).toString("base64"),
    }));

    for (let run = 1; run <= runs; run += 1) {
      const startedAt = Date.now();
      let actual: SheetReading | null = null;
      let error: string | null = null;
      try {
        const result = await Promise.race([
          reader.readSheet(images),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), REQUEST_TIMEOUT_MS),
          ),
        ]);
        actual = result.reading;
      } catch (caught) {
        const err = caught as { code?: string; message?: string };
        error = `${err.code ?? "error"}: ${(err.message ?? "").slice(0, 140)}`;
      }
      const ms = Date.now() - startedAt;

      console.log("");
      console.log(`── ${sheet.id}  run ${run}/${runs}  ${(ms / 1000).toFixed(1)}s`);
      console.log(`   shows: ${sheet.shows}`);
      if (!actual) {
        liveFailures += 1;
        console.log(`   READ FAILED — ${error}`);
        continue;
      }
      if (dump) {
        writeFileSync(
          join(dump, `${sheet.id}.${run}.json`),
          JSON.stringify(actual, null, 2),
          "utf8",
        );
      }

      const s = score(expected, actual, sheet, ms);
      const line = (label: string, ok: boolean, detail: string): void => {
        console.log(`   ${ok ? "ok  " : "FAIL"} ${label.padEnd(22)} ${detail}`);
      };

      line("sheetType", s.diff.sheetTypeOk, `${actual.sheetType} (want ${expected.sheetType})`);
      line(
        "medicines",
        s.missing.length === 0 && s.invented.length === 0,
        `${s.medicinesReturned}/${s.medicinesExpected} found` +
          (s.missing.length > 0 ? `, MISSING ${s.missing.join(", ")}` : "") +
          (s.invented.length > 0 ? `, INVENTED ${s.invented.join(", ")}` : ""),
      );
      line(
        "medicine fields",
        s.diff.medicines.mismatches.length === 0,
        s.diff.medicines.mismatches.length === 0
          ? "every field verbatim"
          : `${s.diff.medicines.mismatches.length} not verbatim`,
      );
      for (const miss of s.diff.medicines.mismatches) {
        console.log(`          [${miss.index}].${miss.field}: want "${miss.expected}" got "${miss.actual}"`);
      }
      if (s.stopped.length > 0) {
        line(
          "stopped medicines",
          s.stopped.every((m) => m.status !== "current"),
          s.stopped.map((m) => `${m.name} → ${m.status}`).join(", "),
        );
      }
      line(
        "dangerous",
        s.dangerous.length === 0,
        s.dangerous.length === 0 ? "none" : s.dangerous.join(" | "),
      );
      line(
        "followUp",
        s.followUpMissing.length === 0 && s.diff.followUp.ok,
        `${actual.followUp.length}/${expected.followUp.length} found` +
          (s.followUpMissing.length > 0 ? `, NOT FOUND ${s.followUpMissing.join("; ")}` : "") +
          (s.diff.followUp.mismatches.length > 0
            ? `, ${s.diff.followUp.mismatches.map((m) => `[${m.index}].${m.field} want "${m.expected}" got "${m.actual}"`).join("; ")}`
            : ""),
      );
      // Count matters as much as coverage: one card carrying three symptoms is not three cards,
      // and the app reads warnings out one at a time.
      line(
        "warnings",
        s.diff.warningSigns.countOk && s.diff.warningSigns.coverage === 1,
        `${s.diff.warningSigns.returnedCount}/${s.diff.warningSigns.expectedCount} returned, quote coverage ${pct(s.diff.warningSigns.coverage)}`,
      );
      line(
        "diet / activity",
        s.diff.dietLine.ok,
        `diet ${s.diff.dietLine.ok ? "verbatim" : `raw "${actual.dietLine?.raw ?? "(none)"}"`}` +
          `, type ${s.diff.dietLine.actualType ?? "none"}` +
          `, activity ${actual.activityLine?.text === expected.activityLine?.text ? "verbatim" : `"${actual.activityLine?.text ?? "(none)"}"`}`,
      );
      for (const { name, frequency, total, asNeeded, ok } of s.counted) {
        line(
          "uncountable refused",
          ok,
          `${name} "${frequency}" → ${ok ? "no number (correct)" : `total ${total}${asNeeded ? " as-needed" : ""}`}`,
        );
      }
      line("banned terms", s.bannedHits === 0, s.bannedHits === 0 ? "0" : s.bannedTerms.join(", "));
      if (actual.unreadable.length > 0) {
        console.log(`        unreadable: ${actual.unreadable.map((u) => `${u.section}/${u.field ?? "-"}`).join(", ")}`);
      }

      const demoOk =
        s.diff.sheetTypeOk &&
        s.missing.length === 0 &&
        s.invented.length === 0 &&
        s.dangerous.length === 0 &&
        s.followUpMissing.length === 0 &&
        s.diff.warningSigns.countOk &&
        s.diff.warningSigns.coverage === 1 &&
        s.counted.every((c) => c.ok) &&
        s.bannedHits === 0;
      if (!demoOk) liveFailures += 1;
      console.log(`   ${demoOk ? "DEMO-SAFE" : "NOT DEMO-SAFE"} — strict diff ${s.diff.ok ? "clean" : "has misses"}`);
    }
  }

  console.log("");
  console.log(
    liveFailures === 0
      ? "every demo sheet read correctly."
      : `${liveFailures} run(s) were not demo-safe — see above.`,
  );
  console.log(`fixtures: ${relative(REPO_ROOT, DEMO_DIR)}`);
  process.exit(failures === 0 && liveFailures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
