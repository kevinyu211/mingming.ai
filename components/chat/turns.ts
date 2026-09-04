/**
 * What the reader meant when they answered 明仔.
 *
 * The briefing stops at the end of every section and asks. Whatever comes back — spoken or typed —
 * lands here, and this decides one of three things:
 *
 *   continue  they followed it; say the next section
 *   repeat    they did not; say the same section again
 *   question  they asked something; answer it, then offer to carry on
 *
 * ── Why this is rules and not a model call ───────────────────────────────────────────────────
 *
 * "Yeah" is the commonest utterance in the whole product. Sending it to a model to be told it
 * means yes would put a network round trip, a cost and a failure mode in the middle of every turn
 * of a conversation with someone in their seventies — and it would make the pace of the app depend
 * on the weather. Anything this file cannot classify falls through to `question`, which IS the
 * model path, so the model is still reached for everything that genuinely needs reading.
 *
 * The bias is deliberate and one-directional: **when in doubt, treat it as a question.** Mistaking
 * a question for a yes skips a section the reader asked about and silently loses information off a
 * medical document. Mistaking a yes for a question costs one wasted answer and an offer to
 * continue, which is recoverable in a sentence.
 */
export type ReplyIntent = "continue" | "repeat" | "question";

/**
 * Utterances that mean "I followed that", as WHOLE replies.
 *
 * Whole-reply matching, not substring, and this is the important part of the design. 「係」 means
 * yes on its own, but 「白色嗰粒係朝早定夜晚食？」 is a question about a pill that happens to contain
 * it. A substring test would answer "yes" to that and move on, which is exactly the failure that
 * loses a medicine off the page.
 */
const AFFIRMATIVE_WHOLE = new Set([
  // Cantonese
  "明", "明白", "明白喇", "明喇", "明白晒", "知", "知道", "知喇", "係", "係呀", "係啊", "好", "好呀",
  "好啊", "好喇", "得", "得喇", "冇問題", "冇", "ok", "okay", "得咩", "唔該", "多謝",
  // Mandarin
  "明白了", "知道了", "是", "是的", "对", "對", "嗯", "好的", "可以", "没问题", "沒問題", "懂了", "懂",
  // English
  "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "right", "got it", "gotit", "understood",
  "i understand", "understand", "fine", "all good", "no", "nope", "no questions",
]);

/**
 * Asking for the next section outright. Longer and more specific than the bare affirmatives, so
 * these are matched as substrings — 「繼續」 inside a longer sentence still means carry on.
 */
const CONTINUE_MARKERS = [
  /繼續|继续/,
  /下一(?:樣|样|個|个|part|section)/,
  /講(?:埋|下去|落去)/,
  /讲(?:下去|下|吧)/,
  /\b(?:next|carry on|go on|keep going|continue|move on)\b/i,
];

/**
 * "I did not follow that." Checked FIRST, before anything else, because the commonest way to say
 * it in Cantonese is 「唔明」 — which contains 「明」, the commonest way to say the opposite. Any
 * ordering that tests the affirmatives first reads "I don't understand" as "I understand" and
 * marches past the thing the reader just said they did not get.
 */
const REPEAT_MARKERS = [
  /唔明|不明|不懂|唔識|不知道|唔知/,
  /唔(?:係|系)?(?:好|太)?明/,
  /再講|再讲|再說|再说|重複|重复|講多次|讲多次|講多一次|讲多一次|說多次/,
  /慢[啲點点少]|慢慢|慢一?[點点]/,
  /聽唔到|听不到|聽唔清|听不清|沒聽清|没听清/,
  /\b(?:again|repeat|pardon)\b/i,
  /\bsay that again\b/i,
  /\bdidn'?t\s+(?:catch|get|understand)/i,
  // The question mark is the whole signal here, so it cannot sit inside a \b group: `\b` after
  // `?` never matches, which silently made this arm dead.
  /\b(?:sorry|what|huh|come again)\s*[?？]/i,
];

/** A question mark in any script, or an interrogative that gives the utterance away. */
const QUESTION_MARKERS = [
  /[?？]/,
  /點解|点解|為(?:甚|什)麼|为什么|做乜|做咩|幾時|几时|邊個|哪个|邊度|哪里|可唔可以|可以不可以|係唔係|是不是|要唔要|需唔需要/,
  /\b(?:what|why|when|where|which|who|how|can i|should i|do i|is it|are they)\b/i,
];

/** Folds width, case and trailing punctuation so "Yes." and "ＹＥＳ" are the same reply. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, " ")
    .replace(/[.。!！,，、~～]+$/g, "")
    .trim();
}

/**
 * Reads one reply.
 *
 * Takes no locale on purpose. All three languages are matched at once, because a Cantonese
 * speaker answers "ok" constantly and a reader whose interface is English may still say 「明白」 —
 * narrowing the patterns to the selected language would only make the app deaf to the reader's
 * actual habits.
 */
export function classifyReply(text: string): ReplyIntent {
  const reply = normalise(text);
  if (reply.length === 0) return "question";

  // 1. "I did not follow" wins over everything, including the affirmative it contains.
  if (REPEAT_MARKERS.some((rx) => rx.test(reply))) return "repeat";

  // 2. An exact affirmative, as the whole reply.
  if (AFFIRMATIVE_WHOLE.has(reply)) return "continue";

  // 3. An explicit "keep going", anywhere in the sentence.
  if (CONTINUE_MARKERS.some((rx) => rx.test(reply))) return "continue";

  // 4. Anything interrogative is a question even if it also contains an affirmative word.
  if (QUESTION_MARKERS.some((rx) => rx.test(reply))) return "question";

  /**
   * 5. A short reply built out of affirmative words — 「明白喇，多謝」, "yes ok". Bounded at 12
   * characters so a sentence that merely opens with 「係」 cannot qualify: past that length the
   * reader is telling us something, and telling us something is a question.
   */
  if (reply.length <= 12) {
    const stripped = reply.replace(/[,\s，、]/g, "");
    for (const word of AFFIRMATIVE_WHOLE) {
      if (word.length >= 2 && stripped.startsWith(word)) return "continue";
    }
  }

  // 6. Everything else is for the model.
  return "question";
}
