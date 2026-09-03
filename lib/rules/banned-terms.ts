/**
 * Banned-term filter (constitution VI: banned words are enforced, not requested; III: rules decide).
 *
 * Pure and deterministic: no I/O, no model, no clock. Every generated string passes through
 * `checkText` / `checkSpeakable` / `checkCard` before it is shown or spoken. Verbatim page text
 * (`SourceReference.quote`) is never checked — see `isExemptQuote` and research.md R14.
 *
 * Matching happens on `normalise(text)`, so the reported matches are in normalised form
 * (NFKC, single spaces, half-width punctuation where a full-width form has a half-width twin).
 */
import type { Card, Speakable } from "@/lib/domain/schemas";

/** The three groups of research.md R14. */
export type BannedGroup = "zh" | "en" | "numeric";

export interface BannedRule {
  /** Stable id, useful for logs and for telling the phrase route what to avoid. */
  readonly id: string;
  /** Human-readable name for the submission document. */
  readonly label: string;
  readonly group: BannedGroup;
  /** Always carries the `g` flag so `String.matchAll` can be used. */
  readonly pattern: RegExp;
}

/**
 * Chinese terms, in traditional and simplified script. A health verb after 建議你 / 應該 is what
 * turns a neutral sentence into advice about the person, so those two are pattern rules.
 */
const ZH_RULES: readonly BannedRule[] = [
  { id: "zh.diagnose", label: "診斷 / 诊断 (diagnose)", group: "zh", pattern: /診斷|诊断/g },
  { id: "zh.treat", label: "治療 / 治疗 (treat)", group: "zh", pattern: /治療|治疗/g },
  { id: "zh.prescribe", label: "處方 / 处方 (prescribe)", group: "zh", pattern: /處方|处方/g },
  { id: "zh.cure", label: "治癒 / 治愈 (cure)", group: "zh", pattern: /治癒|治愈/g },
  { id: "zh.canEat", label: "能吃 (can eat)", group: "zh", pattern: /能吃/g },
  { id: "zh.cannotEat", label: "不能吃 (cannot eat)", group: "zh", pattern: /不能吃/g },
  { id: "zh.cannotEatYue", label: "唔食得 (cannot eat, Cantonese)", group: "zh", pattern: /唔食得/g },
  {
    id: "zh.eatYue",
    label: "食得 next to 唔 (can/cannot eat, Cantonese)",
    group: "zh",
    pattern: /唔\s*食得|食得\s*唔/g,
  },
  {
    id: "zh.suggestYou",
    label: "建議你 / 建议你 + a health verb (advice to the person)",
    group: "zh",
    pattern: /(?:建議你|建议你)\s*[^。]{0,4}?(?:食|吃|服|停|飲|饮|用|減|减|加|做)/g,
  },
  {
    id: "zh.shouldEat",
    label: "應該 / 应该 + 食 / 吃 / 服 / 停 (advice to the person)",
    group: "zh",
    pattern: /(?:應該|应该)\s*[^。]{0,4}?(?:食|吃|服|停)/g,
  },
  { id: "zh.stopMed", label: "停藥 / 停药 (stop the medicine)", group: "zh", pattern: /停藥|停药/g },
  { id: "zh.addMed", label: "加藥 / 加药 (add medicine)", group: "zh", pattern: /加藥|加药/g },
  { id: "zh.reduceMed", label: "減藥 / 减药 (reduce medicine)", group: "zh", pattern: /減藥|减药/g },
];

/**
 * English terms, case-insensitive and word-bounded. "Treatment and Outcome" is a real section
 * heading on Hong Kong sheets, so `treat` carries a negative lookahead for it; anywhere else the
 * word is still banned.
 */
const EN_RULES: readonly BannedRule[] = [
  { id: "en.diagnose", label: "diagnos* (diagnose, diagnosis, diagnosed)", group: "en", pattern: /\bdiagnos\w*/gi },
  {
    id: "en.treat",
    label: 'treat* (except the section heading "Treatment and Outcome")',
    group: "en",
    pattern: /\btreat(?!ment and outcome)\w*/gi,
  },
  { id: "en.cure", label: "cure* (cure, cures, cured)", group: "en", pattern: /\bcure\w*/gi },
  { id: "en.prescribe", label: "prescri* (prescribe, prescription)", group: "en", pattern: /\bprescri\w*/gi },
  { id: "en.youShould", label: '"you should"', group: "en", pattern: /\byou should\b/gi },
  { id: "en.youMust", label: '"you must"', group: "en", pattern: /\byou must\b/gi },
  { id: "en.safeToEat", label: '"safe to eat"', group: "en", pattern: /\bsafe to eat\b/gi },
  { id: "en.cannotEat", label: '"cannot eat"', group: "en", pattern: /\bcannot eat\b/gi },
  { id: "en.canEat", label: '"can eat"', group: "en", pattern: /\bcan eat\b/gi },
];

/**
 * Numeric targets about the person. A medicine strength ("5mg", "0.5g", "20mg 1 tab nocte") is a
 * fact about the medicine and must NOT match: every rule here needs a rate ("per kg", "/day"), an
 * explicit requirement ("每天需要 … 60"), or a reading unit (mmol, mg/dL, kcal).
 *
 * The blood-pressure rules guard the digit run on both sides so a date such as "2026/09/15" cannot
 * be read as a 120/80-shaped pair.
 */
const NUMERIC_RULES: readonly BannedRule[] = [
  {
    id: "num.perWeightOrDay",
    label: "grams or milligrams per kilogram / per day (e.g. 2 克/日)",
    group: "numeric",
    pattern: /\d+(?:\.\d+)?\s*(?:g|克|mg|毫克)\s*(?:\/|per|每)\s*(?:kg|公斤|日|天|day)/gi,
  },
  {
    id: "num.dailyRequirement",
    label: "每日 / 每天 + 要 / 需要 / 應該 / 应该 + a number (a daily target)",
    group: "numeric",
    pattern: /每(?:日|天)\s*(?:要|需要|應該|应该)\s*[^。]*\d/g,
  },
  {
    id: "num.bpAfterKeyword",
    label: "血壓 / 血压 / BP / target / 目標 / 目标 followed by a 120/80-shaped reading",
    group: "numeric",
    pattern: /(?:血壓|血压|BP|target|目標|目标)[^。\d]{0,12}\d{2,3}\s*\/\s*\d{2,3}(?!\d)/gi,
  },
  {
    id: "num.bpBeforeKeyword",
    label: "a 120/80-shaped reading followed by 血壓 / 血压 / BP / target / 目標 / 目标",
    group: "numeric",
    pattern: /(?:^|[^\d.])\d{2,3}\s*\/\s*\d{2,3}(?!\d)[^。\d]{0,12}(?:血壓|血压|BP|target|目標|目标)/gi,
  },
  {
    id: "num.glucoseMmol",
    label: "a mmol reading (glucose or cholesterol target)",
    group: "numeric",
    pattern: /\d+(?:\.\d+)?\s*mmol/gi,
  },
  {
    id: "num.glucoseMgDl",
    label: "a mg/dL reading (glucose target)",
    group: "numeric",
    pattern: /\d+(?:\.\d+)?\s*mg\s*\/\s*dl/gi,
  },
  {
    id: "num.calories",
    label: "a calorie target (kcal / 卡路里 / 大卡)",
    group: "numeric",
    pattern: /\d+\s*(?:kcal|卡路里|大卡)/gi,
  },
];

/** The banned list, grouped as in research.md R14. */
export const BANNED_TERMS: {
  readonly zh: readonly BannedRule[];
  readonly en: readonly BannedRule[];
  readonly numeric: readonly BannedRule[];
} = { zh: ZH_RULES, en: EN_RULES, numeric: NUMERIC_RULES };

/** Every rule, in group order. */
export const ALL_BANNED_RULES: readonly BannedRule[] = [...ZH_RULES, ...EN_RULES, ...NUMERIC_RULES];

/** Human-readable term names, for the submission document's compliance section. */
export const BANNED_TERM_SUMMARY: string[] = ALL_BANNED_RULES.map((rule) => rule.label);

/** Zero-width joiners/spaces and the BOM, which would otherwise split a banned term. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
/** Slashes NFKC leaves alone: fraction slash, division slash, big solidus. */
const SLASH_LOOKALIKES = /[\u2044\u2215\u29F8]/g;

/**
 * Normalisation applied before matching: NFKC (full-width digits, letters and punctuation fold to
 * half-width; ㎎ folds to mg), zero-width characters dropped, slash look-alikes folded to "/",
 * runs of whitespace collapsed to one space. Ideographic punctuation (。、「」) is left alone —
 * 。 is used as a sentence boundary by several rules.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(SLASH_LOOKALIKES, "/")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CheckResult {
  /** True when nothing on the banned list matched. */
  ok: boolean;
  /** The matched substrings, normalised, de-duplicated, in rule order. */
  matches: string[];
}

/** Runs every rule over one string. */
export function checkText(text: string): CheckResult {
  const normalised = normalise(text);
  const matches: string[] = [];
  const seen = new Set<string>();
  for (const rule of ALL_BANNED_RULES) {
    for (const hit of normalised.matchAll(rule.pattern)) {
      const term = hit[0].trim();
      if (term.length === 0 || seen.has(term)) continue;
      seen.add(term);
      matches.push(term);
    }
  }
  return { ok: matches.length === 0, matches };
}

/**
 * Runs every rule over all three spoken forms of a line. English is not the easy case: the `en`
 * rules above exist precisely because "treats", "cure" and "you should" are the shapes an English
 * sentence slips into, so a `Speakable` whose Chinese halves are clean is not yet a clean line.
 */
export function checkSpeakable(s: Speakable): CheckResult {
  const matches = [
    ...new Set([...checkText(s.yue).matches, ...checkText(s.cmn).matches, ...checkText(s.en).matches]),
  ];
  return { ok: matches.length === 0, matches };
}

/**
 * Checks a card's generated body only. `card.source.quote` is verbatim page text and is never
 * checked — a sheet may legitimately print "Treatment and Outcome" or a drug name containing
 * "cure", and hiding that would break principle IV (everything traces to a line).
 */
export function checkCard(card: Card): CheckResult {
  return checkSpeakable(card.body);
}

/**
 * True when `text` is verbatim page content — i.e. it is (part of) `quote` — and is therefore
 * exempt from the filter. Generated text is never exempt, so callers must not pass model output
 * that merely resembles the quote: use this only to skip the quote field itself.
 */
export function isExemptQuote(text: string, quote: string | null | undefined): boolean {
  if (quote == null) return false;
  const q = normalise(quote);
  const t = normalise(text);
  if (q.length === 0 || t.length === 0) return false;
  return q.includes(t);
}
