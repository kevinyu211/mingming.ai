/**
 * Fixed-sentence fallbacks (contracts/api-phrase.md; constitution III: rules decide, VI: banned
 * words are enforced).
 *
 * When a model phrasing hits the banned-term filter twice, the phrase route falls back to one of
 * these. Every sentence is built ONLY from the fact fields of the card, keeps drug names and
 * numbers verbatim (names are never translated), adds no advice of its own, and is unit-tested
 * against `checkText` so a fallback can never itself be filtered.
 *
 * Pure and deterministic: no I/O, no model, no clock.
 *
 * Caveat: fact fields are verbatim page text. If a sheet itself prints a numeric target (e.g.
 * "鹽 2g/日" on the diet line), the filter will flag the rendered template — that is the intended
 * fail-safe direction, and the caller then shows the source line instead of speaking it.
 */
import type { CardType, Speakable } from "@/lib/domain/schemas";

/** The typed fact object of one card, as carried by `Card.facts`. */
export type TemplateFacts = Record<string, string | null>;

/** Trims and turns blank strings into null, so an absent fact never leaves dangling punctuation. */
function fact(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Joins the parts that are present with a Chinese comma. */
function join(parts: (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join("，");
}

/**
 * The English twin of `join`. Same guarantee that matters here: a separator always sits between a
 * strength and whatever follows it, so "5mg" can never butt up against "per day" and read as a
 * rate the numeric filter would reject.
 */
function joinEn(parts: (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join(", ");
}

/** Drops a trailing full stop so appended clauses do not double up. */
function unpunctuated(value: string): string {
  return value.replace(/[。.！!]+$/, "");
}

/**
 * Capitalises the first letter, for an English clause that follows a full stop. A no-op on a
 * Chinese description, which is the common case for the `unreadable` card on a Chinese sheet.
 */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Shown when a card arrives with no usable facts at all. */
const NO_FACTS: Speakable = {
  yue: "張紙呢一行讀唔到內容，請睇返張紙。",
  cmn: "纸上这一行读不到内容，请看纸。",
  en: "There's nothing readable on this line. Have a look at the sheet itself.",
};

/** "The sheet does not say" — the grounded refusal for /api/ask. */
export const NOT_ON_SHEET: Speakable = {
  yue: "張紙冇講呢樣。可以問藥劑師或者打張紙上面嘅電話。",
  cmn: "纸上没有讲这个。可以问药剂师或者打纸上面的电话。",
  en: "The sheet doesn't say. Ask the pharmacist, or ring the number printed on the sheet.",
};

/**
 * The refusal for "should I keep taking this / take more / take less". Deliberately phrased
 * without 停藥 / 加藥 / 減藥, which are themselves on the banned list — and, in English, without
 * "you should", for the same reason.
 */
export const REFUSED_MEDICINE_CHANGE: Speakable = {
  yue: "藥點食、食唔食，張紙冇話得。呢樣要問藥劑師或者打張紙上面嘅電話。",
  cmn: "药怎么吃、吃不吃，纸上没有写。这个要问药剂师或者打纸上面的电话。",
  en: "Whether to take it, and how much — the sheet doesn't say. That one's for the pharmacist, or ring the number printed on the sheet.",
};

/**
 * The fixed fallbacks for the three conversational kinds `/api/ask` gained in 1.2.0. The model
 * writes those replies itself; these are what is said when its wording trips the filter, so each
 * one is a complete, warm turn on its own and states nothing about the person or the page.
 */

/** A judgement about the person was asked for: the doctor's to make, not the app's. */
export const BOUNDARY: Speakable = {
  yue: "呢樣我答唔到你，因為係關於你身體嘅情況，要問返醫生。張紙上面寫住嘅嘢，我可以再同你講一次。",
  cmn: "这个我答不了你，因为是关于你身体的情况，要问回医生。纸上写的内容，我可以再跟你讲一次。",
  en: "That one I can't answer, because it's about how you are — it's one for the doctor. What the sheet says, I can go over again any time.",
};

/** Small talk: a greeting or a thank-you. */
export const SMALL_TALK: Speakable = {
  yue: "我幾好呀，多謝你問。想繼續講張紙嘅嘢，隨時話我知。",
  cmn: "我挺好的，谢谢你问。想继续讲纸上的内容，随时告诉我。",
  en: "I'm well, thanks for asking. Whenever you'd like, we can carry on with the sheet.",
};

/** Not health, not this sheet. */
export const OFF_TOPIC: Speakable = {
  yue: "呢樣唔係我識嘅嘢，我淨係幫手睇出院紙。想問張紙上面嘅嘢，隨時問我。",
  cmn: "这个不是我会的，我只帮忙看出院纸。想问纸上的内容，随时问我。",
  en: "That's outside what I do — I only help with the discharge sheet. Ask me anything on it whenever you like.",
};

/** Appended to every spoken output that came from the model (compliance: AI content is labelled). */
export const CAUTION_SUFFIX: Speakable = {
  yue: "AI 寫嘅，可能有錯。",
  cmn: "AI 写的，可能有错。",
  en: "Written by AI — it can get things wrong.",
};

/**
 * `symptomEn` / `actionEn` carry the English wording of the same two facts (see
 * `lib/rules/card-order.ts`). When a caller supplies only the Chinese pair — the phrase route
 * accepts whatever facts the client sends — the English sentence falls back to it rather than
 * dropping the fact, because a frame with nothing in it says less than a mixed-script one.
 */
function warningTemplate(facts: TemplateFacts): Speakable {
  const symptom = fact(facts.symptom);
  const action = fact(facts.action);
  const symptomEn = fact(facts.symptomEn) ?? symptom;
  const actionEn = fact(facts.actionEn) ?? action;
  if (symptom !== null && action !== null) {
    return {
      yue: `張紙寫住：如果${unpunctuated(symptom)}，${unpunctuated(action)}。`,
      cmn: `纸上写着：如果${unpunctuated(symptom)}，${unpunctuated(action)}。`,
      en: `The sheet says: if ${unpunctuated(symptomEn ?? symptom)}, ${unpunctuated(actionEn ?? action)}.`,
    };
  }
  if (symptom !== null) {
    return {
      yue: `張紙寫住警號：${unpunctuated(symptom)}。`,
      cmn: `纸上写着警号：${unpunctuated(symptom)}。`,
      en: `The sheet lists this as a warning sign: ${unpunctuated(symptomEn ?? symptom)}.`,
    };
  }
  if (action !== null) {
    return {
      yue: `張紙寫住：${unpunctuated(action)}。`,
      cmn: `纸上写着：${unpunctuated(action)}。`,
      en: `The sheet says: ${unpunctuated(actionEn ?? action)}.`,
    };
  }
  return NO_FACTS;
}

/**
 * The fallback for a medicine the page has withdrawn.
 *
 * This exists because of a live failure, not a hypothetical one. On a sheet with a
 * 「停用药物（出院后不再服用）」 block, the model writes `spoken` text for those entries that reads
 * like a live dose — "Digoxin 0.25mg 每日" — and the numeric-target rule in
 * `lib/rules/banned-terms.ts` rightly rejects it. Roughly one run in three on that fixture. The
 * filter was doing its job; the fallback was the weak link, because the generic "look at the
 * sheet" sentence dropped the drug's name, and the one thing the family must not lose is that the
 * page mentions this drug at all.
 *
 * So: the name and the strength verbatim, and what the PAGE says about it — never an instruction
 * from the app. 「張紙寫唔使再食」, never 「唔好食」. And deliberately **no frequency, no amount and
 * no duration**: the dose clause is exactly what tripped the filter, and reintroducing it here
 * would put the rejected sentence back on the screen through the back door.
 *
 * `status` distinguishes the two non-current kinds the schema defines. A caller that only knows
 * `card.stopped === true` and carries no status gets the stopped wording, which is the safe
 * default: it claims only that the page says the drug is finished.
 */
export function stoppedMedicineTemplate(facts: TemplateFacts): Speakable {
  const name = fact(facts.name);
  if (name === null) return NO_FACTS;
  const strength = fact(facts.strength);
  const head = join([name, strength]);
  const headEn = joinEn([name, strength]);

  // "changed" means the stay altered the dose and the page lists the entry apart from the
  // discharge list. Saying it is finished would overstate that, so it gets its own sentence,
  // which still carries no dose of its own.
  if (fact(facts.status) === "changed") {
    return {
      yue: `張紙將呢隻藥另外列開，唔喺出院之後要食嗰批入面：${head}。`,
      cmn: `纸上把这个药另外列开，不在出院之后要吃的那批里面：${head}。`,
      en: `The sheet lists ${headEn} apart from the medicines to take after going home.`,
    };
  }

  return {
    yue: `張紙寫住呢隻藥唔使再食：${head}。`,
    cmn: `纸上写着这个药不用再吃：${head}。`,
    en: `The sheet lists ${headEn} as a medicine that is no longer to be taken.`,
  };
}

function medicineTemplate(facts: TemplateFacts): Speakable {
  const name = fact(facts.name);
  const strength = fact(facts.strength);
  const amount = fact(facts.amount);
  const frequency = fact(facts.frequency);
  const duration = fact(facts.duration);
  if (name === null) return NO_FACTS;

  // A medicine the page has stopped or changed is never described by the sentences below: they
  // state a dose to take, and this one is not one. `lib/rules/card-order.ts` copies `status` into
  // `facts` precisely so this branch can be reached from a template with no card in hand.
  const status = fact(facts.status);
  if (status === "stopped" || status === "changed") return stoppedMedicineTemplate(facts);

  // Name, strength and amount are always separated by "，" — never butt a strength ("5mg") up
  // against a frequency ("每日一次"), or the pair would read as a rate and trip the filter.
  const headYue = join([`藥名 ${name}`, strength, amount === null ? null : `每次 ${amount}`]);
  const headCmn = join([`药名 ${name}`, strength, amount === null ? null : `每次 ${amount}`]);
  const headEn = joinEn([name, strength, amount === null ? null : `${amount} each time`]);

  if (frequency === null) {
    return {
      yue: `${headYue}，用法上面冇印，睇吓藥袋標籤或者問藥劑師。`,
      cmn: `${headCmn}，用法上面没有印，请看药袋标签或问药剂师。`,
      en: `The sheet lists ${headEn}. How often isn't printed — check the label on the bag, or ask the pharmacist.`,
    };
  }
  return {
    yue: `${join([headYue, frequency, duration === null ? null : `食 ${duration}`])}。`,
    cmn: `${join([headCmn, frequency, duration === null ? null : `吃 ${duration}`])}。`,
    en: `The sheet lists ${joinEn([headEn, frequency, duration === null ? null : `for ${duration}`])}.`,
  };
}

function followUpTemplate(facts: TemplateFacts): Speakable {
  const clinic = fact(facts.clinic);
  const when = fact(facts.when);
  const tests = fact(facts.tests);
  if (clinic === null && when === null && tests === null) return NO_FACTS;
  return {
    yue: `張紙寫住覆診：${join([clinic, when, tests === null ? null : `檢查：${tests}`])}。`,
    cmn: `纸上写着复诊：${join([clinic, when, tests === null ? null : `检查：${tests}`])}。`,
    en: `The sheet says the next visit is ${joinEn([clinic, when, tests === null ? null : `tests: ${tests}`])}.`,
  };
}

function dietTemplate(facts: TemplateFacts): Speakable {
  const raw = fact(facts.raw);
  if (raw === null) return NO_FACTS;
  return {
    yue: `張紙飲食嗰行寫住：${unpunctuated(raw)}。`,
    cmn: `纸上饮食那行写着：${unpunctuated(raw)}。`,
    en: `The food line on the sheet says: ${unpunctuated(raw)}.`,
  };
}

function activityTemplate(facts: TemplateFacts): Speakable {
  const text = fact(facts.text);
  if (text === null) return NO_FACTS;
  return {
    yue: `張紙活動嗰行寫住：${unpunctuated(text)}。`,
    cmn: `纸上活动那行写着：${unpunctuated(text)}。`,
    en: `The activity line on the sheet says: ${unpunctuated(text)}.`,
  };
}

function unreadableTemplate(facts: TemplateFacts): Speakable {
  const section = fact(facts.section);
  const description = fact(facts.description);
  const tail = description === null ? "" : `${unpunctuated(description)}。`;
  const tailEn = description === null ? "" : ` ${sentenceCase(unpunctuated(description))}.`;
  return {
    yue: `呢部分讀唔到：${unpunctuated(section ?? "呢一部分")}。${tail}`,
    cmn: `这部分读不到：${unpunctuated(section ?? "这一部分")}。${tail}`,
    en: `This part couldn't be read: ${unpunctuated(section ?? "this part")}.${tailEn}`,
  };
}

/** No facts: the sheet printed no warning-sign section (constitution II). */
const NO_WARNINGS: Speakable = {
  yue: "張紙冇印警號。如果覺得唔妥，打返醫院或者去急症室。",
  cmn: "纸上没有印警号。如果觉得不舒服，打电话去医院或者去急诊室。",
  en: "The sheet doesn't print any warning signs. If something feels wrong, ring the hospital or go to A&E.",
};

/** Neutral pointer to the organisers' resource list already rendered on screen. */
const REFERRAL: Speakable = {
  yue: "螢幕上面列咗主辦單位提供嘅資源清單，可以睇吓。",
  cmn: "屏幕上面列了主办单位提供的资源清单，可以看看。",
  en: "There's a list of support lines from the organisers on the screen. Have a look at it.",
};

/**
 * The fixed sentence for one card type, in all three spoken forms, built only from `facts`.
 * Unknown fact keys are ignored; missing ones drop their clause.
 */
export function templateFor(type: CardType, facts: TemplateFacts): Speakable {
  switch (type) {
    case "warning":
      return warningTemplate(facts);
    case "medicine":
      return medicineTemplate(facts);
    case "followUp":
      return followUpTemplate(facts);
    case "diet":
      return dietTemplate(facts);
    case "activity":
      return activityTemplate(facts);
    case "unreadable":
      return unreadableTemplate(facts);
    case "noWarnings":
      return NO_WARNINGS;
    case "referral":
      return REFERRAL;
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown card type: ${String(exhaustive)}`);
    }
  }
}
