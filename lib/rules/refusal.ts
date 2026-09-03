/**
 * Medicine-change refusal gate (FR-011, User Story 1 scenario 8).
 *
 * Constitution III: this is deterministic code, not a model judgement. `/api/ask` runs
 * `detectCrisis` first, then this; a hit answers with the fixed template
 * `REFUSED_MEDICINE_CHANGE` from `lib/rules/template-fallback.ts` (pharmacist + the contact line
 * printed on the sheet) and never reaches the model.
 *
 * What counts as a change: skipping, stopping, doubling up, adding something, changing the amount,
 * or moving a dose to another time. What does NOT count: asking what the sheet already prints —
 * timing as printed, what a medicine is, when the follow-up is, how many tablets were written.
 *
 * Bias: a false refusal costs one card ("ask the pharmacist"); a missed refusal is advice about
 * a medicine. Borderline phrasings therefore refuse.
 */
export type MedicineChangeReason =
  | "skip"
  | "stop"
  | "double"
  | "add"
  | "change_dose"
  | "timing_change";

export interface MedicineChangeResult {
  /** True when the question asks to change a medicine and must not reach the model. */
  refuse: boolean;
  /** Which kind of change was asked for; `null` when `refuse` is false. */
  reason: MedicineChangeReason | null;
  /** The normalised substring that matched; "" when nothing matched. */
  matched: string;
}

/**
 * Traditional → simplified for the characters used in the patterns below only. A local map, not
 * opencc: this gate must stay a pure, dependency-free function that behaves identically on the
 * client and on the server.
 */
const TRAD_TO_SIMP: Readonly<Record<string, string>> = {
  藥: "药",
  減: "减",
  換: "换",
  兩: "两",
  顆: "颗",
  過: "过",
  補: "补",
  晝: "昼",
  時: "时",
  劑: "剂",
  調: "调",
  點: "点",
  遲: "迟",
  隻: "只",
  種: "种",
  曬: "晒",
  飲: "饮",
  頓: "顿",
  後: "后",
  雙: "双",
  個: "个",
  幾: "几",
  麼: "么",
  嗎: "吗",
  覆: "复",
  診: "诊",
  開: "开",
  當: "当",
  維: "维",
  飯: "饭",
  臨: "临",
  鐘: "钟",
  數: "数",
  轉: "转",
  隨: "随",
  決: "决",
};

function toSimplified(text: string): string {
  let out = "";
  for (const ch of text) out += TRAD_TO_SIMP[ch] ?? ch;
  return out;
}

export interface NormalisedQuestion {
  /** Punctuation folded to single spaces; used for the English patterns (word boundaries). */
  spaced: string;
  /** `spaced` with every space removed; used for the Chinese patterns. */
  compact: string;
}

/**
 * NFKC (full-width → half-width), lower-cased, apostrophes dropped so "don't" → "dont",
 * every other punctuation or symbol folded to a space, runs of whitespace collapsed, then
 * traditional characters folded to simplified. Patterns are written against this form.
 */
export function normaliseQuestion(text: string): NormalisedQuestion {
  const spaced = toSimplified(text.normalize("NFKC").toLowerCase().replace(/['’`´]/g, ""))
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { spaced, compact: spaced.replace(/ /g, "") };
}

interface Rule {
  reason: MedicineChangeReason;
  /** `compact` for Chinese (spaces removed), `spaced` for English (word boundaries kept). */
  field: "compact" | "spaced";
  re: RegExp;
}

/**
 * Evaluated in order, so the group order below is the priority order:
 * double → add → timing_change → stop → skip → change_dose.
 *
 * Judgement calls encoded here:
 * - 加藥 / "add a medicine" = `add` (another medicine); 加多粒 / "take an extra one" = `double`
 *   (more of the same medicine at one time).
 * - 減藥 / 改藥 / 換藥 / switch / swap / halve = `change_dose` (the amount or the medicine
 *   itself changes); the refusal text is the same for every reason.
 * - "漏咗…補返" / "miss a dose … take two" = `double`, per the spec's wording.
 */
const RULES: readonly Rule[] = [
  // ---------------------------------------------------------------- double
  { reason: "double", field: "compact", re: /(食|吃|饮|服)(两|双)(粒|片|颗|次|包|排|支)/ },
  { reason: "double", field: "compact", re: /(食|吃|饮|服)多(一)?(粒|片|颗|次|剂|排)/ },
  { reason: "double", field: "compact", re: /多(食|吃|饮|服)(一)?(粒|片|颗|次|剂)/ },
  { reason: "double", field: "compact", re: /加多(一)?(粒|片|颗|次|剂)/ },
  { reason: "double", field: "compact", re: /一次(过)?(食|吃|饮|服)(晒|哂|完|埋)/ },
  { reason: "double", field: "compact", re: /一次(食|吃|饮|服)(两|双)次(的|嘅)?(量|份量|剂量|药量)/ },
  { reason: "double", field: "compact", re: /漏.{0,10}补/ },
  { reason: "double", field: "compact", re: /补(返|回|翻)/ },
  { reason: "double", field: "compact", re: /(双|加)倍/ },
  { reason: "double", field: "compact", re: /再(食|吃|饮|服)(多)?(一)?次/ },
  { reason: "double", field: "spaced", re: /\bdouble\b/ },
  { reason: "double", field: "spaced", re: /\btake\s+(two|2|double|an\s+extra|extra|another)\b/ },
  { reason: "double", field: "spaced", re: /\bextra\s+dose\b/ },
  { reason: "double", field: "spaced", re: /\btwo\s+at\s+once\b/ },

  // ------------------------------------------------------------------- add
  { reason: "add", field: "compact", re: /加(药|安眠药)/ },
  // 只 is the Cantonese classifier for a pill; 种/样 are generic, so they need 药 to avoid
  // catching a food question ("食多樣餸").
  { reason: "add", field: "compact", re: /(食|吃|饮|服)多只(药)?/ },
  { reason: "add", field: "compact", re: /(食|吃|饮|服)多(种|样)药/ },
  { reason: "add", field: "compact", re: /(另外|再)(食|吃|服)(多)?(一|1)?(只|种)(药)?/ },
  { reason: "add", field: "compact", re: /(食|吃|加|服).{0,3}(保健品|维他命|维生素|补品|中药|凉茶)/ },
  {
    reason: "add",
    field: "spaced",
    re: /\badd(ing)?\b[\w\s]{0,15}\b(medicine|medication|tablet|pill|drug|supplement|vitamin|dose)s?\b/,
  },
  { reason: "add", field: "spaced", re: /\b(can|could|should|may|shall)\b[\w\s]{0,15}\balso\s+take\b/ },
  { reason: "add", field: "spaced", re: /\bon\s+top\s+of\b/ },

  // -------------------------------------------------------- timing_change
  {
    reason: "timing_change",
    field: "compact",
    re: /(改|换|转|调|挪|推迟|提前|延后|延迟)(去|到|做|成|返)?(晏昼|朝早|夜晚|中午|下午|晚上|早上|睡前|临睡|饭前|饭后|餐前|餐后|时间|时候)/,
  },
  { reason: "timing_change", field: "compact", re: /(迟|晚|早)(啲|点|些|一点|一啲)(先|再)?(食|吃|饮|服)/ },
  { reason: "timing_change", field: "compact", re: /(食|吃|饮|服)(迟|晚|早)(啲|点|些)/ },
  { reason: "timing_change", field: "compact", re: /(改|换|转|调)(食|吃)?(药)?(时间|时候)/ },
  {
    reason: "timing_change",
    field: "compact",
    re: /(晏昼|夜晚|晚上|下午|中午|朝早|早上|睡前)(先|至|才)(食|吃|饮|服)/,
  },
  { reason: "timing_change", field: "spaced", re: /\b(change|move|shift|switch)\s+(the\s+)?(dose\s+|medicine\s+|pill\s+)?time(s|ing)?\b/ },
  { reason: "timing_change", field: "spaced", re: /\bdifferent\s+time\b/ },
  { reason: "timing_change", field: "spaced", re: /\b(take|give|have)\b[\w\s]{0,20}\b(later|earlier)\b/ },
  { reason: "timing_change", field: "spaced", re: /\b(at\s+night|in\s+the\s+morning|at\s+lunch)\s+instead\b/ },

  // ------------------------------------------------------------------ stop
  { reason: "stop", field: "compact", re: /停(咗|左|下|一|吓)?(佢|药|住|晒|服|用)/ },
  { reason: "stop", field: "compact", re: /(停止|停服|停用|停晒)/ },
  { reason: "stop", field: "compact", re: /(可以|可唔可以|可不可以|能不能|能否|使唔使)停/ },
  { reason: "stop", field: "compact", re: /(唔再|不再)(食|吃|饮|服)/ },
  { reason: "stop", field: "spaced", re: /\bstop(s|ped|ping)?\b/ },

  // ------------------------------------------------------------------ skip
  {
    reason: "skip",
    field: "compact",
    re: /(可唔可以|可以|可不可以|能不能|能否|使唔使|洗唔洗|要唔要)(唔|不)(食|吃|饮|服)/,
  },
  { reason: "skip", field: "compact", re: /(唔|不)(食|吃|饮|服)得(唔得|吗|嘛)?/ },
  { reason: "skip", field: "compact", re: /(唔|不)想(食|吃|饮|服)/ },
  { reason: "skip", field: "compact", re: /(唔|不)(跟|照)(住)?(食|吃|服)/ },
  { reason: "skip", field: "compact", re: /(唔|不)(食|吃|饮|服)(呢次|今日|今晚|今朝|一次|一顿|一餐)/ },
  { reason: "skip", field: "compact", re: /(漏|飞|跳)(咗|左|了)?(一)?(次|顿|餐)/ },
  { reason: "skip", field: "compact", re: /(漏|飞|跳)(咗|左|了)(食|吃|药)/ },
  { reason: "skip", field: "spaced", re: /\bskip(s|ped|ping)?\b/ },
  { reason: "skip", field: "spaced", re: /\b(can|could|should|may)\s+(i|she|he|we|they)\s+(just\s+)?not\s+take\b/ },
  { reason: "skip", field: "spaced", re: /\bnot\s+take\s+(it|them|the|her|his|this|these|any)\b/ },
  { reason: "skip", field: "spaced", re: /\bdont\s+take\b/ },
  { reason: "skip", field: "spaced", re: /\bleave\s+(it|them|the\s+\w+)\s+out\b/ },

  // ----------------------------------------------------------- change_dose
  { reason: "change_dose", field: "compact", re: /(食|吃|饮|服)少(啲|点|些|一点|一啲)/ },
  { reason: "change_dose", field: "compact", re: /少(食|吃|饮|服)(一)?(点|啲|些)/ },
  { reason: "change_dose", field: "compact", re: /(食|吃|饮|服)多(啲|点|些)/ },
  { reason: "change_dose", field: "compact", re: /多(食|吃|饮|服)(啲|点|些|一点)/ },
  { reason: "change_dose", field: "compact", re: /(减|加|改|换|转|调)(药|剂量|药量|份量|分量|量)/ },
  { reason: "change_dose", field: "compact", re: /自己(减|加|改|换|调|加减|决定)/ },
  { reason: "change_dose", field: "compact", re: /(食|吃|服|饮)半(粒|片|颗)/ },
  { reason: "change_dose", field: "compact", re: /(切|分|掰|拆)(开|成)?(一)?半/ },
  {
    reason: "change_dose",
    field: "spaced",
    re: /\b(change|changing|adjust|adjusting|increase|increasing|reduce|reducing|lower|lowering|alter|altering|up|double)\s+(the\s+|her\s+|his\s+|this\s+|their\s+)?(dose|dosage|amount|strength|tablet|pill|medicine|medication|drug)s?\b/,
  },
  { reason: "change_dose", field: "spaced", re: /\badjust(s|ed|ing)?\b/ },
  { reason: "change_dose", field: "spaced", re: /\b(dose|dosage)\s+(change|adjustment)\b/ },
  { reason: "change_dose", field: "spaced", re: /\b(halve|halving)\b/ },
  { reason: "change_dose", field: "spaced", re: /\bhalf\s+(a\s+|the\s+|her\s+|his\s+)?(dose|tablet|pill|dosage)s?\b/ },
  { reason: "change_dose", field: "spaced", re: /\bin\s+half\b/ },
  {
    reason: "change_dose",
    field: "spaced",
    re: /\b(switch|switching|swap|swapping|change|changing)\s+(to\s+)?(a\s+|the\s+|another\s+|a\s+different\s+|different\s+)?(medicine|medication|tablet|pill|drug|brand)s?\b/,
  },
];

/**
 * The gate. Pure, synchronous, no I/O: the same call runs on the client before the request and on
 * the server before the model call (contracts/api-ask.md).
 *
 * `inputLanguage` is not a parameter on purpose — questions mix languages ("Metformin 可唔可以唔
 * 食？"), so every pattern set runs on every question.
 */
export function detectMedicineChange(text: string): MedicineChangeResult {
  const { spaced, compact } = normaliseQuestion(text);
  for (const rule of RULES) {
    const match = (rule.field === "compact" ? compact : spaced).match(rule.re);
    if (match) return { refuse: true, reason: rule.reason, matched: match[0] };
  }
  return { refuse: false, reason: null, matched: "" };
}
