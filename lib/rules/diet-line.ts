/**
 * T011 — the diet-line recogniser (FR-025, constitution principles I and III).
 *
 * Rules decide, the model does not: `DietLine.recognisedType` is computed here from the printed
 * `raw` line, never taken from a model output. What we add for a recognised type is ONE fixed
 * plain sentence that restates the instruction in everyday words. It never advises, never sets a
 * number about the person, and never uses 診斷/治療/處方/治癒/能吃/不能吃/唔食得/建議你 or their
 * English counterparts on the banned list.
 *
 * Safety lock: a specialised diet (low protein / renal / liquid / soft / tube feeding) is always
 * `other`, even when the same line also says "low salt" — those diets carry restrictions this app
 * has no business unpacking, so it adds nothing at all.
 *
 * Combined lines (低盐低脂饮食, "Low salt, low fat") are deterministic: `recogniseDietAll` returns
 * every recognised type in order of first appearance in the line, and `recogniseDiet` returns the
 * first of those — so the primary type of 低盐低脂 is always `low_salt` and of 低脂低盐 always
 * `low_fat`. Ties (impossible with the current markers) break in DIET_MARKERS order.
 */
import type { DietType, SheetReading, Speakable, StoredReading } from "@/lib/domain/schemas";

/**
 * Specialised diets that lock the food features. Any hit forces `other`, whatever else the line
 * says. Matched against the normalised line, so "low-protein" and "low protein" both hit.
 */
const SPECIALISED_MARKERS: readonly string[] = [
  "低蛋白",
  "low protein",
  "腎",
  "肾",
  "renal",
  "kidney",
  "流質",
  "流质",
  "軟食",
  "软食",
  "鼻飼",
  "鼻饲",
];

/** Recognised markers per type. Order here is the tie-break order. */
const DIET_MARKERS: ReadonlyArray<readonly [Exclude<DietType, "other">, readonly string[]]> = [
  [
    "low_salt",
    ["低鹽", "低盐", "少鹽", "少盐", "低鈉", "低钠", "限鹽", "限盐", "low salt", "low sodium", "salt restricted"],
  ],
  ["low_fat", ["低脂", "少油", "低油", "low fat", "low oil"]],
  [
    "diabetic",
    ["糖尿病飲食", "糖尿病饮食", "糖尿飲食", "糖尿饮食", "dm diet", "diabetic diet", "diabetes diet"],
  ],
  ["light", ["清淡"]],
];

/**
 * Lower-cases and flattens hyphen-like separators to spaces. Every replacement is one character
 * for one character, so indices in the result still point at the same place in `raw` — that is
 * what makes "order of appearance" meaningful.
 */
function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[-_‐-―－　]/g, " ");
}

/**
 * Every recognised diet type in the line, in order of first appearance. Empty when nothing is
 * recognised, when the line is a specialised diet, or when `raw` is missing.
 */
export function recogniseDietAll(raw: string | null | undefined): DietType[] {
  if (!raw) return [];
  const line = normalise(raw);
  if (SPECIALISED_MARKERS.some((m) => line.includes(normalise(m)))) return [];

  const hits: { type: DietType; at: number; rank: number }[] = [];
  DIET_MARKERS.forEach(([type, markers], rank) => {
    let at = -1;
    for (const marker of markers) {
      const i = line.indexOf(normalise(marker));
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at >= 0) hits.push({ type, at, rank });
  });

  return hits.sort((a, b) => a.at - b.at || a.rank - b.rank).map((h) => h.type);
}

/**
 * The primary recognised type of a printed diet line. `other` for anything not in the recognised
 * set, for specialised diets, and for a missing line.
 */
export function recogniseDiet(raw: string | null | undefined): DietType {
  return recogniseDietAll(raw)[0] ?? "other";
}

/** One label and one clause per recognised type; the sentence is assembled from these. */
const DIET_FRAGMENTS: Record<Exclude<DietType, "other">, { label: Speakable; clause: Speakable }> = {
  low_salt: {
    label: { yue: "少鹽", cmn: "少盐", en: "less salt" },
    clause: {
      yue: "煮嘢少落鹽同醬油",
      cmn: "做菜少放盐和酱油",
      en: "go easy on the salt and soy sauce when cooking",
    },
  },
  low_fat: {
    label: { yue: "少油", cmn: "少油", en: "less oil" },
    clause: { yue: "少煎炸", cmn: "少煎炸", en: "less frying" },
  },
  diabetic: {
    label: { yue: "少糖", cmn: "少糖", en: "less sugar" },
    clause: {
      yue: "少食甜嘢同甜飲品，三餐定時",
      cmn: "少吃甜食和含糖饮料，三餐定时",
      en: "fewer sweet things and sugary drinks, and meals at regular times",
    },
  },
  light: {
    label: { yue: "清淡", cmn: "清淡", en: "plain cooking" },
    clause: {
      yue: "少油、少鹽、少糖",
      cmn: "少油、少盐、少糖",
      en: "less oil, less salt, less sugar",
    },
  },
};

/** 清淡 on its own gets its own fixed sentence: it means less oil/salt/sugar, not less meat. */
const LIGHT_ONLY_SENTENCE: Speakable = {
  yue: "清淡係少油、少鹽、少糖，唔係唔食肉。",
  cmn: "清淡就是少油、少盐、少糖，没有说要戒肉。",
  en: "Plain cooking means less oil, less salt and less sugar. It doesn't mean giving up meat.",
};

/** "a and b" for two, "a, b and c" for more — an English list that reads aloud without a stumble. */
function listEn(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The one fixed plain sentence for a set of recognised types, in all three spoken forms. `null`
 * for an empty set and for any set containing `other` — an unrecognised or specialised instruction
 * gets nothing added (FR-025).
 */
export function dietPlainSentence(types: DietType[]): Speakable | null {
  if (types.length === 0 || types.includes("other")) return null;

  const seen: Exclude<DietType, "other">[] = [];
  for (const t of types) {
    if (t !== "other" && !seen.includes(t)) seen.push(t);
  }
  if (seen.length === 0) return null;
  if (seen.length === 1 && seen[0] === "light") return LIGHT_ONLY_SENTENCE;

  const labels = (d: keyof Speakable) => seen.map((t) => DIET_FRAGMENTS[t].label[d]).join("");
  const clauses = (d: keyof Speakable) => seen.map((t) => DIET_FRAGMENTS[t].clause[d]).join("，");

  return {
    yue: `即係${labels("yue")}：${clauses("yue")}。冇話要戒肉。`,
    cmn: `就是${labels("cmn")}：${clauses("cmn")}。没有说要戒肉。`,
    en: `That means ${listEn(seen.map((t) => DIET_FRAGMENTS[t].label.en))}: ${seen
      .map((t) => DIET_FRAGMENTS[t].clause.en)
      .join(", ")}. Nothing there says to give up meat.`,
  };
}

/**
 * Runs the diet rules over a reading and returns the stored diet line: `recognisedType` set from
 * the printed line, and the plain sentence appended to the spoken text when there is one.
 * Idempotent — re-running never appends the sentence twice.
 */
export function applyDietRules(reading: SheetReading): StoredReading["dietLine"] {
  const line = reading.dietLine;
  if (!line) return null;

  const types = recogniseDietAll(line.raw);
  const recognisedType: DietType = types[0] ?? "other";
  const plain = dietPlainSentence(types);
  const spoken: Speakable = plain
    ? {
        yue: line.spoken.yue.includes(plain.yue) ? line.spoken.yue : `${line.spoken.yue} ${plain.yue}`,
        cmn: line.spoken.cmn.includes(plain.cmn) ? line.spoken.cmn : `${line.spoken.cmn} ${plain.cmn}`,
        en: line.spoken.en.includes(plain.en) ? line.spoken.en : `${line.spoken.en} ${plain.en}`,
      }
    : line.spoken;

  return { raw: line.raw, spoken, source: line.source, recognisedType };
}
