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
 * `TTS_PROVIDER=minimax`, `STT_PROVIDER=openai`, `NEXT_PUBLIC_STT_MODE=cloud`.
 *
 * Transcription moved from the browser's own engine to OpenAI when `lib/speech/stt.ts` became a
 * hybrid, and this line moved with it in the same commit. The browser engine still runs — it is
 * what puts the words on screen while the reader is speaking — so the statement names OpenAI as
 * the provider AND keeps saying that the browser listens too, because on Chrome the Web Speech
 * API uploads that audio to Google. A reader who assumes "browser" means "on my phone" would be
 * wrong, and a reader told only about OpenAI would be told half the truth.
 */
export const DATA_STATEMENT_PROVIDERS: DataStatementProviders = {
  model: "Anthropic Claude (US)",
  voice: "MiniMax (api.minimax.io)",
  transcription: "OpenAI (api.openai.com)",
};

/** Paragraph templates. `{model}`, `{voice}` and `{transcription}` are interpolated. */
const TEMPLATES: Record<UiLocale, readonly string[]> = {
  hant: [
    "你影嘅出院紙同你問嘅問題，會傳去模型供應商喺香港以外嘅伺服器處理。",
    "每張卡同每個答案嘅文字會傳去語音供應商讀出嚟；你用講嘅問題會錄低，傳去語音辨識供應商寫成文字。你講緊嗰陣，瀏覽器自己嘅引擎同時聽住，即刻喺畫面顯示出嚟；用 Chrome 嘅話，嗰段聲同時會上傳去 Google。",
    "呢個 app 冇伺服器儲存。張相處理完即刻掉咗，唔會留低，唔會記入 log。",
    "稱呼、計劃同讀過嘅紙淨係存喺你部電話，隨時撳「刪除所有資料」就冇晒。",
    "每次傳出去嘅內容只有嗰次需要嘅嘢，唔會包埋稱呼、日期或者任何身分資料。",
    "供應商保留幾耐，跟返佢哋自己公布嘅政策。",
    "供應商：模型 {model}；語音 {voice}；語音辨識 {transcription}。",
  ],
  hans: [
    "你拍的出院纸和你问的问题，会传到模型供应商在香港以外的服务器处理。",
    "每张卡和每个答案的文字会传到语音供应商念出来；你用讲的问题会录下来，传到语音识别供应商写成文字。你讲的时候，浏览器自己的引擎同时听着，马上在画面显示出来；用 Chrome 的话，那段声音同时会上传到 Google。",
    "这个 app 没有服务器存储。照片处理完马上丢掉，不留底，不写进日志。",
    "称呼、计划和读过的纸只存在你的手机里，随时按「删除所有资料」就全没了。",
    "每次传出去的内容只有那一次需要的东西，不会带上称呼、日期或者任何身份资料。",
    "供应商保留多久，按他们自己公布的政策。",
    "供应商：模型 {model}；语音 {voice}；语音识别 {transcription}。",
  ],
  en: [
    "The discharge sheet you photograph and the question you ask are sent to the model provider's API, on servers outside Hong Kong.",
    "The text of each card and each answer is sent to the voice provider to be spoken; a spoken question is recorded and the recording is sent to the transcription provider. While you speak, the browser's own engine listens as well, so the words appear on screen straight away — and on Chrome that audio goes to Google too.",
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
