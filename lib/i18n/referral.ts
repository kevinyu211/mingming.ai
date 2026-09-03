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
 * PLACEHOLDER LIST. The organisers publish their own referral resources at the kickoff briefing;
 * the last row is the slot for them and MUST be replaced before the submission.
 *
 * Hong Kong and mainland numbers are the publicly listed 24-hour lines, kept here so the demo
 * path is never empty.
 */
export const REFERRAL_RESOURCES: readonly ReferralResource[] = [
  {
    name: "香港撒瑪利亞防止自殺會 · Samaritan Befrienders Hong Kong (24h)",
    number: "2389 2222",
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
  {
    name: "TODO: replace with organiser list — 主辦方公布嘅轉介資源 (kickoff briefing)",
    number: "TODO",
    region: "organiser",
  },
];

/** True while the organiser row is still a placeholder; the submission checklist reads this. */
export const REFERRAL_LIST_IS_PLACEHOLDER: boolean = REFERRAL_RESOURCES.some(
  (r) => r.region === "organiser" && r.number === "TODO",
);
