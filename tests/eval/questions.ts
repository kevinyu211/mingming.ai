/**
 * The ask test runner (T032, quickstart.md V5, SC-006 and SC-009).
 *
 *   NODE_OPTIONS=--use-openssl-ca tsx tests/eval/questions.ts
 *   NODE_OPTIONS=--use-openssl-ca tsx tests/eval/questions.ts --base http://localhost:3000 --dialect cmn
 *
 * Loads `fixtures/sheets/hk_en.expected.json`, runs `lib/rules/diet-line.ts` over it exactly as
 * the client does, and posts every question in `tests/eval/questions.json` to a running server's
 * `/api/ask` with that reading. For each one it checks the outcome, checks that an answered
 * question cited one of the allowed card ids, measures time to the `answer` event, and scans the
 * answer with the banned-term filter.
 *
 * SC-006 passes when every outcome in the ten-question set matches and p95 time to answer is at
 * most 10 s. The crisis probe is reported on its own line: it is a rule gate, not one of the ten.
 *
 * Privacy (constitution V, quickstart.md V9): the request body carries `reading`, `question` and
 * `dialect` and nothing else — no label, no plan, no dates. The console prints question **ids**
 * and outcomes, never a question next to its answer, and no answer text is written anywhere. The
 * local `tests/eval/results.md` keeps the question text with the outcome so a failure is
 * reproducible, and still no answer text.
 */

import { readFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Dialect, InputLanguage, SheetReading, Speakable } from "../../lib/domain/schemas";
import { checkSpeakable } from "../../lib/rules/banned-terms";
import { applyDietRules } from "../../lib/rules/diet-line";
import { RESULTS_HEADER, RESULTS_MARKER, percentile } from "./diff";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURE_DIR = join(REPO_ROOT, "fixtures", "sheets");
const QUESTIONS_FILE = join(HERE, "questions.json");
const RESULTS_FILE = join(HERE, "results.md");

/** SC-006: "a spoken answer starts within 10 seconds of the question ending." */
const SC006_P95_MS = 10_000;

const REQUEST_TIMEOUT_MS = 60_000;

type Outcome = "answered" | "refused_medicine_change" | "not_on_sheet" | "crisis_referral";

interface QuestionSpec {
  id: string;
  language: InputLanguage;
  text: string;
  expect: { outcome: Outcome; citedCardId?: string[] };
  why?: string;
}

interface QuestionsFile {
  reading: string;
  questions: QuestionSpec[];
  crisis: QuestionSpec[];
}

interface AskEventShape {
  event?: string;
  outcome?: string;
  citedCardId?: string;
  answer?: Speakable;
  error?: string;
}

interface Result {
  spec: QuestionSpec;
  group: "ten" | "crisis";
  outcome: string | null;
  citedCardId: string | null;
  /** True when an answer event arrived; the crisis outcome deliberately has none. */
  answered: boolean;
  bannedHits: number;
  bannedTerms: string[];
  msToAnswer: number | null;
  msToDone: number | null;
  error: string | null;
  outcomeOk: boolean;
  citationOk: boolean;
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

interface Options {
  base: string;
  dialect: Dialect;
  only: string[] | null;
}

function parseOptions(argv: string[]): Options {
  const dialect = flag(argv, "dialect") ?? "yue";
  if (dialect !== "yue" && dialect !== "cmn") {
    console.error(`--dialect must be yue or cmn, got "${dialect}".`);
    process.exit(2);
  }
  const only = flag(argv, "only");
  return {
    base: (flag(argv, "base") ?? "http://localhost:3000").replace(/\/+$/, ""),
    dialect,
    only: only ? only.split(",").map((id) => id.trim()).filter(Boolean) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* The reading sent with every question                                       */
/* -------------------------------------------------------------------------- */

/**
 * The reading exactly as the client holds it after a read: the model's `SheetReading` plus the
 * diet type the rules computed, plus `readAt` and the sample flag. `AskRequestSchema` is strict at
 * every level, so anything else in here is a 400 — which is the check working, not a bug.
 */
function buildAskReading(sheet: string): Record<string, unknown> {
  const expected = JSON.parse(
    readFileSync(join(FIXTURE_DIR, `${sheet}.expected.json`), "utf8"),
  ) as SheetReading;
  return {
    ...expected,
    dietLine: applyDietRules(expected),
    readAt: new Date().toISOString(),
    sample: true,
  };
}

/* -------------------------------------------------------------------------- */
/* One question                                                               */
/* -------------------------------------------------------------------------- */

async function askOnce(
  base: string,
  reading: Record<string, unknown>,
  dialect: Dialect,
  spec: QuestionSpec,
  group: Result["group"],
): Promise<Result> {
  const result: Result = {
    spec,
    group,
    outcome: null,
    citedCardId: null,
    answered: false,
    bannedHits: 0,
    bannedTerms: [],
    msToAnswer: null,
    msToDone: null,
    error: null,
    outcomeOk: false,
    citationOk: false,
  };
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reading,
        question: { text: spec.text, inputLanguage: spec.language },
        dialect,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    result.error = `request failed: ${(error as Error).message.split("\n")[0].slice(0, 120)}`;
    return finish(result);
  }

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    let code = `http ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) code = `${code} ${parsed.error}`;
    } catch {
      // Not JSON; the status is the finding.
    }
    result.error = code;
    return finish(result);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  const handle = (line: string): void => {
    if (line.trim().length === 0) return;
    let event: AskEventShape;
    try {
      event = JSON.parse(line) as AskEventShape;
    } catch {
      result.error = result.error ?? "malformed ndjson line";
      return;
    }
    switch (event.event) {
      case "outcome":
        result.outcome = event.outcome ?? null;
        result.citedCardId = event.citedCardId ?? null;
        break;
      case "answer": {
        result.answered = true;
        result.msToAnswer = Date.now() - startedAt;
        if (event.answer) {
          const scan = checkSpeakable(event.answer);
          result.bannedHits += scan.matches.length;
          result.bannedTerms.push(...scan.matches);
        }
        break;
      }
      case "done":
        result.msToDone = Date.now() - startedAt;
        break;
      case "error":
        result.error = result.error ?? `stream error: ${event.error ?? "unknown"}`;
        break;
      default:
        break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  handle(buffered);

  if (result.outcome === null && result.error === null) {
    result.error = "stream ended without an outcome event";
  }
  return finish(result);
}

/**
 * Grades one result. A citation is only checked when the expectation names allowed ids, and only
 * for `answered` — the other three outcomes are template answers with no card behind them.
 */
function finish(result: Result): Result {
  result.outcomeOk = result.outcome === result.spec.expect.outcome;
  const allowed = result.spec.expect.citedCardId;
  result.citationOk =
    result.spec.expect.outcome !== "answered" || !allowed
      ? true
      : result.citedCardId !== null && allowed.includes(result.citedCardId);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

function ms(value: number | null): string {
  return value === null ? "-" : `${(value / 1000).toFixed(1)}s`;
}

const COLUMNS = ["id", "lang", "expected", "got", "cited", "ok", "banned", "to answer"] as const;

function cells(result: Result): string[] {
  return [
    result.spec.id,
    result.spec.language,
    result.spec.expect.outcome,
    result.error ?? result.outcome ?? "-",
    result.citedCardId ?? "-",
    result.outcomeOk && result.citationOk && !result.error ? "yes" : "NO",
    String(result.bannedHits),
    ms(result.msToAnswer ?? result.msToDone),
  ];
}

function printTable(results: readonly Result[]): void {
  const body = results.map(cells);
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

function markdownTable(results: readonly Result[]): string[] {
  return [
    `| ${COLUMNS.join(" | ")} | question |`,
    `| ${[...COLUMNS, "question"].map(() => "---").join(" | ")} |`,
    ...results.map((r) => `| ${cells(r).join(" | ")} | ${r.spec.text} |`),
  ];
}

/** Same insertion convention as tests/eval/reading.ts and tests/eval/voices.ts. */
async function insertRun(file: string, marker: string, block: string): Promise<void> {
  const existing = await readFile(file, "utf8").catch(() => "");
  if (existing.includes(marker)) {
    await writeFile(file, existing.replace(marker, `${marker}\n${block}`), "utf8");
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
  const file = JSON.parse(readFileSync(QUESTIONS_FILE, "utf8")) as QuestionsFile;
  const reading = buildAskReading(file.reading);

  const wanted = (spec: QuestionSpec): boolean =>
    options.only === null || options.only.includes(spec.id);
  const ten = file.questions.filter(wanted);
  const crisis = file.crisis.filter(wanted);

  console.log("");
  console.log(`Ask eval — ${ten.length} question(s) + ${crisis.length} crisis probe(s)`);
  console.log(`Server: ${options.base}`);
  console.log(`Reading: fixtures/sheets/${file.reading}.expected.json (sample), dialect ${options.dialect}`);
  console.log("");

  const results: Result[] = [];
  for (const [group, specs] of [
    ["ten", ten],
    ["crisis", crisis],
  ] as const) {
    for (const spec of specs) {
      const result = await askOnce(options.base, reading, options.dialect, spec, group);
      results.push(result);
      // Ids and outcomes only: the question text is never printed beside its answer.
      console.log(
        `  ${spec.id.padEnd(18)} ${(result.error ?? result.outcome ?? "-").padEnd(24)} ` +
          `${(result.citedCardId ?? "-").padEnd(12)} ${ms(result.msToAnswer ?? result.msToDone)} ` +
          `${result.outcomeOk && result.citationOk && !result.error ? "ok" : "MISMATCH"}`,
      );
    }
  }

  printTable(results);

  const tenResults = results.filter((r) => r.group === "ten");
  const crisisResults = results.filter((r) => r.group === "crisis");
  const latencies = tenResults
    .map((r) => r.msToAnswer ?? r.msToDone)
    .filter((v): v is number => v !== null);
  const p95 = percentile(latencies, 95);
  const p50 = percentile(latencies, 50);
  const allOutcomesOk = tenResults.every((r) => r.outcomeOk && r.citationOk && !r.error);
  const bannedHits = results.reduce((sum, r) => sum + r.bannedHits, 0);
  const pass006 = tenResults.length > 0 && allOutcomesOk && p95 !== null && p95 <= SC006_P95_MS;
  const crisisOk =
    crisisResults.length === 0 || crisisResults.every((r) => r.outcomeOk && !r.error);

  console.log(`Time to answer: p50 ${ms(p50)}, p95 ${ms(p95)} (SC-006 ceiling 10.0s)`);
  console.log(`Banned-term hits in answers: ${bannedHits}`);
  console.log(`Crisis gate: ${crisisResults.length === 0 ? "not run" : crisisOk ? "PASS" : "FAIL"}`);
  console.log(`SC-006 ${pass006 ? "PASS" : "FAIL"}`);
  console.log("");

  const stamp = new Date().toISOString();
  const mismatches = results.filter((r) => !r.outcomeOk || !r.citationOk || r.error);
  const block = [
    "",
    `## Ask run ${stamp}`,
    "",
    `- Server: ${options.base}`,
    `- Reading: \`fixtures/sheets/${file.reading}.expected.json\` with \`applyDietRules\`, sent as a sample`,
    `- Dialect: ${options.dialect}`,
    `- Time to answer: p50 ${ms(p50)}, p95 ${ms(p95)}`,
    `- Banned-term hits in answers: ${bannedHits}`,
    "",
    ...markdownTable(results),
    "",
    "Findings:",
    "",
    ...(mismatches.length === 0
      ? ["- none"]
      : mismatches.map(
          (r) =>
            `- ${r.spec.id}: expected ${r.spec.expect.outcome}` +
            (r.spec.expect.citedCardId ? ` citing one of ${r.spec.expect.citedCardId.join(" / ")}` : "") +
            `, got ${r.error ?? r.outcome ?? "nothing"}` +
            (r.citedCardId ? ` citing ${r.citedCardId}` : ""),
        )),
    "",
    `**SC-006 ${pass006 ? "PASS" : "FAIL"}** — ${tenResults.filter((r) => r.outcomeOk && r.citationOk && !r.error).length}/${tenResults.length} outcomes matched, p95 time to answer ${ms(p95)} (ceiling 10.0s).`,
    `Crisis gate: ${crisisResults.length === 0 ? "not run" : crisisOk ? "PASS" : "FAIL"} (reported separately; not one of the ten).`,
    "",
  ].join("\n");

  await ensureResultsFile();
  await insertRun(RESULTS_FILE, RESULTS_MARKER, block);
  console.log(`Recorded the run in ${RESULTS_FILE}`);
}

// Exit explicitly, for the same reason as tests/eval/voices.ts: pooled keep-alive sockets.
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
