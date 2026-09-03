/**
 * Crisis-keyword gate (FR-014, User Story 1 scenario 10, rules.md §12).
 *
 * Constitution III: deterministic code, run before anything else in `/api/ask`
 * (contracts/api-ask.md). A hit shows the referral card from `lib/i18n/referral.ts` — the app
 * answers nothing, calls no model, and does not continue the conversation.
 *
 * Scope, from the constitution's compliance constraints: the app does not offer emotional support
 * and does not invite emotional disclosure. Ordinary caregiver stress (好攰, 很累, 压力大,
 * "I'm exhausted") is NOT a crisis and takes the normal not-on-sheet path. Only explicit
 * self-harm, suicide, overdose-with-intent, or hopelessness carrying intent triggers the card.
 *
 * Idioms are the known trap: 累死了 / 煩死 / 笑死 are "extremely tired / annoyed / funny", not
 * intent. They must never trigger; `isAmbiguous` reports that one was seen so the UI can stay
 * neutral and the demo can show the distinction.
 */
import type { InputLanguage } from "@/lib/domain/schemas";
import { REFERRAL, REFERRAL_RESOURCES, type ReferralResource } from "@/lib/i18n/referral";

export interface CrisisResult {
  /** True when the referral card must be shown instead of an answer. */
  crisis: boolean;
  /** The normalised substring that matched; "" when nothing matched. */
  matched: string;
  /**
   * True when an idiomatic "…死" intensifier was seen and nothing real matched — i.e. the text
   * looks crisis-shaped but is not. Always false when `crisis` is true.
   */
  isAmbiguous: boolean;
}

/** Traditional → simplified for the characters used in the patterns below only (no opencc). */
const TRAD_TO_SIMP: Readonly<Record<string, string>> = {
  殺: "杀",
  盡: "尽",
  輕: "轻",
  義: "义",
  結: "结",
  尋: "寻",
  傷: "伤",
  殘: "残",
  脈: "脉",
  頸: "颈",
  藥: "药",
  飲: "饮",
  農: "农",
  樓: "楼",
  燒: "烧",
  臥: "卧",
  軌: "轨",
  撐: "撑",
  頂: "顶",
  離: "离",
  開: "开",
  這: "这",
  沒: "没",
  曬: "晒",
  煩: "烦",
  餓: "饿",
  熱: "热",
  氣: "气",
  嚇: "吓",
  悶: "闷",
  個: "个",
  麼: "么",
  嗎: "吗",
  幾: "几",
  隻: "只",
  點: "点",
  係: "系",
  見: "见",
  聽: "听",
  過: "过",
  夢: "梦",
  願: "愿",
};

function toSimplified(text: string): string {
  let out = "";
  for (const ch of text) out += TRAD_TO_SIMP[ch] ?? ch;
  return out;
}

/** Same normalisation as `lib/rules/refusal.ts`: NFKC, lower case, punctuation → space. */
function normalise(text: string): { spaced: string; compact: string } {
  const spaced = toSimplified(text.normalize("NFKC").toLowerCase().replace(/['’`´]/g, ""))
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { spaced, compact: spaced.replace(/ /g, "") };
}

interface CrisisRule {
  field: "compact" | "spaced";
  re: RegExp;
}

const CRISIS_RULES: readonly CrisisRule[] = [
  // ------------------------------------------- explicit self-harm / suicide (Chinese)
  { field: "compact", re: /(自杀|自尽|轻生|自残|自伤)/ },
  // 唔想死 / 不想死 negate the intent, so they are excluded by the look-behind.
  { field: "compact", re: /(?<![唔不冇])想(去)?死/ },
  { field: "compact", re: /(唔|不)想(再)?(活|生存|做人)/ },
  { field: "compact", re: /活(唔|不)(落|下)去/ },
  { field: "compact", re: /(寻死|求死|一了百了)/ },
  { field: "compact", re: /了结(自己|生命|一生|咗|这一切|呢一切)?/ },
  { field: "compact", re: /结束(自己|生命|一生|这一切|呢一切)/ },
  { field: "compact", re: /伤害(自己|自个)/ },
  { field: "compact", re: /割(脉|腕|手|颈)/ },
  { field: "compact", re: /(上吊|吊颈|跳楼|烧炭|卧轨|跳海|跳落去)/ },
  { field: "compact", re: /(服毒|喝毒|食毒|饮毒|农药|漂白水)/ },
  // Overdose. 食晒啲藥 is also how a dosing question is phrased ("一次過食晒啲藥得唔得？") and
  // 吞藥 can be innocent ("佢吞唔到藥"), so those two need the intent verb attached to them, not
  // merely present somewhere in the sentence. A swallowed bottle needs no cue.
  { field: "compact", re: /吞(晒|哂|咗|埋)?(啲|成|全部|所有|好多)(药|安眠药)/ },
  { field: "compact", re: /(食|吞)(晒|哂|埋|咗|左|了)?(成|一|整)(樽|支|瓶|盒|板)(药|安眠药)/ },
  { field: "compact", re: /(想|打算|不如)(一次)?(过)?(将|把)?(食|吞)(晒|哂)(啲|成|全部|所有)?(药|安眠药)/ },
  { field: "compact", re: /(想|打算|不如)(一次)?(过)?吞(咗)?(药|安眠药)/ },

  // ------------------------------------------- hopelessness carrying intent (Chinese)
  { field: "compact", re: /(冇|没|无)(意思|意义)(再)?(活|生存)/ },
  { field: "compact", re: /活(着|住|落去|下去).{0,4}(冇|没|无)(意思|意义)/ },
  { field: "compact", re: /(撑|顶)(唔住|不住).{0,8}(想|要)(走|离开)/ },

  // ------------------------------------------------------------------- English
  { field: "spaced", re: /\b(kill|killing)\s+(myself|herself|himself|themselves|ourselves)\b/ },
  { field: "spaced", re: /\bend\s+(my|her|his|their)\s+(own\s+)?life\b/ },
  { field: "spaced", re: /\bend\s+it\s+all\b/ },
  { field: "spaced", re: /\b(suicide|suicidal)\b/ },
  { field: "spaced", re: /\b(hurt|harm|hurting|harming)\s+(myself|herself|himself|themselves)\b/ },
  { field: "spaced", re: /\bself\s+harm\b/ },
  { field: "spaced", re: /\b(want|wants|wanted)\s+to\s+die\b/ },
  { field: "spaced", re: /\b(dont|doesnt|didnt|do\s+not|does\s+not)\s+want\s+to\s+(live|be\s+here|go\s+on)\b/ },
  { field: "spaced", re: /\b(better\s+off\s+dead|no\s+reason\s+to\s+live|nothing\s+to\s+live\s+for)\b/ },
  { field: "spaced", re: /\b(cant|cannot|can\s+not)\s+go\s+on\b/ },
  { field: "spaced", re: /\b(want|wants|going|plan|planning)\s+to\s+overdose\b/ },
  { field: "spaced", re: /\boverdose[\w\s]{0,20}\b(on\s+purpose|deliberately|intentionally)\b/ },
  { field: "spaced", re: /\b(take|took|taking|swallow|swallowed)\s+(all|the\s+whole)\s+(of\s+)?(the\s+)?(pills|tablets|bottle|box|packet|medicine)\b/ },
  { field: "spaced", re: /\b(cut|cutting|slit|slitting)\s+(my|her|his)\s+(wrists?|arms?)\b/ },
  { field: "spaced", re: /\b(jump|jumping)\s+(off|from)\s+(the\s+)?(building|roof|window|balcony)\b/ },
];

/**
 * Idiomatic intensifiers: 累死了 = "dead tired", 煩死 = "unbearably annoying". Consulted only
 * when no crisis rule matched, so a real phrase inside an idiom-heavy sentence still triggers.
 */
const IDIOM_RULES: readonly RegExp[] = [
  /(累|攰|烦|饿|渴|热|冷|笑|气|嬲|吓|闷|急|忙|困|嘈|眼瞓|辛苦)死(了|咗|我|人|啦|喇)?/,
  /(累|攰|烦|辛苦|忙|嘈)(到|得)死/,
];

/**
 * The gate. Pure and synchronous; runs on the client before the request and on the server before
 * the model call. Never returns advice — only whether the referral card must replace the answer.
 */
export function detectCrisis(text: string): CrisisResult {
  const { spaced, compact } = normalise(text);
  for (const rule of CRISIS_RULES) {
    const match = (rule.field === "compact" ? compact : spaced).match(rule.re);
    if (!match) continue;
    return { crisis: true, matched: match[0], isAmbiguous: false };
  }
  for (const idiom of IDIOM_RULES) {
    const match = compact.match(idiom);
    if (match) return { crisis: false, matched: match[0], isAmbiguous: true };
  }
  return { crisis: false, matched: "", isAmbiguous: false };
}

/** The card the UI shows on a hit: fixed text plus the resource list, no model call. */
export function crisisReferral(language: InputLanguage = "yue"): {
  text: string;
  resources: readonly ReferralResource[];
} {
  return { text: REFERRAL[language], resources: REFERRAL_RESOURCES };
}
