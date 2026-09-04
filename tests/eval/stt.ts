/**
 * The transcription test runner (T007, research.md R6, provider_shortlist.md section 5).
 *
 *   npx tsx tests/eval/stt.ts
 *   npx tsx tests/eval/stt.ts --providers elevenlabs
 *
 * Runs every clip in `tests/eval/clips/` (`.m4a` or `.wav`, named by the ids in
 * `tests/eval/clips/expected.json`) through each configured STT adapter, prints the transcript
 * next to the expected text with a character error rate, and appends a run summary to
 * `tests/eval/stt.md`.
 *
 * A provider with no keys is SKIPPED with the reason printed. Missing clips are reported, not
 * fatal, so this is useful as soon as the first recording exists.
 *
 * The clips and their transcripts are synthetic test material, so printing them here is fine.
 * Nothing in `lib/speech/providers/` prints them, which is the rule that matters at runtime.
 */

import { readFileSync } from "node:fs";
import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAzureSttProvider } from "../../lib/speech/providers/azure";
import { createElevenLabsSttProvider } from "../../lib/speech/providers/elevenlabs";
import { createOpenAiSttProvider } from "../../lib/speech/providers/openai";
import {
  SpeechConfigError,
  type InputLanguage,
  type SttProvider,
} from "../../lib/speech/providers/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const CLIPS_DIR = join(HERE, "clips");
const RESULTS_FILE = join(HERE, "stt.md");

/** Runs are inserted here, newest first, so the PICK line stays the last line of the file. */
const RUNS_MARKER = "<!-- tests/eval/stt.ts appends run tables below this line. -->";

const ALL_PROVIDERS = ["openai", "elevenlabs", "azure"] as const;
type ProviderName = (typeof ALL_PROVIDERS)[number];

const FACTORIES: Record<ProviderName, () => SttProvider> = {
  openai: createOpenAiSttProvider,
  elevenlabs: createElevenLabsSttProvider,
  azure: createAzureSttProvider,
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
};

interface Clip {
  id: string;
  language: InputLanguage;
  text: string;
}

interface Row {
  provider: string;
  clipId: string;
  expected: string;
  actual: string;
  cer: number;
  ms: number;
  error?: string;
}

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
  const flagIndex = argv.findIndex(
    (arg) => arg === "--providers" || arg.startsWith("--providers="),
  );
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

function loadClips(): Clip[] {
  const raw = readFileSync(join(CLIPS_DIR, "expected.json"), "utf8");
  return (JSON.parse(raw) as { clips: Clip[] }).clips;
}

/**
 * Strip whitespace and punctuation before comparing, so a provider is not punished for `?`
 * instead of `？`. Case is folded for the English clips. Traditional vs simplified characters
 * are deliberately NOT normalised: the transcript is shown to the user, and it should come back
 * in the script they spoke.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .trim();
}

/** Levenshtein distance, two-row variant. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Character error rate against the expected transcript. 0 is perfect; can exceed 1. */
function characterErrorRate(expected: string, actual: string): number {
  const reference = normalise(expected);
  const hypothesis = normalise(actual);
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  return editDistance(reference, hypothesis) / reference.length;
}

async function findClipFiles(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let entries: string[];
  try {
    entries = await readdir(CLIPS_DIR);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (!(ext in MIME_BY_EXTENSION)) continue;
    found.set(entry.slice(0, entry.length - ext.length), join(CLIPS_DIR, entry));
  }
  return found;
}

function meanCer(rows: Row[], provider: string): number | null {
  const own = rows.filter((r) => r.provider === provider && !r.error);
  if (own.length === 0) return null;
  return own.reduce((sum, r) => sum + r.cer, 0) / own.length;
}

function meanMs(rows: Row[], provider: string): number | null {
  const own = rows.filter((r) => r.provider === provider && !r.error);
  if (own.length === 0) return null;
  return Math.round(own.reduce((sum, r) => sum + r.ms, 0) / own.length);
}

/**
 * Insert a run block just below the marker in `stt.md`, so runs read newest-first and the file
 * still ends with the PICK line. Falls back to an append if the marker has been removed.
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
  const clips = loadClips();
  const files = await findClipFiles();

  const missing = clips.filter((clip) => !files.has(clip.id));
  if (missing.length > 0) {
    console.log(
      `Missing ${missing.length} clip(s): ${missing.map((c) => c.id).join(", ")}. ` +
        "See tests/eval/clips/README.md for how to record them.",
    );
  }
  const present = clips.filter((clip) => files.has(clip.id));
  if (present.length === 0) {
    console.log("No clips to run. Record them into tests/eval/clips/ first.");
    return;
  }

  const active: { name: ProviderName; provider: SttProvider }[] = [];
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
      "No STT provider is configured. Set ELEVENLABS_API_KEY, or " +
        "AZURE_SPEECH_KEY + AZURE_SPEECH_REGION in .env.local.",
    );
    return;
  }

  const rows: Row[] = [];
  for (const { name, provider } of active) {
    console.log("");
    console.log(`=== ${name} ===`);
    for (const clip of present) {
      const path = files.get(clip.id) as string;
      const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()];
      const audio = new Uint8Array(await readFile(path));
      const startedAt = Date.now();
      try {
        const { text } = await provider.transcribe(audio, mimeType, clip.language);
        const ms = Date.now() - startedAt;
        const cer = characterErrorRate(clip.text, text);
        rows.push({
          provider: name,
          clipId: clip.id,
          expected: clip.text,
          actual: text,
          cer,
          ms,
        });
        console.log(`${clip.id}  CER ${(cer * 100).toFixed(1)}%  ${ms} ms`);
        console.log(`  expected: ${clip.text}`);
        console.log(`  got     : ${text}`);
      } catch (error) {
        const ms = Date.now() - startedAt;
        const message = (error as Error).message.split("\n")[0].slice(0, 120);
        rows.push({
          provider: name,
          clipId: clip.id,
          expected: clip.text,
          actual: "",
          cer: 1,
          ms,
          error: message,
        });
        console.log(`${clip.id}  FAIL  ${message}`);
      }
    }
  }

  const names = active.map((a) => a.name);
  console.log("");
  for (const name of names) {
    const cer = meanCer(rows, name);
    const ms = meanMs(rows, name);
    console.log(
      `${name}: mean CER ${cer === null ? "n/a" : `${(cer * 100).toFixed(1)}%`}, ` +
        `mean latency ${ms === null ? "n/a" : `${ms} ms`}`,
    );
  }

  const stamp = new Date().toISOString();
  const lines = [
    "",
    `## Run ${stamp}`,
    "",
    `Providers: ${names.join(", ")}`,
    `Clips: ${present.length}/${clips.length} present` +
      (missing.length > 0 ? ` (missing: ${missing.map((c) => c.id).join(", ")})` : ""),
    "",
    "| provider | clip | CER | ms | transcript |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.provider} | ${r.clipId} | ${r.error ? "FAIL" : `${(r.cer * 100).toFixed(1)}%`} | ${
          r.ms
        } | ${r.error ?? r.actual.replace(/\|/g, "/")} |`,
    ),
    "",
    ...names.map((name) => {
      const cer = meanCer(rows, name);
      const ms = meanMs(rows, name);
      return `- ${name}: mean CER ${cer === null ? "n/a" : `${(cer * 100).toFixed(1)}%`}, mean latency ${
        ms === null ? "n/a" : `${ms} ms`
      }`;
    }),
    "",
    "Judge the Cantonese clips by hand as well as by CER, then set the PICK line at the end of this file.",
    "",
  ].join("\n");
  await recordRun(lines);
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
