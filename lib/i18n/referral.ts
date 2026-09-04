/**
 * Crisis referral card copy and resource list (FR-014, rules.md §12 "精神健康与危机").
 *
 * The app does not offer emotional support and does not invite emotional disclosure
 * (constitution, Hackathon Compliance Constraints). This card is the insurance path: when
 * `lib/rules/crisis.ts` matches, the app stops, says it cannot help with this, and shows real
 * numbers. It never assesses, never names a condition, and never continues the conversation.
 *
 * The strings below carry no phone numbers on purpose — the UI renders `REFERRAL_RESOURCES`
 * underneath them, so a number is changed in exactly one place.
 */
import type { InputLanguage } from "@/lib/domain/schemas";

/** One hotline row. `region` groups the list; `organiser` rows come from the kickoff briefing. */
export interface ReferralResource {
  name: string;
  number: string;
  region: "hk" | "cn" | "organiser";
}

/**
 * The card text, keyed by the language the question was asked in (`Question.inputLanguage`),
 * not by the parent's dialect: this card is for the person holding the phone.
 *
 * Deliberately short and calm. No diagnosis language, no "治療"/"treat", no advice, no questions
 * back to the user, so it also passes `lib/rules/banned-terms.ts`.
 */
export const REFERRAL: Record<InputLanguage, string> = {
  yue: "呢個 app 幫唔到你呢件事。而家搵個人講出嚟好緊要 — 下面嘅熱線有人聽。如果有即時危險，請即刻打緊急求助電話。",
  cmn: "这个 app 帮不了你这件事。现在找个人说出来很重要 — 下面的热线有人接听。如果有立即的危险，请马上拨打紧急求助电话。",
  en: "This app can't help with this. Talking to someone right now matters — the lines below are there for that. If you are in immediate danger, call emergency services.",
};

/**
 * Every Hong Kong number below is taken from the Centre for Health Protection's own "Seek help"
 * page (Department of Health), checked on 4 September 2026:
 * https://www.chp.gov.hk/en/features/48085.html
 *
 * They are verified rather than remembered on purpose. This list is the one place in the product
 * where a wrong character sends a person in trouble to a dead line, and a plausible-looking
 * hotline number is exactly the kind of thing that survives a review unchallenged — a search
 * summary consulted while writing this file confidently gave the Hospital Authority's line as
 * 2382 0000, which is Suicide Prevention Services. The CHP page settled it.
 *
 * Hospital Authority Mental Health Direct leads the list because this is a hospital-discharge
 * product: it is the line staffed by the same organisation that printed the sheet in the reader's
 * hand.
 *
 * There is deliberately NO placeholder row. The organisers publish their own referral resources at
 * the kickoff briefing on 5 September; until one is added, `REFERRAL_LIST_IS_PLACEHOLDER` is true
 * and the submission checklist says so. What must never happen is a card rendering the literal
 * word "TODO" to somebody in crisis, which is what the previous placeholder did.
 */
export const REFERRAL_RESOURCES: readonly ReferralResource[] = [
  {
    name: "醫院管理局精神健康專線 · Hospital Authority Mental Health Direct (24h)",
    number: "2466 7350",
    region: "hk",
  },
  {
    name: "香港撒瑪利亞防止自殺會 · Samaritan Befrienders Hong Kong (24h)",
    number: "2389 2222",
    region: "hk",
  },
  {
    name: "生命熱線 · Suicide Prevention Services (24h)",
    number: "2382 0000",
    region: "hk",
  },
  {
    name: "撒瑪利亞會（多語言）· The Samaritans Hong Kong, multilingual (24h)",
    number: "2896 0000",
    region: "hk",
  },
  {
    name: "全国统一心理援助热线 · Mainland national psychological assistance line (24h)",
    number: "12356",
    region: "cn",
  },
  {
    name: "香港緊急求助 · Hong Kong emergency services",
    number: "999",
    region: "hk",
  },
  {
    name: "内地急救 · Mainland emergency medical services",
    number: "120",
    region: "cn",
  },
];

/**
 * True until the organisers' own referral list has been added after the kickoff briefing
 * (rules.md §12). The submission checklist reads this; nothing in the UI does, so the card always
 * renders real, staffed numbers whatever the answer.
 */
export const REFERRAL_LIST_IS_PLACEHOLDER: boolean = !REFERRAL_RESOURCES.some(
  (r) => r.region === "organiser",
);
