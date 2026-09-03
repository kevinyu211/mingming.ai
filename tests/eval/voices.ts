/**
 * The listening test runner (T007, research.md R5, provider_shortlist.md section 5).
 *
 *   npx tsx tests/eval/voices.ts
 *   npx tsx tests/eval/voices.ts --providers minimax,elevenlabs
 *
 * Renders the six fixed sentences in `tests/eval/sentences.json` through every configured TTS
 * adapter, writes `tests/eval/out/voices/<provider>/<id>.mp3`, prints a provider x sentence
 * table of latency and byte size, and appends a run header to `tests/eval/voices.md` for the
 * blind scoring that follows.
 *
 * A provider with no keys is SKIPPED with the reason printed, so this runs usefully with one
 * key or none. It never prints the sentence text alongside a key and never logs a key.
 *
 * The script does not decide anything. Two native Cantonese listeners and one Mandarin listener
 * score the files by ear and write the pick into `tests/eval/voices.md` (T020).
 */

import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAzureTtsProvider } from "../../lib/speech/providers/azure";
import { createElevenLabsTtsProvider } from "../../lib/speech/providers/elevenlabs";
import { createMinimaxTtsProvider } from "../../lib/speech/providers/minimax";
import {
  SpeechConfigError,
  type Dialect,
  type TtsProvider,
} from "../../lib/speech/providers/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const OUT_DIR = join(HERE, "out", "voices");
const RESULTS_FILE = join(HERE, "voices.md");

/** Runs are inserted here, newest first, so the PICK line stays the last line of the file. */
const RUNS_MARKER = "<!-- tests/eval/voices.ts appends run headers below this line. -->";

interface Sentence {
  id: string;
  dialect: Dialect;
  kind: string;
  text: string;
}

const ALL_PROVIDERS = ["minimax", "elevenlabs", "azure"] as const;
type ProviderName = (typeof ALL_PROVIDERS)[number];

const FACTORIES: Record<ProviderName, () => TtsProvider> = {
  minimax: createMinimaxTtsProvider,
  elevenlabs: createElevenLabsTtsProvider,
  azure: createAzureTtsProvider,
};

interface Row {
  provider: string;
  sentenceId: string;
  ms: number;
  bytes: number;
  error?: string;
}

/** Load .env.local then .env if Node supports it, so the script works without a wrapper. */
function loadEnvFiles(): void {
  const loader = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  if (!loader) return;
  for (const file of [".env.local", ".env"]) {
    try {
      loader.call(process, join(REPO_ROOT, file));
    } catch {
      // Absent or unreadable: environment variables may already be set another way.
    }
  }
}

function parseProviders(argv: string[]): ProviderName[] {
  const flagIndex = argv.findIndex((arg) => arg === "--providers" || arg.startsWith("--providers="));
  if (flagIndex === -1) return [...ALL_PROVIDERS];
  const arg = argv[flagIndex];
  const value = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[flagIndex + 1];
  if (!value) return [...ALL_PROVIDERS];
  const requested = value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const unknown = requested.filter(
    (name) => !(ALL_PROVIDERS as readonly string[]).includes(name),
  );
  if (unknown.length > 0) {
    console.error(
      `Unknown provider(s): ${unknown.join(", ")}. Known: ${ALL_PROVIDERS.join(", ")}.`,
    );
    process.exit(2);
  }
  return requested as ProviderName[];
}

function loadSentences(): Sentence[] {
  const raw = readFileSync(join(HERE, "sentences.json"), "utf8");
  const parsed = JSON.parse(raw) as { sentences: Sentence[] };
  return parsed.sentences;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function printTable(sentences: Sentence[], rows: Row[], providers: string[]): void {
  const idWidth = Math.max(12, ...sentences.map((s) => s.id.length));
  const colWidth = 16;
  const header =
    pad("sentence", idWidth) + " | " + providers.map((p) => pad(p, colWidth)).join(" | ");
  console.log("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const sentence of sentences) {
    const cells = providers.map((provider) => {
      const row = rows.find((r) => r.provider === provider && r.sentenceId === sentence.id);
      if (!row) return pad("-", colWidth);
      if (row.error) return pad(`FAIL ${row.error}`.slice(0, colWidth), colWidth);
      return pad(`${row.ms} ms / ${(row.bytes / 1024).toFixed(1)} kB`, colWidth);
    });
    console.log(pad(sentence.id, idWidth) + " | " + cells.join(" | "));
  }
  console.log("");
}

function summarise(rows: Row[], provider: string): string {
  const own = rows.filter((r) => r.provider === provider);
  const ok = own.filter((r) => !r.error);
  if (ok.length === 0) return `${provider}: all ${own.length} sentences failed`;
  const avg = Math.round(ok.reduce((sum, r) => sum + r.ms, 0) / ok.length);
  const total = ok.reduce((sum, r) => sum + r.bytes, 0);
  return `${provider}: ${ok.length}/${own.length} rendered, mean ${avg} ms, ${(
    total / 1024
  ).toFixed(1)} kB total`;
}

/**
 * Insert a run block just below the marker in `voices.md`, so runs read newest-first and the
 * file still ends with the PICK line (`provider_shortlist.md` section 5). Falls back to an
 * append if someone has removed the marker.
 */
async function recordRun(block: string): Promise<void> {
  const existing = await readFile(RESULTS_FILE, "utf8").catch(() => "");
  if (existing.includes(RUNS_MARKER)) {
    await writeFile(RESULTS_FILE, existing.replace(RUNS_MARKER, `${RUNS_MARKER}\n${block}`), "utf8");
  } else {
    await appendFile(RESULTS_FILE, block, "utf8");
  }
}

async function main(): Promise<void> {
  loadEnvFiles();
  const requested = parseProviders(process.argv.slice(2));
  const sentences = loadSentences();

  const active: { name: ProviderName; provider: TtsProvider }[] = [];
  for (const name of requested) {
    try {
      active.push({ name, provider: FACTORIES[name]() });
    } catch (error) {
      const reason =
        error instanceof SpeechConfigError
          ? `missing ${error.missing.join(", ")}`
          : (error as Error).message;
      console.log(`SKIP ${name}: ${reason}`);
    }
  }

  if (active.length === 0) {
    console.log("");
    console.log(
      "No TTS provider is configured. Set MINIMAX_API_KEY + MINIMAX_GROUP_ID, " +
        "ELEVENLABS_API_KEY, or AZURE_SPEECH_KEY + AZURE_SPEECH_REGION in .env.local.",
    );
    return;
  }

  const rows: Row[] = [];
  for (const { name, provider } of active) {
    const dir = join(OUT_DIR, name);
    await mkdir(dir, { recursive: true });
    for (const sentence of sentences) {
      const startedAt = Date.now();
      try {
        const { audio } = await provider.synthesize(sentence.text, sentence.dialect);
        const ms = Date.now() - startedAt;
        await writeFile(join(dir, `${sentence.id}.mp3`), audio);
        rows.push({ provider: name, sentenceId: sentence.id, ms, bytes: audio.byteLength });
        console.log(`  ok  ${name}/${sentence.id}  ${ms} ms  ${audio.byteLength} bytes`);
      } catch (error) {
        const ms = Date.now() - startedAt;
        // The message may name a status code, never the sentence.
        const message = (error as Error).message.split("\n")[0].slice(0, 120);
        rows.push({ provider: name, sentenceId: sentence.id, ms, bytes: 0, error: message });
        console.log(`  FAIL ${name}/${sentence.id}  ${message}`);
      }
    }
  }

  const names = active.map((a) => a.name);
  printTable(sentences, rows, names);
  console.log(`Files: ${OUT_DIR}/<provider>/<id>.mp3`);

  const stamp = new Date().toISOString();
  const header = [
    "",
    `## Run ${stamp}`,
    "",
    `Providers: ${names.join(", ")}`,
    `Sentences: ${sentences.map((s) => s.id).join(", ")}`,
    `Audio: tests/eval/out/voices/<provider>/<id>.mp3`,
    "",
    ...names.map((name) => `- ${summarise(rows, name)}`),
    "",
    "Score the files with the table above, then set the PICK line at the end of this file.",
    "",
  ].join("\n");
  await recordRun(header);
  console.log(`Recorded the run in ${RESULTS_FILE}`);
}

// Exit explicitly: the HTTP keep-alive sockets `fetch` pools would otherwise hold the
// process open for seconds after the last request.
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
