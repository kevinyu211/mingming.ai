/**
 * The stress runner (T-stress) — how the reading pipeline copes with sheets that are NOT clean.
 *
 *   # the whole pipeline, through the running dev server
 *   env -u NODE_OPTIONS ./node_modules/.bin/tsx tests/eval/stress.ts \
 *     --mode api --sheets all --runs 3 --base http://localhost:3011
 *
 *   # the model layer only, two models over the same images
 *   env -u NODE_OPTIONS ./node_modules/.bin/tsx tests/eval/stress.ts \
 *     --mode direct --models claude-opus-5,claude-sonnet-5 --runs 3
 *
 * `tests/eval/reading.ts` scores the three clean fixtures against
 * `fixtures/sheets/*.expected.json`. This one scores the four deliberately hard fixtures in
 * `fixtures/stress/` against `fixtures/stress/*.truth.json` — an answer key written from the HTML
 * that produced each image, never from a model reply. The findings live in `tests/eval/stress.md`.
 *
 * Two things it does that the reading runner does not:
 *
 * 1. It aligns medicines by drug rather than by index, so one dropped row does not cascade into
 *    eight "mismatches", and it reports MISSING and INVENTED by name. A sheet that prints two
 *    strengths of one ingredient (dense: Furosemide 40mg and 20mg) is aligned on the pair.
 * 2. It scores every medicine twice. STRICT is the constitution's rule — a field is verbatim or it
 *    is wrong. LINE-LEVEL asks the weaker question "did every printed value survive somewhere in
 *    this medicine's five fields", which separates a field-boundary choice ("1 tab" landing in
 *    `amount` versus `frequency`) from a lost or altered dose. Both numbers are reported; only
 *    STRICT decides pass or fail.
 *
 * It also checks what the clean fixtures cannot: whether a region a human deliberately obscured
 * came back as `unreadable` rather than as a confident guess, whether the ink annotation or the
 * struck-through printed value won, and whether anything from a block that is NOT a discharge
 * instruction (a lab table, an imaging paragraph) leaked into a field.
 *
 * Since `Medicine.status` exists, a "stopped medicines" block is no longer purely a trap. Each
 * truth file lists that block under `stoppedMedicines`, and the runner judges a returned entry
 * from it on two things only: its `status` must not be "current", and it must not reach the plan
 * `lib/rules/plan-from-reading.ts` drafts. Either failure is counted as DANGEROUS — a drug the
 * hospital stopped, scheduled as one to take — and is the headline number of this file. Those
 * entries are deliberately kept out of the strict and field-level medicine scores so that the
 * verbatim numbers stay comparable with the runs recorded in `tests/eval/stress.md`.
 *
 * Privacy: the fixtures are synthetic, but the console still prints ids, counts and timings only.
 * Full detail — including the offending strings, which is the whole point of a stress run — goes
 * to `--out`, a local JSON file, and to `tests/eval/stress.md`. `--dump <dir>` additionally writes
 * the whole returned reading per run, which is how a finding like "the meal timing is missing from
 * `frequency`" is traced to where the words actually went. Both flags are opt-in and local, and
 * neither is safe to point at anything but a synthetic fixture.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Card,
  Medicine,
  SheetReading,
  Speakable,
  StoredReading,
} from "../../lib/domain/schemas";
import { draftPlan } from "../../lib/rules/plan-from-reading";
import { MEDICINE_FIELDS, percentile, scanBanned, type MedicineField } from "./diff";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const STRESS_DIR = join(REPO_ROOT, "fixtures", "stress");

/** A whole read, including one server-side retry, must fit inside this. */
const REQUEST_TIMEOUT_MS = 240_000;

/** Sentinel in a truth file: the value exists on the page but is deliberately covered here. */
const UNREADABLE = "__unreadable__";

/* -------------------------------------------------------------------------- */
/* The answer key                                                             */
/* -------------------------------------------------------------------------- */

interface TruthMedicine {
  name: string;
  strength: string | null;
  amount: string | null;
  frequency: string | null;
  duration: string | null;
  /** What the page's own heading says about this line. Absent means "current". */
  status?: "current" | "stopped" | "changed";
  /** Which field was written in by hand rather than printed. */
  handwritten?: string;
  /** The printed value the ink supersedes, e.g. "5mg (struck through in ink)". */
  supersededPrinted?: string;
}

/**
 * A reading produced before `Medicine.status` existed has no status at all, and the old
 * `draftPlan` treated exactly that case as a dose to take. Reading it as "current" is therefore
 * not a lenient default — it is what the pipeline actually did, which is what makes a
 * before/after comparison on the same fixtures honest.
 */
function statusOf(medicine: Medicine): string {
  const value = (medicine as Partial<Medicine>).status;
  return typeof value === "string" && value.length > 0 ? value : "current";
}

interface TruthFollowUp {
  clinic: string | null;
  when: string | null;
  tests: string | null;
  handwritten?: string;
}

interface TruthUnreadable {
  section: string;
  what: string;
  /** Any one of these, found in a returned unreadable entry, counts as the region being named. */
  matchAny?: string[];
}

interface Truth {
  id: string;
  file: string;
  mediaType: "image/png" | "image/jpeg";
  stresses: string;
  expectedSheetType: string;
  medicines: TruthMedicine[];
  /**
   * The page's "not to be taken" block, written from the fixture HTML. Returning one of these is
   * correct — the family is told the drug was stopped — provided it is marked and never planned.
   * Omitting them entirely is also correct, so a miss here is never counted against a run.
   */
  stoppedMedicines?: TruthMedicine[];
  followUp: TruthFollowUp[];
  handwrittenValues?: string[];
  dietLine: string;
  activityLine: string;
  warningSigns: string[];
  warningAction: string;
  hospitalContact: string;
  unreadable: TruthUnreadable[];
  /** Strings that appear ONLY inside a block that is not a discharge instruction. */
  traps: Record<string, string[]>;
  notes?: string[];
}

const SHEET_IDS = ["dense", "messy", "handwritten", "mixed"] as const;
type SheetId = (typeof SHEET_IDS)[number];

function loadTruth(id: SheetId): Truth {
  return JSON.parse(readFileSync(join(STRESS_DIR, `${id}.truth.json`), "utf8")) as Truth;
}

/* -------------------------------------------------------------------------- */
/* Comparison helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Verbatim, the way `tests/eval/diff.ts` does it: trim the ends, compare character for character. */
function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function same(expected: string | null | undefined, actual: string | null | undefined): boolean {
  return trimmed(expected) === trimmed(actual);
}

/**
 * For MATCHING only — never for scoring. Folds width, case and runs of whitespace so that
 * "Metformin XR" and "metformin  xr" are recognised as the same drug while the strict comparison
 * above still calls "5mg" and "5 mg" different doses.
 */
function loose(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function contains(haystack: string, needle: string): boolean {
  return loose(haystack).includes(loose(needle));
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

interface FieldMiss {
  /** The medicine (or `followUp[i]`) the field belongs to. */
  drug: string;
  field: string;
  expected: string;
  actual: string;
}

interface MedicineScore {
  expected: number;
  returned: number;
  matched: number;
  missing: string[];
  invented: string[];
  strictMisses: FieldMiss[];
  /** Truth values that did not survive anywhere in the matched medicine's five fields. */
  lostValues: FieldMiss[];
  /** A covered field that came back with a value anyway — a guess where a gap was honest. */
  guessed: FieldMiss[];
  /** A covered field correctly left null. */
  admitted: number;
  fieldsChecked: number;
  fieldsStrict: number;
  strictAll: boolean;
  lineLevelAll: boolean;
  /** Entries from the page's "not to be taken" block that came back, correctly marked. */
  stoppedMarked: string[];
  /**
   * The failure this file exists to catch: a drug the page says was stopped, returned as one to
   * take — or a discharge medicine marked as stopped, which would silently drop it from the plan.
   */
  dangerous: string[];
  /** Indices into `reading.medicines` that belong to the stopped block, marked or not. */
  stoppedIndices: number[];
}

/** Candidate quality for alignment; 0 means "a different drug", never a candidate. */
function matchScore(t: TruthMedicine, r: Medicine): number {
  const tn = loose(t.name);
  const rn = loose(r.name);
  let score = 0;
  if (tn === rn) score += 4;
  else if (tn.length > 0 && rn.length > 0 && (tn.includes(rn) || rn.includes(tn))) score += 2;
  else return 0;
  if (t.strength !== null && same(t.strength, r.strength)) score += 2;
  else if (t.strength !== null && loose(t.strength) === loose(r.strength)) score += 1;
  if (t.amount !== null && loose(t.amount) === loose(r.amount)) score += 1;
  if (t.frequency !== null && loose(t.frequency) === loose(r.frequency)) score += 1;
  return score;
}

/**
 * Greedy best-match by drug, so a dropped or an extra row costs one MISSING or one INVENTED
 * instead of shifting every later comparison. Truth items are taken in printed order and the
 * strength tie-break is what keeps the two Furosemide rows apart.
 */
function alignMedicines(
  truth: TruthMedicine[],
  returned: Medicine[],
  taken: ReadonlySet<number> = new Set(),
): { pairs: Array<{ t: number; r: number | null }>; used: Set<number> } {
  const used = new Set<number>();
  const pairs: Array<{ t: number; r: number | null }> = [];
  for (let ti = 0; ti < truth.length; ti += 1) {
    let best = -1;
    let bestScore = 0;
    for (let ri = 0; ri < returned.length; ri += 1) {
      if (used.has(ri) || taken.has(ri)) continue;
      const score = matchScore(truth[ti], returned[ri]);
      if (score > bestScore) {
        bestScore = score;
        best = ri;
      }
    }
    if (best >= 0) used.add(best);
    pairs.push({ t: ti, r: best >= 0 ? best : null });
  }
  return { pairs, used };
}

/**
 * Aligns twice. The discharge list goes first, so a page that prints the same drug on both lists
 * (dense: "Metformin XR reduced from 1000mg daily to 750mg daily") pairs the current dose with the
 * current entry and leaves any duplicate to the second pass. Only what neither pass claims is
 * INVENTED.
 */
function scoreMedicines(truth: Truth, reading: SheetReading): MedicineScore {
  const { pairs, used } = alignMedicines(truth.medicines, reading.medicines);
  const stoppedTruth = truth.stoppedMedicines ?? [];
  const stopped = alignMedicines(stoppedTruth, reading.medicines, used);
  const claimed = new Set([...used, ...stopped.used]);

  const score: MedicineScore = {
    expected: truth.medicines.length,
    returned: reading.medicines.length,
    matched: 0,
    missing: [],
    invented: reading.medicines
      .map((_, i) => i)
      .filter((i) => !claimed.has(i))
      .map((i) => `${trimmed(reading.medicines[i].name)} ${trimmed(reading.medicines[i].strength)}`.trim()),
    strictMisses: [],
    lostValues: [],
    guessed: [],
    admitted: 0,
    fieldsChecked: 0,
    fieldsStrict: 0,
    strictAll: false,
    lineLevelAll: false,
    stoppedMarked: [],
    dangerous: [],
    stoppedIndices: [...stopped.used].sort((a, b) => a - b),
  };

  // A line off the "not to be taken" block. Never scored for verbatim fields — the page prints it
  // as prose, and the only questions that matter are whether it is marked and whether it is planned.
  for (const { t, r } of stopped.pairs) {
    if (r === null) continue;
    const label = `${stoppedTruth[t].name} ${stoppedTruth[t].strength ?? ""}`.trim();
    const actual = statusOf(reading.medicines[r]);
    if (actual === "current") {
      score.dangerous.push(`"${label}" is printed as not to be taken but came back status "current"`);
    } else {
      score.stoppedMarked.push(`${label} → ${actual}`);
    }
  }

  for (const { t, r } of pairs) {
    const expected = truth.medicines[t];
    const label = `${expected.name} ${expected.strength ?? ""}`.trim();
    if (r === null) {
      score.missing.push(label);
      continue;
    }
    score.matched += 1;
    const actual = reading.medicines[r];
    const wantStatus = expected.status ?? "current";
    if (statusOf(actual) !== wantStatus) {
      score.dangerous.push(
        `"${label}" is on the discharge list but came back status "${statusOf(actual)}"`,
      );
    }
    const joined = MEDICINE_FIELDS.map((f) => trimmed(actual[f])).join(" | ");

    for (const field of MEDICINE_FIELDS) {
      const want = expected[field];
      const got = trimmed(actual[field]);

      if (want === UNREADABLE) {
        if (got.length === 0) score.admitted += 1;
        else score.guessed.push({ drug: label, field, expected: "(covered — expected null)", actual: got });
        continue;
      }

      score.fieldsChecked += 1;
      if (same(want, got)) {
        score.fieldsStrict += 1;
        continue;
      }
      score.strictMisses.push({ drug: label, field, expected: trimmed(want), actual: got });
      // Line level: did the printed value survive anywhere among the five fields?
      if (want !== null && want.length > 0 && !contains(joined, want)) {
        score.lostValues.push({ drug: label, field, expected: trimmed(want), actual: joined });
      }
      if (want === null && got.length > 0) {
        score.lostValues.push({ drug: label, field, expected: "(not printed)", actual: got });
      }
    }
  }

  score.strictAll =
    score.missing.length === 0 && score.invented.length === 0 && score.strictMisses.length === 0;
  score.lineLevelAll =
    score.missing.length === 0 && score.invented.length === 0 && score.lostValues.length === 0;
  return score;
}

interface Leak {
  group: string;
  marker: string;
  where: string;
}

/** Every generated or copied string in a reading, labelled by where it came from. */
function fields(reading: SheetReading): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  const push = (where: string, text: string | null | undefined): void => {
    if (typeof text === "string" && text.trim().length > 0) out.push({ where, text });
  };
  const spoken = (where: string, s: Speakable | null | undefined): void => {
    if (!s) return;
    push(`${where}.yue`, s.yue);
    push(`${where}.cmn`, s.cmn);
    push(`${where}.en`, s.en);
  };

  reading.medicines.forEach((m, i) => {
    for (const field of MEDICINE_FIELDS) push(`medicines[${i}].${field}`, m[field]);
    spoken(`medicines[${i}].spoken`, m.spoken);
    push(`medicines[${i}].source.section`, m.source?.section);
    push(`medicines[${i}].source.quote`, m.source?.quote);
  });
  reading.followUp.forEach((f, i) => {
    push(`followUp[${i}].clinic`, f.clinic);
    push(`followUp[${i}].when`, f.when);
    push(`followUp[${i}].tests`, f.tests);
    spoken(`followUp[${i}].spoken`, f.spoken);
    push(`followUp[${i}].source.quote`, f.source?.quote);
  });
  reading.warningSigns.forEach((w, i) => {
    spoken(`warningSigns[${i}].symptom`, w.symptom);
    spoken(`warningSigns[${i}].action`, w.action);
    push(`warningSigns[${i}].source.quote`, w.source?.quote);
  });
  push("dietLine.raw", reading.dietLine?.raw);
  spoken("dietLine.spoken", reading.dietLine?.spoken);
  push("dietLine.source.quote", reading.dietLine?.source?.quote);
  push("activityLine.text", reading.activityLine?.text);
  spoken("activityLine.spoken", reading.activityLine?.spoken);
  push("activityLine.source.quote", reading.activityLine?.source?.quote);
  push("hospitalContact.text", reading.hospitalContact?.text);
  spoken("hospitalContact.spoken", reading.hospitalContact?.spoken);
  reading.unreadable.forEach((u, i) => {
    push(`unreadable[${i}].section`, u.section);
    push(`unreadable[${i}].description`, u.description);
    push(`unreadable[${i}].source.quote`, u.source?.quote);
  });
  return out;
}

/**
 * A trap marker appearing anywhere in the reading. Markers exist nowhere else on that page.
 *
 * `stoppedIndices` are the medicine entries that came off the "not to be taken" block. Their own
 * fields are exempt: naming a stopped drug inside its own entry is now the intended output, and
 * whether that entry is safe is decided by `dangerous`, not by counting the same drug name as a
 * leak twenty-one times. Every other field on the page is scanned exactly as before.
 */
function findLeaks(truth: Truth, reading: SheetReading, stoppedIndices: number[] = []): Leak[] {
  const exempt = stoppedIndices.map((i) => `medicines[${i}].`);
  const leaks: Leak[] = [];
  const all = fields(reading).filter(({ where }) => !exempt.some((p) => where.startsWith(p)));
  for (const [group, markers] of Object.entries(truth.traps)) {
    for (const marker of markers) {
      for (const { where, text } of all) {
        if (contains(text, marker)) leaks.push({ group, marker, where });
      }
    }
  }
  return leaks;
}

/**
 * The safety question the typed record exists to answer: does the plan the app would show ever
 * schedule a dose of something that is not a current discharge medicine?
 *
 * Runs the real `draftPlan` over the returned reading — no re-implementation — and matches its
 * items back to the medicines they came from by source quote, label and time, which is exactly the
 * triple `draftPlan` copies across. A hit here is the bug in `tests/eval/stress.md` reproducing.
 */
function planScheduledStopped(reading: SheetReading, stoppedIndices: number[]): string[] {
  const suspect = new Set(stoppedIndices);
  reading.medicines.forEach((m, i) => {
    if (statusOf(m) !== "current") suspect.add(i);
  });
  if (suspect.size === 0) return [];

  const items = draftPlan(reading).items.filter((item) => item.kind === "medicineTime");
  const found: string[] = [];
  for (const i of [...suspect].sort((a, b) => a - b)) {
    const m = reading.medicines[i];
    const label = trimmed(m.strength) ? `${m.name} ${m.strength}` : m.name;
    const hit = items.find(
      (item) =>
        item.label === label ||
        (item.source.quote.length > 0 && item.source.quote === m.source.quote),
    );
    if (hit) found.push(`${label} — planned as "${hit.when}" (status "${statusOf(m)}")`);
  }
  return found;
}

interface UnreadableScore {
  expected: number;
  flagged: number;
  returnedCount: number;
  missed: string[];
}

function scoreUnreadable(truth: Truth, reading: SheetReading): UnreadableScore {
  const blob = reading.unreadable
    .map((u) => `${u.section} ${u.description} ${u.source?.quote ?? ""}`)
    .join("   ");
  const missed: string[] = [];
  let flagged = 0;
  for (const region of truth.unreadable) {
    const needles = region.matchAny ?? [region.section];
    if (needles.some((n) => contains(blob, n))) flagged += 1;
    else missed.push(`${region.section} — ${region.what}`);
  }
  return {
    expected: truth.unreadable.length,
    flagged,
    returnedCount: reading.unreadable.length,
    missed,
  };
}

interface RunScore {
  sheetTypeOk: boolean;
  actualSheetType: string;
  medicines: MedicineScore;
  warningsExpected: number;
  warningsQuoted: number;
  warningsMissed: string[];
  warningsReturned: number;
  dietOk: boolean;
  dietActual: string;
  activityOk: boolean;
  activityActual: string;
  followUpExpected: number;
  followUpReturned: number;
  followUpMisses: FieldMiss[];
  /** handwritten only: every ink value found, and no struck-through printed value used. */
  inkFound: string[];
  inkMissed: string[];
  struckThroughUsed: string[];
  unreadable: UnreadableScore;
  leaks: Leak[];
  /** Medicines the app's own `draftPlan` would schedule despite the page having stopped them. */
  planScheduledStopped: string[];
  /** How many cards `/api/read` marked as not matching their own source quote (api path only). */
  unverifiedCards: number;
  bannedHits: number;
  bannedWhere: string[];
}

function scoreRun(truth: Truth, reading: SheetReading, cards: Card[]): RunScore {
  const quotes = [
    ...reading.warningSigns.map((w) => w.source?.quote ?? ""),
    ...reading.warningSigns.flatMap((w) => [w.symptom.en, w.symptom.cmn, w.symptom.yue]),
  ].join("   ");
  const warningsMissed = truth.warningSigns.filter((line) => !contains(quotes, line));

  const followUpMisses: FieldMiss[] = [];
  const shared = Math.min(truth.followUp.length, reading.followUp.length);
  for (let i = 0; i < shared; i += 1) {
    for (const field of ["clinic", "when", "tests"] as const) {
      if (!same(truth.followUp[i][field], reading.followUp[i][field])) {
        followUpMisses.push({
          drug: `followUp[${i}]`,
          field,
          expected: trimmed(truth.followUp[i][field]),
          actual: trimmed(reading.followUp[i][field]),
        });
      }
    }
  }

  const everything = fields(reading)
    .map((f) => f.text)
    .join("   ");
  const inkFound: string[] = [];
  const inkMissed: string[] = [];
  for (const value of truth.handwrittenValues ?? []) {
    if (contains(everything, value)) inkFound.push(value);
    else inkMissed.push(value);
  }
  const struckThroughUsed: string[] = [];
  for (const med of truth.medicines) {
    if (!med.supersededPrinted || !med.handwritten) continue;
    const printed = med.supersededPrinted.split(" (")[0];
    const returned = reading.medicines.find((m) => loose(m.name) === loose(med.name));
    const field = med.handwritten as MedicineField;
    if (returned && same(printed, returned[field])) {
      struckThroughUsed.push(`${med.name}.${med.handwritten} = "${printed}" (the crossed-out value)`);
    }
  }

  const banned = scanBanned(reading, cards);
  const medicines = scoreMedicines(truth, reading);

  return {
    sheetTypeOk: reading.sheetType === truth.expectedSheetType,
    actualSheetType: reading.sheetType,
    medicines,
    warningsExpected: truth.warningSigns.length,
    warningsQuoted: truth.warningSigns.length - warningsMissed.length,
    warningsMissed,
    warningsReturned: reading.warningSigns.length,
    dietOk: same(truth.dietLine, reading.dietLine?.raw),
    dietActual: trimmed(reading.dietLine?.raw),
    activityOk: same(truth.activityLine, reading.activityLine?.text),
    activityActual: trimmed(reading.activityLine?.text),
    followUpExpected: truth.followUp.length,
    followUpReturned: reading.followUp.length,
    followUpMisses,
    inkFound,
    inkMissed,
    struckThroughUsed,
    unreadable: scoreUnreadable(truth, reading),
    leaks: findLeaks(truth, reading, medicines.stoppedIndices),
    planScheduledStopped: planScheduledStopped(reading, medicines.stoppedIndices),
    unverifiedCards: cards.filter((card) => card.unverified === true).length,
    bannedHits: banned.hits,
    bannedWhere: banned.where,
  };
}

/* -------------------------------------------------------------------------- */
/* One read — through the server                                              */
/* -------------------------------------------------------------------------- */

interface Outcome {
  reading: SheetReading | null;
  cards: Card[];
  msToFirstCard: number | null;
  msToDone: number | null;
  regenerated: number;
  templated: number;
  error: string | null;
}

interface ReadEventShape {
  event?: string;
  card?: Card;
  reading?: StoredReading;
  filter?: { regenerated?: number; templated?: number };
  error?: string;
}

/** Posts one image to `/api/read` and consumes the NDJSON stream to its end (contracts/api-read.md). */
async function readViaApi(base: string, truth: Truth, base64: string): Promise<Outcome> {
  const out: Outcome = {
    reading: null,
    cards: [],
    msToFirstCard: null,
    msToDone: null,
    regenerated: 0,
    templated: 0,
    error: null,
  };
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${base}/api/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [{ mediaType: truth.mediaType, base64 }] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    out.error = `request failed: ${(error as Error).message.split("\n")[0].slice(0, 140)}`;
    return out;
  }

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    out.error = `http ${response.status} ${body.slice(0, 120)}`;
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

  if (!out.reading && !out.error) out.error = "stream ended without a done event";
  return out;
}

/* -------------------------------------------------------------------------- */
/* One read — straight at the model layer                                     */
/* -------------------------------------------------------------------------- */

interface Reader {
  readSheet(images: Array<{ mediaType: "image/png" | "image/jpeg"; base64: string }>): Promise<{
    reading: SheetReading;
    usage: { ms: number; inputTokens: number; outputTokens: number; model: string };
  }>;
}

/**
 * Restarting the dev server to swap `MODEL_READ` is not available here, so the second model is
 * compared by constructing the provider directly with `modelRead` set. Same system prompt, same
 * schema, same effort — the only difference is the model id. No pipeline runs on this path, so the
 * spoken text is raw model output and the banned-term count is pre-filter.
 */
async function readDirect(reader: Reader, truth: Truth, base64: string): Promise<Outcome> {
  const startedAt = Date.now();
  try {
    const { reading, usage } = await reader.readSheet([
      { mediaType: truth.mediaType, base64 },
    ]);
    return {
      reading,
      cards: [],
      msToFirstCard: null,
      msToDone: usage.ms || Date.now() - startedAt,
      regenerated: 0,
      templated: 0,
      error: null,
    };
  } catch (error) {
    const err = error as { code?: string; message?: string };
    return {
      reading: null,
      cards: [],
      msToFirstCard: null,
      msToDone: Date.now() - startedAt,
      regenerated: 0,
      templated: 0,
      error: `${err.code ?? "error"}: ${(err.message ?? "").slice(0, 140)}`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Records and rows                                                           */
/* -------------------------------------------------------------------------- */

interface RunRecord {
  sheet: SheetId;
  path: string;
  run: number;
  ok: boolean;
  error: string | null;
  msToFirstCard: number | null;
  msToDone: number | null;
  regenerated: number;
  templated: number;
  score: RunScore | null;
}

interface Row {
  sheet: string;
  path: string;
  runs: number;
  ok: number;
  strictRate: number;
  lineRate: number;
  fieldRate: number;
  invented: number;
  missing: number;
  guessed: number;
  /** Stopped-block entries returned as a dose to take, plus any planned. The safety headline. */
  dangerous: number;
  planned: number;
  stoppedMarked: number;
  unverified: number;
  unreadableOk: number;
  leaks: number;
  bannedHits: number;
  warningCoverage: number;
  dietOk: number;
  p50FirstCard: number | null;
  p95FirstCard: number | null;
  p50Done: number | null;
  p95Done: number | null;
}

function summarise(records: RunRecord[]): Row[] {
  const order: string[] = [];
  const groups = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = `${record.sheet} ${record.path}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)?.push(record);
  }

  return order.map((key) => {
    const own = groups.get(key) ?? [];
    const [sheet, path] = key.split(" ");
    const done = own.filter((r) => r.score !== null);
    const scores = done.map((r) => r.score as RunScore);
    const firstCard = own.map((r) => r.msToFirstCard).filter((v): v is number => v !== null);
    const toDone = own.map((r) => r.msToDone).filter((v): v is number => v !== null);
    const checked = scores.reduce((s, x) => s + x.medicines.fieldsChecked, 0);
    const strict = scores.reduce((s, x) => s + x.medicines.fieldsStrict, 0);

    return {
      sheet,
      path,
      runs: own.length,
      ok: done.length,
      strictRate: scores.length === 0 ? 0 : scores.filter((s) => s.medicines.strictAll).length / scores.length,
      lineRate: scores.length === 0 ? 0 : scores.filter((s) => s.medicines.lineLevelAll).length / scores.length,
      fieldRate: checked === 0 ? 0 : strict / checked,
      invented: scores.reduce((s, x) => s + x.medicines.invented.length, 0),
      missing: scores.reduce((s, x) => s + x.medicines.missing.length, 0),
      guessed: scores.reduce((s, x) => s + x.medicines.guessed.length, 0),
      dangerous: scores.reduce((s, x) => s + x.medicines.dangerous.length, 0),
      planned: scores.reduce((s, x) => s + x.planScheduledStopped.length, 0),
      stoppedMarked: scores.reduce((s, x) => s + x.medicines.stoppedMarked.length, 0),
      unverified: scores.reduce((s, x) => s + x.unverifiedCards, 0),
      unreadableOk: scores.filter((s) => s.unreadable.flagged === s.unreadable.expected).length,
      leaks: scores.reduce((s, x) => s + x.leaks.length, 0),
      bannedHits: scores.reduce((s, x) => s + x.bannedHits, 0),
      warningCoverage:
        scores.length === 0
          ? 0
          : scores.reduce(
              (s, x) => s + (x.warningsExpected === 0 ? 1 : x.warningsQuoted / x.warningsExpected),
              0,
            ) / scores.length,
      dietOk: scores.filter((s) => s.dietOk).length,
      p50FirstCard: percentile(firstCard, 50),
      p95FirstCard: percentile(firstCard, 95),
      p50Done: percentile(toDone, 50),
      p95Done: percentile(toDone, 95),
    };
  });
}

const COLUMNS = [
  "sheet",
  "path",
  "runs",
  "ok",
  "strict",
  "line",
  "field",
  "inv",
  "miss",
  "guess",
  "danger",
  "planned",
  "stopmk",
  "unver",
  "unread",
  "leak",
  "warn",
  "diet",
  "ban",
  "p50",
  "p95",
] as const;

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function ms(value: number | null): string {
  return value === null ? "-" : `${(value / 1000).toFixed(1)}s`;
}

function cells(row: Row): string[] {
  return [
    row.sheet,
    row.path,
    String(row.runs),
    String(row.ok),
    pct(row.strictRate),
    pct(row.lineRate),
    pct(row.fieldRate),
    String(row.invented),
    String(row.missing),
    String(row.guessed),
    String(row.dangerous),
    String(row.planned),
    String(row.stoppedMarked),
    String(row.unverified),
    `${row.unreadableOk}/${row.ok}`,
    String(row.leaks),
    pct(row.warningCoverage),
    `${row.dietOk}/${row.ok}`,
    String(row.bannedHits),
    ms(row.p50Done),
    ms(row.p95Done),
  ];
}

function printTable(rows: Row[]): void {
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

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function flag(argv: string[], name: string): string | undefined {
  const i = argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  const arg = argv[i];
  return arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[i + 1];
}

/** `.env.local` is not loaded for a plain `tsx` run, and the direct path needs the API key. */
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

/* -------------------------------------------------------------------------- */
/* Findings                                                                   */
/* -------------------------------------------------------------------------- */

/** Every failure, with the offending string, so a fail is judgeable without a re-run. */
function findings(records: RunRecord[]): string[] {
  const lines: string[] = [];
  for (const record of records) {
    const label = `${record.sheet} / ${record.path} run ${record.run}`;
    if (record.error) {
      lines.push(`- ${label}: FAILED — ${record.error}`);
      continue;
    }
    const s = record.score;
    if (!s) continue;
    if (!s.sheetTypeOk) lines.push(`- ${label}: sheetType "${s.actualSheetType}"`);
    for (const name of s.medicines.missing) lines.push(`- ${label}: MISSING medicine "${name}"`);
    for (const name of s.medicines.invented) lines.push(`- ${label}: INVENTED medicine "${name}"`);
    for (const d of s.medicines.dangerous) lines.push(`- ${label}: DANGEROUS — ${d}`);
    for (const p of s.planScheduledStopped) {
      lines.push(`- ${label}: DANGEROUS — the plan schedules ${p}`);
    }
    for (const m of s.medicines.guessed) {
      lines.push(`- ${label}: GUESSED a covered field — ${m.drug}.${m.field} = "${m.actual}"`);
    }
    for (const m of s.medicines.strictMisses) {
      lines.push(`- ${label}: ${m.drug}.${m.field} expected "${m.expected}", got "${m.actual}"`);
    }
    for (const m of s.medicines.lostValues) {
      lines.push(`- ${label}: LOST VALUE ${m.drug}.${m.field} "${m.expected}" — fields were "${m.actual}"`);
    }
    for (const w of s.warningsMissed) lines.push(`- ${label}: warning not quoted — "${w}"`);
    if (!s.dietOk) lines.push(`- ${label}: dietLine got "${s.dietActual}"`);
    if (!s.activityOk) lines.push(`- ${label}: activityLine got "${s.activityActual}"`);
    for (const f of s.followUpMisses) {
      lines.push(`- ${label}: ${f.drug}.${f.field} expected "${f.expected}", got "${f.actual}"`);
    }
    for (const v of s.inkMissed) lines.push(`- ${label}: handwritten value never returned — "${v}"`);
    for (const v of s.struckThroughUsed) lines.push(`- ${label}: TOOK THE CROSSED-OUT VALUE — ${v}`);
    for (const u of s.unreadable.missed) lines.push(`- ${label}: covered region NOT flagged — ${u}`);
    for (const leak of s.leaks) {
      lines.push(`- ${label}: LEAK (${leak.group}) "${leak.marker}" in ${leak.where}`);
    }
    for (const where of s.bannedWhere) lines.push(`- ${label}: BANNED TERM in ${where}`);
  }
  return lines.length > 0 ? lines : ["- none"];
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  loadEnvLocal();

  const sheetsArg = flag(argv, "sheets") ?? "all";
  const sheets: SheetId[] =
    sheetsArg === "all"
      ? [...SHEET_IDS]
      : (sheetsArg.split(",").map((s) => s.trim()) as SheetId[]).filter((id) =>
          (SHEET_IDS as readonly string[]).includes(id),
        );
  if (sheets.length === 0) {
    console.error(`Unknown --sheets "${sheetsArg}". Known: ${SHEET_IDS.join(", ")}, or "all".`);
    process.exit(2);
  }

  const runs = Number(flag(argv, "runs") ?? 3);
  const base = (flag(argv, "base") ?? "http://localhost:3011").replace(/\/+$/, "");
  const mode = flag(argv, "mode") ?? "both";
  const models = (flag(argv, "models") ?? "claude-opus-5,claude-sonnet-5")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const out = flag(argv, "out");
  const dump = flag(argv, "dump");
  if (dump) mkdirSync(dump, { recursive: true });

  const paths: string[] = [];
  if (mode === "api" || mode === "both") paths.push("api");
  if (mode === "direct" || mode === "both") paths.push(...models.map((m) => `direct:${m}`));

  console.log("");
  console.log(`Stress eval — ${sheets.length} sheet(s) x ${runs} run(s) x ${paths.length} path(s)`);
  console.log(`Paths: ${paths.join(", ")}`);
  if (paths.includes("api")) console.log(`Server: ${base}`);
  console.log("");

  // Imported here, after `.env.local` is in `process.env`, because the module reads
  // READ_EFFORT at load time and the SDK resolves ANTHROPIC_API_KEY when it is constructed.
  const readers = new Map<string, Reader>();
  if (paths.some((p) => p.startsWith("direct:"))) {
    const { AnthropicProvider } = await import("@/lib/model/client");
    for (const model of models) {
      readers.set(model, new AnthropicProvider({ modelRead: model }) as Reader);
    }
  }

  const records: RunRecord[] = [];

  for (const id of sheets) {
    const truth = loadTruth(id);
    const base64 = readFileSync(join(STRESS_DIR, truth.file)).toString("base64");

    for (const path of paths) {
      for (let run = 1; run <= runs; run += 1) {
        const outcome =
          path === "api"
            ? await readViaApi(base, truth, base64)
            : await readDirect(readers.get(path.slice("direct:".length)) as Reader, truth, base64);

        const score = outcome.reading ? scoreRun(truth, outcome.reading, outcome.cards) : null;
        if (dump && outcome.reading) {
          writeFileSync(
            join(dump, `${id}.${path.replace(/[:/]/g, "-")}.${run}.json`),
            JSON.stringify({ reading: outcome.reading, cards: outcome.cards }, null, 2),
            "utf8",
          );
        }
        records.push({
          sheet: id,
          path,
          run,
          ok: outcome.reading !== null,
          error: outcome.error,
          msToFirstCard: outcome.msToFirstCard,
          msToDone: outcome.msToDone,
          regenerated: outcome.regenerated,
          templated: outcome.templated,
          score,
        });

        const verdict = outcome.error
          ? `FAIL ${outcome.error}`
          : `strict ${score?.medicines.strictAll ? "ok " : "no "} ` +
            `fields ${score?.medicines.fieldsStrict}/${score?.medicines.fieldsChecked} ` +
            `inv ${score?.medicines.invented.length} miss ${score?.medicines.missing.length} ` +
            `danger ${(score?.medicines.dangerous.length ?? 0) + (score?.planScheduledStopped.length ?? 0)} ` +
            `stopmk ${score?.medicines.stoppedMarked.length} unver ${score?.unverifiedCards} ` +
            `leak ${score?.leaks.length} ban ${score?.bannedHits}`;
        console.log(
          `  ${id.padEnd(11)} ${path.padEnd(21)} ${run}/${runs}  ` +
            `${ms(outcome.msToFirstCard).padStart(6)} card ${ms(outcome.msToDone).padStart(6)} done  ${verdict}`,
        );
      }
    }
  }

  const rows = summarise(records);
  printTable(rows);

  console.log("Findings:");
  for (const line of findings(records)) console.log(line);
  console.log("");

  if (out) {
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows, records }, null, 2), "utf8");
    console.log(`Wrote ${out}`);
  }
}

// Exit explicitly: `fetch`'s pooled keep-alive sockets hold the process open otherwise
// (same reason as tests/eval/reading.ts).
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
