"use client";

/**
 * The whole experience, on one screen.
 *
 * Reading a discharge sheet and talking about it used to be two routes (`/read` and `/ask`); the
 * product owner's direction is one conversation. So this screen is a scrolling thread with a voice
 * bar pinned at the bottom:
 *
 *   • the agent's FIRST message is the sheet itself — rule-generated, never a model turn. It is
 *     `buildCards(reading)` rendered by `components/CardStack.tsx`, which means the order guarantee
 *     (red flags first, always) lives in `lib/rules/card-order.ts`, not in any model choice.
 *   • every question the user asks appends to the same thread: a right-aligned bubble for the
 *     question, then the answer as an assistant message (`AnswerCard` / `ReferralCard`), inline.
 *   • the voice bar (`components/VoiceBar.tsx`) is always reachable once a sheet has been read.
 *
 * `/ask` now redirects here (`app/ask/page.tsx`), so old links still work.
 *
 * Three ways to arrive at a reading, in the order they are tried:
 *   `?sample=hk_en`   a bundled sheet (FR-023), banner and all;
 *   pending images    the pages `components/Capture.tsx` just downscaled;
 *   stored reading    what is already on the phone (a bookmark, or `/ask` redirecting in).
 *
 * **The one transient use of image bytes.** `sessionStorage["fitornot.pending-images"]` exists only
 * to carry the downscaled pages across a single client navigation, because a route change cannot
 * take a File in its URL. It is read once and removed in a `finally` before the request even
 * resolves, so the bytes live in this tab for a few milliseconds and nowhere else (FR-018).
 *
 * **Privacy is unchanged.** The read request carries only the pixels; the ask request carries only
 * the reading, the question and the dialect (assembled field by field in `lib/client/*`). The crisis
 * and medicine-change gates answer with ZERO network calls, and a crisis question is never written
 * to memory. Nothing speaks without a user gesture (iOS).
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import AgentLimits from "@/components/AgentLimits";
import AnswerCard, { type AnswerCardOutcome } from "@/components/AnswerCard";
import CardStack from "@/components/CardStack";
import DeclineState, { type DeclineVariant } from "@/components/DeclineState";
import { useLocale } from "@/components/LocaleProvider";
import type { MicState } from "@/components/MicButton";
import ProgressLine, { type ProgressStep } from "@/components/ProgressLine";
import ReferralCard from "@/components/ReferralCard";
import SampleBanner from "@/components/SampleBanner";
import UiLanguageToggle from "@/components/UiLanguageToggle";
import VoiceBar from "@/components/VoiceBar";
import { PENDING_IMAGES_KEY } from "@/components/Capture";
import { ask, type AskOutcome, type AskReferral } from "@/lib/client/ask-stream";
import { DEFAULT_SAMPLE, filterCards, isSampleId, loadSampleReading } from "@/lib/client/sample";
import { readSheet, type ImageInput } from "@/lib/client/read-stream";
import { downscale } from "@/lib/image/downscale";
import type {
  Card,
  InputLanguage,
  SourceReference,
  Speakable,
  StoredReading,
} from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";
import { memoryBrief, rememberExchange, rememberReading } from "@/lib/memory";
import { buildCards, cardTitle } from "@/lib/rules/card-order";
import { crisisReferral, detectCrisis } from "@/lib/rules/crisis";
import { detectMedicineChange } from "@/lib/rules/refusal";
import { CAUTION_SUFFIX, REFUSED_MEDICINE_CHANGE } from "@/lib/rules/template-fallback";
import { prefetch, speak, stopSpeaking } from "@/lib/speech/tts";
import { loadState, saveReading, subscribe } from "@/lib/storage/local";

/**
 * Copy with no key in `lib/i18n/ui.ts`. Same rules as everything there: no 診斷/治療/處方/治癒,
 * no 能吃/唔食得, no "you should", no number about the person.
 */
const LOCAL: Record<"plan" | "answersHere" | "history", Record<UiLocale, string>> = {
  // The screen's own, longer heading for the plan link.
  plan: { hant: "計劃", hans: "计划", en: "Plan" },
  answersHere: {
    hant: "問張紙上面嘅嘢，答案會出喺呢度。",
    hans: "问这张纸上面的事，答案会出现在这里。",
    en: "Ask about what is on the sheet. The answer appears here.",
  },
  history: { hant: "頭先問過", hans: "刚才问过", en: "Asked earlier" },
};

export default function ReadPage() {
  // useSearchParams needs a boundary; the fallback is the same first step the reading starts on.
  return (
    <Suspense fallback={<Booting />}>
      <ReadScreen />
    </Suspense>
  );
}

function Booting() {
  return <div className="mx-auto w-full max-w-md flex-1 px-5 pt-4" aria-hidden="true" />;
}

/** Long edge for the one retry after a 413 (contracts/api-read.md). 1200 px keeps 9 pt print legible. */
const RETRY_LONG_EDGE = 1200;

/**
 * Re-encodes already-downscaled pages at a smaller long edge, in memory only. Returns null when
 * the browser cannot decode them, in which case the caller shows the honest decline instead.
 */
async function shrinkImages(images: ImageInput[], maxLongEdge: number): Promise<ImageInput[] | null> {
  try {
    const smaller: ImageInput[] = [];
    for (const image of images) {
      const blob = await (await fetch(`data:${image.mediaType};base64,${image.base64}`)).blob();
      const { mediaType, base64 } = await downscale(blob, maxLongEdge);
      smaller.push({ mediaType, base64 });
    }
    return smaller;
  } catch {
    return null;
  }
}

type Status = "loading" | "cards" | "declined";

/** How many earlier questions stay on screen. In memory only, never persisted. */
const HISTORY_LIMIT = 5;

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

function ReadScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dialect, script, locale, t } = useLocale();

  /* ---------------------------------------------------------- the reading */

  const [status, setStatus] = useState<Status>("loading");
  const [step, setStep] = useState<ProgressStep>(1);
  const [cards, setCards] = useState<Card[]>([]);
  const [reading, setReading] = useState<StoredReading | null>(null);
  const [sample, setSample] = useState(false);
  const [variant, setVariant] = useState<DeclineVariant>("notASheet");
  const started = useRef(false);

  const profileLabel = useProfileLabel();

  /* ----------------------------------------------------------- the ask */

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
   * How tall the fixed disclaimer footer actually is right now. This screen pins a panel to the
   * bottom edge, so it needs the measured height rather than the reserved `--disclaimer-height`: the
   * footer wraps to four lines in English and to two in Chinese, and a composer half-hidden behind
   * it would be worse than a little empty ground. Null until measured.
   */
  const [footerHeight, setFooterHeight] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const historyId = useRef(0);
  /** Bumped on every answer stop; an outdated `speak` result is ignored rather than believed. */
  const playToken = useRef(0);
  /** The sheet message hands its own stop here, so playing an answer can silence the sheet. */
  const sheetStop = useRef<(() => void) | null>(null);
  /** The current question + its answer, scrolled into view when a new question lands. */
  const exchangeRef = useRef<HTMLDivElement | null>(null);

  /* ------------------------------------------------------- reading flow */

  /**
   * Warm the audio for every card, in the dialect on screen, caution sentence included, so the
   * first tap is answered from cache. This runs in the BACKGROUND: the sheet is already read and
   * on screen, so a slow cloud voice must never hold the reading behind a progress illustration
   * (design.md 4, "big and calm"). Best-effort and never throws.
   */
  const warm = useCallback(
    (list: Card[]) => {
      void prefetch(
        list.map((card) => ({
          text: `${card.body[dialect]} ${CAUTION_SUFFIX[dialect]}`,
          dialect,
        })),
      );
    },
    [dialect],
  );

  const showSample = useCallback(async () => {
    setStatus("loading");
    setStep(1);
    const { reading: sampleReading, cards: sampleCards } = await loadSampleReading(DEFAULT_SAMPLE);
    saveReading(sampleReading);
    rememberReading(sampleReading, dialect);
    setCards(sampleCards);
    setReading(sampleReading);
    setSample(true);
    setStatus("cards");
    warm(sampleCards);
  }, [dialect, warm]);

  const decline = useCallback((next: DeclineVariant) => {
    setVariant(next);
    setStatus("declined");
  }, []);

  const begin = useCallback(async () => {
    const requested = searchParams.get("sample");
    if (isSampleId(requested)) {
      const { reading: sampleReading, cards: sampleCards } = await loadSampleReading(requested);
      saveReading(sampleReading);
      rememberReading(sampleReading, dialect);
      setCards(sampleCards);
      setReading(sampleReading);
      setSample(true);
      setStatus("cards");
      warm(sampleCards);
      return;
    }

    const images = takePendingImages();
    if (images) {
      const arriving: Card[] = [];
      const handlers = {
        onStatus: () => setStep(1),
        onCard: (card: Card) => {
          arriving.push(card);
          setCards([...arriving]);
          setStep(2);
          setStatus("cards");
        },
      };
      let outcome = await readSheet(images, handlers);

      // contracts/api-read.md: on 413 the client re-downscales and retries once. The pages are
      // shrunk further in memory (never stored) and sent again; a second 413 falls through to the
      // honest decline below.
      if (outcome.kind === "too_large") {
        const smaller = await shrinkImages(images, RETRY_LONG_EDGE);
        if (smaller) outcome = await readSheet(smaller, handlers);
      }

      switch (outcome.kind) {
        case "reading":
          saveReading(outcome.reading);
          rememberReading(outcome.reading, dialect);
          setCards(outcome.cards);
          setReading(outcome.reading);
          setSample(false);
          setStatus("cards");
          warm(outcome.cards);
          return;
        case "unknown":
          setCards([]);
          decline("notASheet");
          return;
        case "invalid_reading":
        case "bad_request":
        case "too_large":
          setCards([]);
          decline("invalidReading");
          return;
        case "model_unavailable":
          setCards([]);
          decline("modelUnavailable");
          return;
      }
    }

    // Nothing new to read: show what is already on the phone (a bookmark, or /ask redirecting in).
    const stored = loadState().reading;
    if (stored) {
      // Rebuilt cards have not been through the route's filter, so run the gate again here.
      const rebuilt = filterCards(buildCards(stored));
      setCards(rebuilt);
      setReading(stored);
      setSample(stored.sample === true);
      setStatus("cards");
      warm(rebuilt);
      return;
    }

    router.replace("/");
  }, [decline, dialect, router, searchParams, warm]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  /* --------------------------------------------------------- ask flow */

  // Re-measured on every reflow: rotation, a text-size change, or the interface language moving the
  // footer from two lines to four.
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer || typeof ResizeObserver === "undefined") return;
    const read = () => setFooterHeight(footer.getBoundingClientRect().height);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  // The question defaults to the language the parent listens in, and stays wherever the user puts it.
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

  const citedCardId = answer?.citedCardId ?? null;
  const citedCard = citedCardId ? (cards.find((c) => c.id === citedCardId) ?? null) : null;
  const hospitalContact = reading?.hospitalContact?.text?.trim() || null;

  const remember = useCallback((text: string, outcome: AskOutcome) => {
    historyId.current += 1;
    const entry: HistoryEntry = { id: historyId.current, text, outcome };
    setHistory((previous) => [entry, ...previous].slice(0, HISTORY_LIMIT));
  }, []);

  /** Stop the ANSWER voice. Also handed to the sheet as `onSpeakStart`, so the sheet stops it too. */
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
      sheetStop.current?.();
      setVoiceUnavailable(false);
      setFromVoice(false);
      setInterim("");

      // Gate 1: crisis. The referral replaces the answer and nothing is sent (FR-014). Never
      // remembered — a crisis question is neither posted nor written to the device.
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

      // What this phone already knows, in one short paragraph, built locally from the memory store
      // and sent with the question so the answer can be continuous; "" when there is nothing to
      // say, and never anything that identifies the person.
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

  /** Speaks the answer. Never called on its own: the tap is the gesture iOS needs (FR-008). */
  const play = useCallback(async () => {
    const spoken = answer?.answer;
    if (!spoken) return;
    stop();
    sheetStop.current?.();
    const token = playToken.current;
    setPlaying(true);
    // The caution sentence is appended by the caller, every time (FR-008).
    const { mode } = await speak(`${spoken[dialect]} ${CAUTION_SUFFIX[dialect]}`, dialect);
    if (playToken.current !== token) return;
    setPlaying(false);
    setVoiceUnavailable(mode === "text-only");
  }, [answer, dialect, stop]);

  /** Empties the composer. Never touches an answer already in the thread. */
  const clearQuestion = useCallback(() => {
    setQuestionText("");
    setInterim("");
    setFromVoice(false);
  }, []);

  const lastQuestion = history[0] ?? null;
  const lastQuestionId = lastQuestion?.id ?? null;
  const earlier = history.slice(1);
  const pending = interim || (fromVoice ? questionText : "");

  // Bring a new question (and the answer forming under it) into view, past the tall sheet above.
  // Keyed on the id, not the object, so it fires once per question rather than on every render.
  useEffect(() => {
    if (lastQuestionId === null) return;
    exchangeRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [lastQuestionId]);

  // The referral replaces the answer, so it is the one outcome `AnswerCard` never renders.
  const cardOutcome: AnswerCardOutcome | null =
    answer && answer.outcome !== "crisis_referral" ? answer.outcome : null;

  // The reading progress shows only while the sheet is actually being read — not during the
  // background audio prewarm, which leaves the sheet on screen (design.md 4).
  const busy = status === "loading";

  return (
    // A fixed height, not `flex-1`: the voice bar is pinned to the bottom of the screen the way a
    // keyboard accessory is, and the conversation scrolls behind it. The subtraction is the fixed
    // disclaimer footer (rules.md 16); the class is the reserved figure, the inline style is the
    // footer's real height once it has been measured.
    <main
      className="mx-auto flex h-[calc(100dvh-var(--disclaimer-height)-env(safe-area-inset-bottom))] w-full max-w-md flex-col overflow-hidden"
      style={
        footerHeight === null ? undefined : { height: `calc(100dvh - ${Math.ceil(footerHeight)}px)` }
      }
    >
      {/* The iOS large title: the sheet, then in one quiet line who it is being read to. */}
      <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-[22px]">
        <div className="min-w-0">
          <h1 className="text-display font-bold text-ink">{t("cards.header")}</h1>
          {profileLabel ? (
            <p className="mt-0.5 text-meta text-muted">
              {t("cards.forLabel").replace("{label}", profileLabel)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* S8 is reached from here: the plan is only offered once a sheet has been read. */}
          <Link
            href="/plan"
            className="tap rounded-full px-1 text-meta font-semibold text-accent underline underline-offset-4"
          >
            {LOCAL.plan[locale]}
          </Link>
          <UiLanguageToggle />
        </div>
      </header>

      {status === "declined" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4">
          <DeclineState
            variant={variant}
            onRetake={() => router.push("/")}
            onSample={() => void showSample()}
          />
          <AgentLimits className="mt-6" />
        </div>
      ) : (
        <>
          {/* --- the conversation ------------------------------------------- */}
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-4 pb-4">
            {busy ? <ProgressLine step={step} /> : null}

            {/* The agent's first message: the sheet, rule-generated, red flags first. */}
            {cards.length > 0 ? (
              <div>
                <CardStack
                  cards={cards}
                  address={profileLabel}
                  onSpeakStart={stop}
                  stopRef={sheetStop}
                >
                  {sample ? <SampleBanner /> : null}
                </CardStack>
              </div>
            ) : null}

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

            {/* the current question and the answer it belongs to */}
            <div ref={exchangeRef} className="flex flex-col gap-3.5">
              {lastQuestion ? (
                <div className="flex justify-end">
                  <p className="max-w-[82%] rounded-[20px_20px_6px_20px] bg-track px-4 py-3 text-[17px] leading-[1.5] break-words text-ink">
                    {lastQuestion.text}
                  </p>
                </div>
              ) : null}

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
                ) : reading && history.length === 0 && !pending ? (
                  <p className="px-1 text-body leading-relaxed text-muted">
                    {LOCAL.answersHere[locale]}
                  </p>
                ) : null}
              </div>
            </div>

            {/* the transcript, with an edit affordance before sending */}
            {pending ? (
              <section aria-label={t("ask.title")} className="flex flex-col items-end gap-1.5">
                <p className="text-fine text-muted">{interim ? t("ask.holding") : t("ask.edit")}</p>
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

          {/* --- the pinned voice bar: only once there is a sheet to ask about --- */}
          {reading ? (
            <VoiceBar
              inputLanguage={inputLanguage}
              onInputLanguageChange={(next) => {
                languageChosen.current = true;
                setInputLanguage(next);
              }}
              text={questionText}
              onTextChange={(value) => {
                setQuestionText(value);
                setFromVoice(false);
              }}
              onSubmit={() => void submit(questionText)}
              onClear={clearQuestion}
              interim={interim}
              micState={micState}
              onMicState={setMicState}
              onInterim={setInterim}
              onTranscript={(text) => {
                setInterim("");
                setQuestionText(text);
                // Shown for review first: nothing is sent until the user taps 問.
                setFromVoice(true);
              }}
              disabled={asking}
              inputRef={inputRef}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

/**
 * Reads the pages Capture left behind and deletes them in the same breath. Returns null when
 * there is nothing pending or the payload is not what Capture writes.
 */
function takePendingImages(): ImageInput[] | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_IMAGES_KEY);
    if (raw === null) return null;
  } catch {
    return null;
  } finally {
    // Always, even if the parse below throws: the bytes do not get a second chance to linger.
    try {
      window.sessionStorage.removeItem(PENDING_IMAGES_KEY);
    } catch {
      // Private mode. Nothing was written, so nothing is left.
    }
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const images: ImageInput[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) return null;
      const { mediaType, base64 } = entry as { mediaType?: unknown; base64?: unknown };
      if (mediaType !== "image/jpeg" || typeof base64 !== "string" || base64.length === 0) {
        return null;
      }
      images.push({ mediaType, base64 });
    }
    return images;
  } catch {
    return null;
  }
}

/**
 * The relationship label, if there is a profile. The snapshot is a primitive on purpose:
 * `loadState()` parses a fresh object every call, which `useSyncExternalStore` would loop on.
 */
function readProfileLabel(): string {
  return loadState().profile?.label ?? "";
}
function serverProfileLabel(): string {
  return "";
}
function useProfileLabel(): string {
  return useSyncExternalStore(subscribe, readProfileLabel, serverProfileLabel);
}
