"use client";

/**
 * S6 Ask — the screen that makes this an agent rather than a reader.
 *
 * The order of operations is the whole point, and it is the same order the server uses
 * (contracts/api-ask.md):
 *
 *   1. `detectCrisis` — a hit shows the referral card and NO request is made.
 *   2. `detectMedicineChange` — a hit shows the pharmacist refusal and NO request is made.
 *   3. Only what survives both gates is sent to `/api/ask`.
 *
 * Running the gates here as well as on the server is not belt-and-braces for its own sake: it
 * means a crisis question and a "can she skip it?" question never leave the phone at all
 * (constitution principle V), and the answer appears instantly.
 *
 * The list of earlier questions on screen lives in component state and dies with the tab. What
 * does outlive it is the memory entry (`lib/memory/`) for an exchange that actually produced
 * something: the question, the outcome, and the cited card id, on this device only. A crisis
 * question is the deliberate exception — gate 1 returns before any record is made, so it is
 * neither sent nor written down, ever. Nothing is logged either: neither the question nor the
 * answer touches `console`.
 *
 * Speech never starts on its own. `speak` runs from the play control's own tap, which is both
 * the iOS autoplay rule and a courtesy to whoever is in the room (design.md section 7).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AgentLimits from "@/components/AgentLimits";
import AnswerCard, { type AnswerCardOutcome } from "@/components/AnswerCard";
import LanguageToggle from "@/components/LanguageToggle";
import MicButton, { type MicState } from "@/components/MicButton";
import ReferralCard from "@/components/ReferralCard";
import { useLocale } from "@/components/LocaleProvider";
import { ask, type AskOutcome, type AskReferral } from "@/lib/client/ask-stream";
import type {
  InputLanguage,
  SourceReference,
  Speakable,
  StoredReading,
} from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";
import { memoryBrief, rememberExchange } from "@/lib/memory";
import { buildCards, cardTitle } from "@/lib/rules/card-order";
import { crisisReferral, detectCrisis } from "@/lib/rules/crisis";
import { detectMedicineChange } from "@/lib/rules/refusal";
import { CAUTION_SUFFIX, REFUSED_MEDICINE_CHANGE } from "@/lib/rules/template-fallback";
import { speak, stopSpeaking } from "@/lib/speech/tts";
import { loadState, subscribe } from "@/lib/storage/local";

/**
 * Copy with no key in `lib/i18n/ui.ts` yet. Same rules as everything there: no 診斷/治療/處方/
 * 治癒, no 能吃/唔食得, no "you should", no number about the person.
 */
const LOCAL: Record<
  | "noReading"
  | "history"
  | "backToSheet"
  | "sheetShort"
  | "answersHere"
  | "micUnavailable"
  | "typeHere"
  | "clear",
  Record<UiLocale, string>
> = {
  noReading: {
    hant: "仲未讀過出院紙。讀咗張紙先，就可以問佢。",
    hans: "还没读过出院纸。先把这张纸读一遍，就可以问它。",
    en: "No sheet has been read yet. Read one first and you can ask about it.",
  },
  answersHere: {
    hant: "問張紙上面嘅嘢，答案會出喺呢度。",
    hans: "问这张纸上面的事，答案会出现在这里。",
    en: "Ask about what is on the sheet. The answer appears here.",
  },
  micUnavailable: {
    hant: "而家聽唔到你講嘢，打字問就得。",
    hans: "现在听不到你说话，打字问就行。",
    en: "Speech input isn't available here. Type the question instead.",
  },
  history: { hant: "頭先問過", hans: "刚才问过", en: "Asked earlier" },
  backToSheet: { hant: "返去張紙", hans: "回到这张纸", en: "Back to the sheet" },
  // The visible half of the same link; the full phrase above stays its accessible name.
  sheetShort: { hant: "張紙", hans: "这张纸", en: "Sheet" },
  // The placeholder inside the capsule. The field's own label keeps `ask.placeholder`, which is
  // the sentence a screen reader hears; this is the short form that fits the box.
  typeHere: { hant: "打字問…", hans: "打字问…", en: "Type a question…" },
  clear: { hant: "清走", hans: "清掉", en: "Clear" },
};

interface AnswerState {
  outcome: AskOutcome;
  answer?: Speakable;
  citedCardId?: string;
  source?: SourceReference;
  referral?: AskReferral;
  /** The language this particular question was asked in; the referral card follows it. */
  inputLanguage: InputLanguage;
}

interface HistoryEntry {
  id: number;
  text: string;
  outcome: AskOutcome;
}

/** How many earlier questions stay on screen. In memory only, never persisted. */
const HISTORY_LIMIT = 5;

export default function AskPage() {
  const { dialect, script, locale, hydrated: localeHydrated, t } = useLocale();

  const [reading, setReading] = useState<StoredReading | null>(null);
  const [storageRead, setStorageRead] = useState(false);

  const [inputLanguage, setInputLanguage] = useState<InputLanguage>("yue");
  const languageChosen = useRef(false);

  const [questionText, setQuestionText] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [interim, setInterim] = useState("");
  const [micState, setMicState] = useState<MicState>("idle");

  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [asking, setAsking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  /**
   * How tall the fixed disclaimer footer actually is right now. This screen is the one that pins
   * a panel to the bottom edge, so it needs the measured height rather than the reserved
   * `--disclaimer-height`: the footer wraps to four lines in English and to two in Chinese, and a
   * composer half-hidden behind it would be worse than a little empty ground. Null until measured,
   * where the reserved height is used instead.
   */
  const [footerHeight, setFooterHeight] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const historyId = useRef(0);
  /** Bumped on every stop; an outdated `speak` result is ignored rather than believed. */
  const playToken = useRef(0);

  /* ------------------------------------------------------------ the reading */

  useEffect(() => {
    const apply = () => {
      setReading(loadState().reading ?? null);
      setStorageRead(true);
    };
    apply();
    return subscribe(apply);
  }, []);

  // Re-measured on every reflow: rotation, a text-size change, or the interface language moving
  // the footer from two lines to four.
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer || typeof ResizeObserver === "undefined") return;
    const read = () => setFooterHeight(footer.getBoundingClientRect().height);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  // The question defaults to the language the parent listens in, and stays wherever the user
  // puts it after that.
  useEffect(() => {
    if (!languageChosen.current) setInputLanguage(dialect);
  }, [dialect]);

  // Leaving the screen stops the voice and drops any request still in flight.
  useEffect(
    () => () => {
      stopSpeaking();
      requestRef.current?.abort();
    },
    [],
  );

  const cards = useMemo(() => (reading ? buildCards(reading) : []), [reading]);
  const citedCardId = answer?.citedCardId ?? null;
  const citedCard = citedCardId ? (cards.find((c) => c.id === citedCardId) ?? null) : null;
  const hospitalContact = reading?.hospitalContact?.text?.trim() || null;

  /* -------------------------------------------------------------- asking */

  const remember = useCallback((text: string, outcome: AskOutcome) => {
    historyId.current += 1;
    const entry: HistoryEntry = { id: historyId.current, text, outcome };
    setHistory((previous) => [entry, ...previous].slice(0, HISTORY_LIMIT));
  }, []);

  const stop = useCallback(() => {
    // Bumping the token first means the in-flight `speak` below cannot report "no voice on this
    // phone" just because the user stopped it.
    playToken.current += 1;
    stopSpeaking();
    setPlaying(false);
  }, []);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || asking) return;

      stop();
      setVoiceUnavailable(false);
      setFromVoice(false);
      setInterim("");

      // Gate 1: crisis. The referral replaces the answer and nothing is sent (FR-014).
      if (detectCrisis(text).crisis) {
        setAnswer({
          outcome: "crisis_referral",
          referral: crisisReferral(inputLanguage),
          inputLanguage,
        });
        remember(text, "crisis_referral");
        return;
      }

      // Gate 2: a question about changing a medicine. Fixed template, nothing sent (FR-011).
      if (detectMedicineChange(text).refuse) {
        setAnswer({
          outcome: "refused_medicine_change",
          answer: REFUSED_MEDICINE_CHANGE,
          inputLanguage,
        });
        remember(text, "refused_medicine_change");
        rememberExchange({ question: text, outcome: "refused_medicine_change" });
        return;
      }

      if (!reading) return;

      setAsking(true);
      setAnswer(null);
      const controller = new AbortController();
      requestRef.current = controller;

      // What this phone already knows, in one short paragraph. Built locally from the memory
      // store and sent with the question so the answer can be continuous; "" when there is
      // nothing to say, and never anything that identifies the person.
      const brief = memoryBrief();

      const result = await ask(
        { reading, question: { text, inputLanguage }, dialect, memory: brief },
        {
          signal: controller.signal,
          // The outcome lands before the sentence does, so the card can style itself first.
          onOutcome: (event) =>
            setAnswer({
              outcome: event.outcome,
              citedCardId: event.citedCardId,
              source: event.source,
              inputLanguage,
            }),
          onAnswer: (spoken) =>
            setAnswer((previous) => (previous ? { ...previous, answer: spoken } : previous)),
        },
      );

      requestRef.current = null;
      setAnswer({
        outcome: result.outcome,
        answer: result.answer,
        citedCardId: result.citedCardId,
        source: result.source,
        referral: result.referral,
        inputLanguage,
      });
      remember(text, result.outcome);
      rememberExchange({
        question: text,
        outcome: result.outcome,
        citedCardId: result.citedCardId ?? null,
      });
      setAsking(false);
    },
    [asking, dialect, inputLanguage, reading, remember, stop],
  );

  /* -------------------------------------------------------------- speaking */

  const play = useCallback(async () => {
    const spoken = answer?.answer;
    if (!spoken) return;
    stop();
    const token = playToken.current;
    setPlaying(true);
    // The caution sentence is appended by the caller, every time (FR-008).
    const { mode } = await speak(`${spoken[dialect]} ${CAUTION_SUFFIX[dialect]}`, dialect);
    if (playToken.current !== token) return;
    setPlaying(false);
    setVoiceUnavailable(mode === "text-only");
  }, [answer, dialect, stop]);

  /** Empties the composer. Never touches the answer already on screen. */
  const clearQuestion = useCallback(() => {
    setQuestionText("");
    setInterim("");
    setFromVoice(false);
  }, []);

  /* ---------------------------------------------------------------- render */

  const ready = storageRead && localeHydrated;
  // The referral replaces the answer, so it is the one outcome `AnswerCard` never renders.
  const cardOutcome: AnswerCardOutcome | null =
    answer && answer.outcome !== "crisis_referral" ? answer.outcome : null;
  const micHint =
    micState === "unavailable"
      ? LOCAL.micUnavailable[locale]
      : micState === "held"
        ? t("ask.holding")
        : micState === "processing"
          ? t("ask.processing")
          : t("ask.hold");

  // The middle of the composer is a waveform while the mic is capturing, and the typed field the
  // rest of the time. The field stays mounted either way so its ref never goes stale.
  const listening = micState === "held" || micState === "processing";
  const lastQuestion = history[0] ?? null;
  const earlier = history.slice(1);
  const pending = interim || (fromVoice ? questionText : "");

  return (
    // A fixed height, not `flex-1`: the composer is pinned to the bottom of the screen the way a
    // keyboard accessory is, and the conversation scrolls behind it. The subtraction is the fixed
    // disclaimer footer (rules.md 16); the class is the reserved figure, the inline style is the
    // footer's real height once it has been measured.
    <main
      className="mx-auto flex h-[calc(100dvh-var(--disclaimer-height)-env(safe-area-inset-bottom))] w-full max-w-[430px] flex-col overflow-hidden"
      style={
        footerHeight === null
          ? undefined
          : { height: `calc(100dvh - ${Math.ceil(footerHeight)}px)` }
      }
    >
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 pt-[22px]">
        <h1 className="text-display font-bold text-ink">{t("ask.title")}</h1>
        {/* The full phrase stays the accessible name; the screen only needs the short half. */}
        <Link
          href="/read"
          aria-label={LOCAL.backToSheet[locale]}
          className="tap shrink-0 gap-1 px-1 text-[16px] font-semibold text-accent"
        >
          <ChevronGlyph />
          <span>{LOCAL.sheetShort[locale]}</span>
        </Link>
      </header>

      {!ready ? (
        <div className="flex-1" aria-hidden="true" />
      ) : !reading ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-[18px] pb-4">
          <section className="surface flex flex-col gap-4 p-[18px]">
            <p className="text-body leading-relaxed text-ink">{LOCAL.noReading[locale]}</p>
            <Link
              href="/"
              className="tap h-12 w-full rounded-full bg-accent px-4 text-body font-bold text-accent-ink"
            >
              {t("capture.title")}
            </Link>
          </section>
        </div>
      ) : (
        <>
          {/* --- the conversation ------------------------------------------- */}
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-[18px] pb-4">
            {/* earlier questions this session (memory only, never persisted) */}
            {earlier.length > 0 ? (
              <section aria-label={LOCAL.history[locale]} className="flex flex-col gap-2">
                <h2 className="sr-only">{LOCAL.history[locale]}</h2>
                {[...earlier].reverse().map((entry) => (
                  <div key={entry.id} className="flex justify-end">
                    <p className="max-w-[82%] rounded-[20px_20px_6px_20px] bg-track px-3.5 py-2 text-meta break-words text-muted">
                      {entry.text}
                    </p>
                  </div>
                ))}
              </section>
            ) : null}

            {/* the question this answer belongs to */}
            {lastQuestion ? (
              <div className="flex justify-end">
                <p className="max-w-[82%] rounded-[20px_20px_6px_20px] bg-track px-4 py-3 text-[17px] leading-[1.5] break-words text-ink">
                  {lastQuestion.text}
                </p>
              </div>
            ) : null}

            {/* --- the answer ---------------------------------------------- */}
            <div aria-live="polite">
              {answer?.outcome === "crisis_referral" ? (
                <ReferralCard
                  inputLanguage={answer.inputLanguage}
                  text={answer.referral?.text}
                  resources={answer.referral?.resources}
                />
              ) : cardOutcome && answer ? (
                <AnswerCard
                  outcome={cardOutcome}
                  answer={answer.answer}
                  citedCardTitle={citedCard ? cardTitle(citedCard.type, script) : null}
                  source={answer.source ?? citedCard?.source ?? null}
                  hospitalContact={hospitalContact}
                  onPlay={play}
                  onStop={stop}
                  playing={playing}
                  voiceUnavailable={voiceUnavailable}
                  onRetry={() => void submit(questionText)}
                />
              ) : asking ? (
                <p className="px-1 text-body text-muted">{t("ask.processing")}</p>
              ) : (
                <p className="px-1 text-body leading-relaxed text-muted">
                  {LOCAL.answersHere[locale]}
                </p>
              )}
            </div>

            {/* --- the transcript, with an edit affordance before sending ---- */}
            {pending ? (
              <section aria-label={t("ask.title")} className="flex flex-col items-end gap-1.5">
                <p className="text-fine text-muted">
                  {interim ? t("ask.holding") : t("ask.edit")}
                </p>
                <p className="max-w-[82%] rounded-[20px_20px_6px_20px] bg-track px-4 py-3 text-[17px] leading-[1.5] break-words text-ink">
                  {pending}
                </p>
                {!interim ? (
                  <button
                    type="button"
                    onClick={() => {
                      inputRef.current?.focus();
                      inputRef.current?.select();
                    }}
                    className="tap rounded-full px-2 text-fine font-semibold text-accent"
                  >
                    {t("ask.edit")}
                  </button>
                ) : null}
              </section>
            ) : null}

            {/* FR-022: what the agent will and will not do, on the screen with the mic. */}
            <AgentLimits className="mt-1" />
          </div>

          {/* --- ask: language, mic, typed box ----------------------------- */}
          <div className="shrink-0 rounded-t-[24px] bg-panel px-4 pt-3.5 pb-4">
            {/* The bars animation. globals.css turns it off under prefers-reduced-motion. */}
            <style>{
              "@keyframes askBars{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}"
            }</style>

            <LanguageToggle
              value={inputLanguage}
              onChange={(next) => {
                languageChosen.current = true;
                setInputLanguage(next);
              }}
              disabled={asking}
            />

            <form
              className="mt-3.5 flex items-center gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(questionText);
              }}
            >
              <button
                type="button"
                aria-label={LOCAL.clear[locale]}
                onClick={clearQuestion}
                disabled={asking || (questionText.length === 0 && interim.length === 0)}
                className="tap h-[52px] w-[52px] shrink-0 rounded-full bg-track text-muted disabled:opacity-40"
              >
                <CloseGlyph />
              </button>

              <div className="relative flex h-[52px] min-w-0 flex-1 items-center rounded-full bg-card pr-[2px] pl-4 shadow-[inset_0_0_0_1px_rgba(31,27,22,0.05)]">
                <label className="sr-only" htmlFor="ask-question">
                  {t("ask.placeholder")}
                </label>
                <input
                  id="ask-question"
                  ref={inputRef}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  enterKeyHint="send"
                  value={questionText}
                  placeholder={LOCAL.typeHere[locale]}
                  onChange={(event) => {
                    setQuestionText(event.target.value);
                    setFromVoice(false);
                  }}
                  className={`h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted ${
                    listening ? "invisible" : ""
                  }`}
                />
                <button
                  type="submit"
                  aria-label={t("ask.send")}
                  disabled={asking || questionText.trim().length === 0}
                  className={`tap h-12 w-12 shrink-0 rounded-full bg-accent text-accent-ink disabled:opacity-40 ${
                    listening ? "invisible" : ""
                  }`}
                >
                  <SendGlyph />
                </button>
                {listening ? <Waveform /> : null}
              </div>

              <MicButton
                language={inputLanguage}
                disabled={asking}
                onStateChange={setMicState}
                onInterim={setInterim}
                onTranscript={(text) => {
                  setInterim("");
                  setQuestionText(text);
                  // Shown for review first: nothing is sent until the user taps 問.
                  setFromVoice(true);
                }}
                onUnavailable={() => inputRef.current?.focus()}
              />
            </form>

            <p className="mt-3 text-center text-fine text-muted">{micHint}</p>
          </div>
        </>
      )}
    </main>
  );
}

/** Seven bars breathing under the words being spoken. Decorative: the transcript is the truth. */
const BARS: readonly { height: number; opacity: number; delay: number | null }[] = [
  { height: 8, opacity: 0.35, delay: null },
  { height: 14, opacity: 0.55, delay: 0 },
  { height: 22, opacity: 1, delay: 0.1 },
  { height: 30, opacity: 1, delay: 0.2 },
  { height: 22, opacity: 1, delay: 0.3 },
  { height: 14, opacity: 0.55, delay: 0.4 },
  { height: 8, opacity: 0.35, delay: null },
];

function Waveform() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center gap-[3px] rounded-full bg-card"
    >
      {BARS.map((bar, index) => (
        <span
          key={index}
          className="w-[3px] rounded-[2px] bg-accent"
          style={{
            height: `${bar.height}px`,
            opacity: bar.opacity,
            transformOrigin: "center",
            animation: bar.delay === null ? undefined : `askBars 1s ease-in-out ${bar.delay}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

function ChevronGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 6l-6 6 6 6" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}
