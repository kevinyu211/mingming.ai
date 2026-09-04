/**
 * The data statement (research.md R13). Rendered on the settings screen and copied verbatim
 * into the hackathon submission, so the UI and the submission can never drift apart.
 *
 * Provider names are interpolated rather than hard-coded so the UI and the submission cannot
 * drift apart. They must name what the app ACTUALLY calls: these read "TBD by listening test"
 * for a while after `TTS_PROVIDER=minimax` was already set, so the screen was telling the user
 * the voice provider was undecided while card text was being posted to MiniMax on every card.
 * A data statement that is out of date is worse than none — it is a false one.
 *
 * If a provider changes, change it here and nowhere else, and check `.env.local` agrees.
 */
import type { UiLocale } from "@/lib/i18n/ui";

export interface DataStatementProviders {
  model: string;
  voice: string;
  transcription: string;
}

/**
 * What the app calls today, matching `.env.local`:
 * `TTS_PROVIDER=minimax`, `STT_PROVIDER=browser`, `NEXT_PUBLIC_STT_MODE=browser`.
 *
 * Transcription is named honestly as the browser's own engine rather than left blank. It is not a
 * provider we chose, and on Chrome the Web Speech API uploads the audio to Google — so a reader
 * who assumes "browser" means "on my phone" would be wrong, and the statement has to say so.
 */
export const DATA_STATEMENT_PROVIDERS: DataStatementProviders = {
  model: "Anthropic Claude (US)",
  voice: "MiniMax (api.minimax.io)",
  transcription: "your browser's own engine (Chrome uploads audio to Google)",
};

/** Paragraph templates. `{model}`, `{voice}` and `{transcription}` are interpolated. */
const TEMPLATES: Record<UiLocale, readonly string[]> = {
  hant: [
    "你影嘅出院紙同你問嘅問題，會傳去模型供應商喺香港以外嘅伺服器處理。",
    "每張卡同每個答案嘅文字會傳去語音供應商讀出嚟；你用講嘅問題會傳去語音辨識供應商。",
    "呢個 app 冇伺服器儲存。張相處理完即刻掉咗，唔會留低，唔會記入 log。",
    "稱呼、計劃同讀過嘅紙淨係存喺你部電話，隨時撳「刪除所有資料」就冇晒。",
    "每次傳出去嘅內容只有嗰次需要嘅嘢，唔會包埋稱呼、日期或者任何身分資料。",
    "供應商保留幾耐，跟返佢哋自己公布嘅政策。",
    "供應商：模型 {model}；語音 {voice}；語音辨識 {transcription}。",
  ],
  hans: [
    "你拍的出院纸和你问的问题，会传到模型供应商在香港以外的服务器处理。",
    "每张卡和每个答案的文字会传到语音供应商念出来；你用讲的问题会传到语音识别供应商。",
    "这个 app 没有服务器存储。照片处理完马上丢掉，不留底，不写进日志。",
    "称呼、计划和读过的纸只存在你的手机里，随时按「删除所有资料」就全没了。",
    "每次传出去的内容只有那一次需要的东西，不会带上称呼、日期或者任何身份资料。",
    "供应商保留多久，按他们自己公布的政策。",
    "供应商：模型 {model}；语音 {voice}；语音识别 {transcription}。",
  ],
  en: [
    "The discharge sheet you photograph and the question you ask are sent to the model provider's API, on servers outside Hong Kong.",
    "The text of each card and each answer is sent to the voice provider to be spoken; a spoken question is sent to the transcription provider.",
    "This app has no server storage. The photo is discarded as soon as the reading comes back: not kept, not logged.",
    "The word you chose, the plan and the last sheet stay on your phone, and “Delete everything” removes all of it.",
    "Each request carries only what that request needs. It never carries the word you chose, plan dates, or any identifier.",
    "How long each provider keeps a request follows that provider's published policy.",
    "Providers: model {model}; voice {voice}; transcription {transcription}.",
  ],
};

function interpolate(line: string, providers: DataStatementProviders): string {
  return line
    .replace("{model}", providers.model)
    .replace("{voice}", providers.voice)
    .replace("{transcription}", providers.transcription);
}

/** The statement as paragraphs, ready to render one <p> each. */
export function dataStatementLines(
  locale: UiLocale,
  providers: DataStatementProviders = DATA_STATEMENT_PROVIDERS,
): string[] {
  return TEMPLATES[locale].map((line) => interpolate(line, providers));
}

/** The whole statement as one blank-line-separated block, for copying into the submission. */
export function dataStatement(
  locale: UiLocale,
  providers: DataStatementProviders = DATA_STATEMENT_PROVIDERS,
): string {
  return dataStatementLines(locale, providers).join("\n\n");
}

export const DATA_STATEMENT_TEMPLATES = TEMPLATES;
