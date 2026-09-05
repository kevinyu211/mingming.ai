/**
 * The reading test runner (T031, research.md R1, provider_shortlist.md section 5).
 *
 *   npm run eval -- --sheets all --runs 5 --model claude-opus-5
 *   NODE_OPTIONS=--use-openssl-ca tsx tests/eval/reading.ts \
 *     --sheets hk_en,cn_zh --runs 2 --model claude-sonnet-5 --base http://localhost:3000
 *
 * Posts each fixture image to a running server's `/api/read`, consumes the NDJSON stream, and
 * diffs the returned reading field by field against `fixtures/sheets/<id>.expected.json` using
 * `tests/eval/diff.ts`. It records time to the first `card` event and to `done`, the `filter`
 * counts, and every banned-term hit that survived filtering.
 *
 * It decides two things and nothing else:
 *   SC-002 — zero invented medicines, zero missing medicines, every medicine field verbatim.
 *   SC-003 — zero banned terms after filtering.
 * Cantonese naturalness and the model PICK are human judgements and stay in `tests/eval/reading.md`.
 *
 * `--model` is a LABEL, not a switch. The server chooses its own model from `MODEL_READ`, and
 * `/api/read` does not report which one it used, so the runner records what you say you ran and
 * prints the restart line you need for the other half of the comparison.
 *
 * Privacy: the fixtures are synthetic, but the runner still prints no card body and no reading —
 * only ids, counts and timings. The full detail goes to `tests/eval/results.md`, which is local.
 */

import { readFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Card, SheetReading, StoredReading } from "../../lib/domain/schemas";
import {
  READ_PROCESSING_TIMEOUT_MS,
  READ_RESPONSE_GRACE_MS,
  READ_SUBMISSION_TIMEOUT_MS,
} from "../../lib/domain/read-policy";
import { validateReadingCards } from "../../lib/sheets/cards";
import {
  RESULTS_HEADER,
  RESULTS_MARKER,
  diffReading,
  sc002,
  sc003,
  scanBanned,
  summarise,
  type RunRecord,
  type SummaryRow,
} from "./diff";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURE_DIR = join(REPO_ROOT, "fixtures", "sheets");
const RESULTS_FILE = join(HERE, "results.md");
const READING_FILE = join(HERE, "reading.md");

/** Runs are inserted here, newest first, so the PICK line stays the last line of the file. */
const READING_RUNS_MARKER = "<!-- tests/eval/reading.ts appends run lines below this line. -->";

/** A whole read, including submission, processing, response grace and one server-side retry. */
const REQUEST_TIMEOUT_MS =
  READ_SUBMISSION_TIMEOUT_MS + READ_PROCESSING_TIMEOUT_MS + READ_RESPONSE_GRACE_MS;

interface Fixture {
  id: string;
  file: string;
  mediaType: "image/png" | "image/jpeg";
}

const FIXTURES: Fixture[] = [
  { id: "hk_en", file: "hk_en.png", mediaType: "image/png" },
  { id: "cn_zh", file: "cn_zh.png", mediaType: "image/png" },
  { id: "cn_zh_photo", file: "cn_zh_photo.jpg", mediaType: "image/jpeg" },
];

interface Options {
  sheets: Fixture[];
  runs: number;
  model: string;
  base: string;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

/** Accepts both `--flag value` and `--flag=value`, like the other eval runners. */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  const arg = argv[i];
  return arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[i + 1];
}

function parseOptions(argv: string[]): Options {
  const sheetsArg = flag(argv, "sheets") ?? "all";
  let sheets: Fixture[];
  if (sheetsArg === "all") {
    sheets = [...FIXTURES];
  } else {
    const wanted = sheetsArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = wanted.filter((id) => !FIXTURES.some((f) => f.id === id));
    if (unknown.length > 0) {
      console.error(
        `Unknown sheet(s): ${unknown.join(", ")}. Known: ${FIXTURES.map((f) => f.id).join(", ")}, or "all".`,
      );
      process.exit(2);
    }
    sheets = wanted.map((id) => FIXTURES.find((f) => f.id === id) as Fixture);
  }

  const runs = Number(flag(argv, "runs") ?? 5);
  if (!Number.isInteger(runs) || runs < 1) {
    console.error(`--runs must be a positive integer, got "${flag(argv, "runs")}".`);
    process.exit(2);
  }

  const base = (flag(argv, "base") ?? "http://localhost:3000").replace(/\/+$/, "");
  return { sheets, runs, model: flag(argv, "model") ?? "(unrecorded)", base };
}

/* -------------------------------------------------------------------------- */
/* One read                                                                   */
/* -------------------------------------------------------------------------- */

interface ReadOutcome {
  cards: Card[];
  reading: StoredReading | null;
  regenerated: number;
  templated: number;
  msToAccepted: number | null;
  msToFirstCard: number | null;
  msToDone: number | null;
  error: string | null;
}

interface ReadEventShape {
  event?: string;
  phase?: string;
  card?: Card;
  reading?: StoredReading;
  filter?: { regenerated?: number; templated?: number };
  error?: string;
}

/**
 * Posts one image and consumes the NDJSON stream to its end.
 *
 * Timing starts before `fetch` — SC-001 is measured from the shutter, so network setup counts.
 * A non-200, an `unknown` event (FR-006: the server declined the page) and an in-stream `error`
 * line all resolve as a recorded failure rather than throwing: one bad run should not abandon the
 * other 33.
 */
async function readOnce(base: string, fixture: Fixture, base64: string): Promise<ReadOutcome> {
  const out: ReadOutcome = {
    cards: [],
    reading: null,
    regenerated: 0,
    templated: 0,
    msToAccepted: null,
    msToFirstCard: null,
    msToDone: null,
    error: null,
  };
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${base}/api/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [{ mediaType: fixture.mediaType, base64 }] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    out.error = `request failed: ${(error as Error).message.split("\n")[0].slice(0, 120)}`;
    return out;
  }

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    let code = `http ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) code = `${code} ${parsed.error}`;
    } catch {
      // A non-JSON error body says nothing useful; the status is the finding.
    }
    out.error = code;
    return out;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  const handle = (line: string): void => {
    if (line.trim().length === 0) return;
    let event: ReadEventShape;
    try {
      event = JSON.parse(line) as ReadEventShape;
    } catch {
      out.error = out.error ?? "malformed ndjson line";
      return;
    }
    switch (event.event) {
      case "status":
        if (event.phase === "reading" && out.msToAccepted === null) {
          out.msToAccepted = Date.now() - startedAt;
        }
        break;
      case "card":
        if (out.msToFirstCard === null) out.msToFirstCard = Date.now() - startedAt;
        if (event.card) out.cards.push(event.card);
        break;
      case "done":
        out.msToDone = Date.now() - startedAt;
        out.reading = event.reading ?? null;
        out.regenerated = event.filter?.regenerated ?? 0;
        out.templated = event.filter?.templated ?? 0;
        break;
      case "unknown":
        out.error = out.error ?? "declined: sheetType unknown";
        break;
      case "error":
        out.error = out.error ?? `stream error: ${event.error ?? "unknown"}`;
        break;
      default:
        // `status` heartbeats carry a character count and nothing to record.
        break;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
    handle(buffered);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    out.error = out.error ?? `stream failed: ${detail.slice(0, 120)}`;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A broken response may already have released the reader.
    }
  }

  if (!out.reading && !out.error) out.error = "stream ended without a done event";
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function ms(value: number | null): string {
  return value === null ? "-" : `${(value / 1000).toFixed(1)}s`;
}

const COLUMNS = [
  "sheet",
  "runs",
  "ok",
  "exact meds",
  "invented",
  "missing",
  "warnings",
  "diet",
  "unread.",
  "banned",
  "p50 card",
  "p95 card",
  "p50 done",
  "p95 done",
] as const;

function cells(row: SummaryRow): string[] {
  return [
    row.sheet,
    String(row.runs),
    String(row.ok),
    pct(row.exactMedicineRate),
    String(row.invented),
    String(row.missing),
    pct(row.warningCoverage),
    `${row.dietOk}/${row.ok}`,
    `${row.unreadableOk}/${row.ok}`,
    String(row.bannedHits),
    ms(row.p50FirstCard),
    ms(row.p95FirstCard),
    ms(row.p50Done),
    ms(row.p95Done),
  ];
}

function printTable(rows: SummaryRow[]): void {
  const body = rows.map(cells);
  const widths = COLUMNS.map((header, i) =>
    Math.max(header.length, ...body.map((cell) => cell[i].length)),
  );
  const line = (values: readonly string[]): string =>
    values.map((value, i) => value.padEnd(widths[i])).join(" | ");
  console.log("");
  console.log(line(COLUMNS));
  console.log("-".repeat(widths.reduce((sum, w) => sum + w + 3, -3)));
  for (const cell of body) console.log(line(cell));
  console.log("");
}

function markdownTable(rows: SummaryRow[]): string[] {
  return [
    `| ${COLUMNS.join(" | ")} |`,
    `| ${COLUMNS.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${cells(row).join(" | ")} |`),
  ];
}

/** Every mismatch and every failure, so a fail is actionable without re-running. */
function findings(records: readonly RunRecord[]): string[] {
  const lines: string[] = [];
  for (const record of records) {
    const label = `${record.sheet} run ${record.run}`;
    if (record.error) lines.push(`- ${label}: FAILED — ${record.error}`);
    const diff = record.diff;
    if (diff) {
      if (!diff.sheetTypeOk) lines.push(`- ${label}: sheetType differs from the fixture`);
      for (const m of diff.medicines.mismatches) {
        lines.push(
          `- ${label}: medicine ${m.index} ${m.field} expected "${m.expected}", got "${m.actual}"`,
        );
      }
      if (diff.medicines.invented > 0) {
        lines.push(`- ${label}: ${diff.medicines.invented} invented medicine(s)`);
      }
      if (diff.medicines.missing > 0) {
        lines.push(`- ${label}: ${diff.medicines.missing} missing medicine(s)`);
      }
      for (const quote of diff.warningSigns.missingQuotes) {
        lines.push(`- ${label}: warning-sign quote not returned — "${quote}"`);
      }
      if (!diff.warningSigns.countOk) {
        lines.push(
          `- ${label}: ${diff.warningSigns.returnedCount} warning sign(s), expected ${diff.warningSigns.expectedCount}`,
        );
      }
      for (const m of diff.followUp.mismatches) {
        lines.push(
          `- ${label}: followUp ${m.index} ${m.field} expected "${m.expected}", got "${m.actual}"`,
        );
      }
      if (!diff.dietLine.ok) {
        lines.push(
          `- ${label}: diet line raw ${diff.dietLine.rawOk ? "ok" : "differs"}, recognisedType expected ${diff.dietLine.expectedType}, got ${diff.dietLine.actualType}`,
        );
      }
      if (!diff.unreadable.ok) {
        lines.push(
          `- ${label}: ${diff.unreadable.returnedCount} unreadable flag(s), expected at least ${diff.unreadable.expectedCount}`,
        );
      }
    }
    for (const where of record.banned?.where ?? []) {
      lines.push(`- ${label}: BANNED TERM in ${where}`);
    }
  }
  return lines.length > 0 ? lines : ["- none"];
}

/**
 * Inserts a block just below the marker, so runs read newest-first and the file still ends with
 * its PICK line. Falls back to inserting above a trailing `PICK:` line when no marker exists
 * (`reading.md` belongs to T020 and is not edited by hand for this), and to an append otherwise.
 */
async function insertRun(file: string, marker: string, block: string): Promise<void> {
  const existing = await readFile(file, "utf8").catch(() => "");
  if (existing.includes(marker)) {
    await writeFile(file, existing.replace(marker, `${marker}\n${block}`), "utf8");
    return;
  }
  const lines = existing.split("\n");
  const pickAt = lines.findLastIndex((line) => line.startsWith("PICK:"));
  if (pickAt !== -1) {
    // Step back over the `---` rule and the blank line that separate PICK from the body.
    let at = pickAt;
    while (at > 0 && (lines[at - 1].trim() === "" || lines[at - 1].trim() === "---")) at -= 1;
    lines.splice(at, 0, ...block.split("\n"));
    await writeFile(file, lines.join("\n"), "utf8");
    return;
  }
  await appendFile(file, block, "utf8");
}

async function ensureResultsFile(): Promise<void> {
  const existing = await readFile(RESULTS_FILE, "utf8").catch(() => null);
  if (existing === null) await writeFile(RESULTS_FILE, RESULTS_HEADER, "utf8");
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  console.log("");
  console.log(`Reading eval — ${options.sheets.length} sheet(s) x ${options.runs} run(s)`);
  console.log(`Server: ${options.base}`);
  console.log(`Model label: ${options.model}`);
  console.log(
    `The server picks its own model. To compare models, restart it with MODEL_READ=${options.model} ` +
      "and pass the same --model label here.",
  );
  console.log("");

  const records: RunRecord[] = [];
  const timingLines: string[] = [];

  for (const fixture of options.sheets) {
    const expected = JSON.parse(
      readFileSync(join(FIXTURE_DIR, `${fixture.id}.expected.json`), "utf8"),
    ) as SheetReading;
    const base64 = readFileSync(join(FIXTURE_DIR, fixture.file)).toString("base64");

    for (let run = 1; run <= options.runs; run += 1) {
      const outcome = await readOnce(options.base, fixture, base64);
      const reading = outcome.reading;
      // The final card stream is authoritative. Missing or mismatched cards are a failed run;
      // rebuilding them locally would hide a truncated response and lose pipeline flags.
      const cards = reading ? validateReadingCards(reading, outcome.cards) : null;
      const cardError = reading !== null && cards === null ? "invalid canonical card set" : null;
      const error = outcome.error ?? cardError;
      const record: RunRecord = {
        sheet: fixture.id,
        run,
        ok: reading !== null && error === null,
        error,
        diff: reading ? diffReading(expected, reading) : null,
        banned: reading && cards ? scanBanned(reading, cards) : null,
        msToFirstCard: outcome.msToFirstCard,
        msToDone: outcome.msToDone,
        regenerated: outcome.regenerated,
        templated: outcome.templated,
      };
      records.push(record);

      const timing =
        `- ${fixture.id} run ${run}: accepted ${ms(outcome.msToAccepted)}, ` +
        `first card ${ms(outcome.msToFirstCard)}, done ${ms(outcome.msToDone)}`;
      timingLines.push(timing);
      if (reading && record.diff && (!record.diff.warningSigns.countOk || record.diff.warningSigns.coverage < 1)) {
        // This runner only reads bundled synthetic fixtures. Preserve the mismatching warning
        // evidence for human review; runtime routes never log document text.
        timingLines.push(`- ${fixture.id} warning review (synthetic): ${JSON.stringify(reading.warningSigns.map((warning) => ({ quote: warning.source.quote, symptom: warning.symptom.en, action: warning.action.en })))}`);
      }

      const verdict = record.error
        ? `FAIL ${record.error}`
        : `${record.diff?.ok ? "ok  " : "diff"} meds ${record.diff?.medicines.exact ? "exact" : "differ"}, banned ${record.banned?.hits ?? 0}`;
      console.log(
        `  ${fixture.id} ${run}/${options.runs}  ${ms(outcome.msToAccepted)} accepted, ` +
          `${ms(outcome.msToFirstCard)} first card, ` +
          `${ms(outcome.msToDone)} done  ${verdict}`,
      );
    }
  }

  const rows = summarise(records);
  printTable(rows);

  const pass002 = sc002(rows);
  const pass003 = sc003(rows);
  const regenerated = rows.reduce((sum, row) => sum + row.regenerated, 0);
  const templated = rows.reduce((sum, row) => sum + row.templated, 0);

  console.log(`Filter: ${regenerated} regenerated, ${templated} templated.`);
  console.log(`SC-002 ${pass002 ? "PASS" : "FAIL"}`);
  console.log(`SC-003 ${pass003 ? "PASS" : "FAIL"}`);
  console.log("");

  const stamp = new Date().toISOString();
  const block = [
    "",
    `## Reading run ${stamp}`,
    "",
    `- Model label: \`${options.model}\` (set by the server's \`MODEL_READ\`; the runner only records it)`,
    `- Server: ${options.base}`,
    `- Sheets: ${options.sheets.map((f) => f.id).join(", ")} x ${options.runs} run(s)`,
    `- Filter: ${regenerated} regenerated, ${templated} templated`,
    "",
    ...markdownTable(rows),
    "",
    "Timings:",
    "",
    ...timingLines,
    "",
    "Findings:",
    "",
    ...findings(records),
    "",
    `**SC-002 ${pass002 ? "PASS" : "FAIL"}** — invented ${rows.reduce((s, r) => s + r.invented, 0)}, missing ${rows.reduce((s, r) => s + r.missing, 0)}, exact-medicine rate ${rows.map((r) => `${r.sheet} ${pct(r.exactMedicineRate)}`).join(", ")}.`,
    `**SC-003 ${pass003 ? "PASS" : "FAIL"}** — ${rows.reduce((s, r) => s + r.bannedHits, 0)} banned-term hit(s) after filtering.`,
    "",
  ].join("\n");

  await ensureResultsFile();
  await insertRun(RESULTS_FILE, RESULTS_MARKER, block);
  console.log(`Recorded the run in ${RESULTS_FILE}`);

  const summaryLine = [
    "",
    `- ${stamp} — \`${options.model}\` — ` +
      rows
        .map((r) => `${r.sheet} ${r.ok}/${r.runs} runs, meds ${pct(r.exactMedicineRate)} exact`)
        .join("; ") +
      `; invented ${rows.reduce((s, r) => s + r.invented, 0)}, missing ${rows.reduce((s, r) => s + r.missing, 0)}, banned ${rows.reduce((s, r) => s + r.bannedHits, 0)}` +
      ` — SC-002 ${pass002 ? "PASS" : "FAIL"}, SC-003 ${pass003 ? "PASS" : "FAIL"} (detail in tests/eval/results.md)`,
  ].join("\n");
  await insertRun(READING_FILE, READING_RUNS_MARKER, summaryLine);
  console.log(`Recorded the summary line in ${READING_FILE}`);
  console.log("");
  console.log("Fill the accuracy, latency and banned-term tables in tests/eval/reading.md, then");
  console.log("write the PICK line. This runner never decides the model.");
}

// Exit explicitly: `fetch`'s pooled keep-alive sockets would otherwise hold the process open for
// seconds after the last response (same reason as tests/eval/voices.ts).
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
