"use client";

/**
 * 傾偈 — the whole product, as one conversation with 明明 (v2 build brief §6).
 *
 * The sheet does not arrive as a stack of cards. It arrives as messages: 明明 types himself out
 * clause by clause and speaks at the same time, one thing at a time, and takes questions in the
 * same thread. There is **no play button anywhere** — the 讀住 waveform is a status indicator, the
 * per-message speaker is the only repeat control, and the header toggle silences the lot.
 *
 * ── What changed from the first build, and why ───────────────────────────────────────────────
 *
 * It stopped after every card and waited for a 明白 button. That is not a conversation, it is a
 * form with a progress bar, and it read as an interrogation: 明唔明？ 明唔明？ 明唔明？ So the
 * briefing is a **script that plays itself** now (`buildBeats`): a greeting, the red flags one at a
 * time, ONE teach-back question with no button behind it, then the rest of the page with a quiet
 * connective in front of each run, then a closing line. The reader takes the floor by holding the
 * bar, at any point, which is what stops the talking — not a button that exists to be pressed.
 *
 * ── What is a rule here and what is a model turn ─────────────────────────────────────────────
 *
 * The **order** is `lib/rules/card-order.ts` and nothing else, and `buildBeats` walks it. Warning
 * signs are spoken first by construction, and no model output and no reader action can reorder,
 * delay or bury them (constitution II). The greeting, the connectives, the teach-back question,
 * the closing line, the refusals and every reply to 食咗 / 未食 are fixed templates from
 * `lib/i18n/ui.ts` with the page's own clause dropped into the slot verbatim — a model never
 * assembles one of those sentences. The **crisis and medicine-change gates run before any network
 * call**, and a crisis question is answered from a fixed list with nothing sent. The only
 * model-written strings on this screen are the card bodies and the answers, and both carry the AI
 * chip.
 *
 * ── The three things that are deliberately NOT the design canvas ────────────────────────────
 *
 *   1. The canvas replies 「夜晚仲有一次」 after 食咗. The sheet prints a frequency, never a time
 *      of day, so this says 「今日仲有 N 次」 (`checkin.tookReply`). Naming an evening dose the
 *      page never printed would be prescribing.
 *   2. The canvas answers 未食 with 「記得飯後食一粒。我陣間再問你。」 — an instruction in the app's
 *      own voice, and a promise of a notification that cannot exist. 未食 quotes the printed
 *      clause back and stops.
 *   3. The canvas addresses the reader as 「陳太」. The profile stores a relationship label and
 *      never a name, so the greeting addresses nobody: it names the DOCUMENT — 「你張出院紙我已經
 *      睇咗喇」 — and the sheet's own filed title stays in the header where it belongs.
 *
 * `/read` and `/ask` redirect here.
 */
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AgentLimits from "@/components/AgentLimits";
import DeclineState, { type DeclineVariant } from "@/components/DeclineState";
import { useLocale } from "@/components/LocaleProvider";
import SampleBanner from "@/components/SampleBanner";
import SourceSheet from "@/components/SourceSheet";
import DesktopComposer from "@/components/desktop/DesktopComposer";
import Mascot from "@/components/Mascot";
import { PENDING_IMAGES_KEY } from "@/components/Capture";
import ChatBar from "@/components/chat/ChatBar";
import ChatHeader from "@/components/chat/ChatHeader";
import ChatMessage from "@/components/chat/ChatMessage";
import ReadingProgress from "@/components/chat/ReadingProgress";
import { ThreadWidgetView } from "@/components/chat/Widgets";
import {
  ListeningBubble,
  SpeakingBubble,
  TypingBubble,
} from "@/components/chat/Bubbles";
import { CheckinPrompt } from "@/components/chat/Prompts";
import {
  OPENING_MS,
  type Beat,
  beatSpeech,
  buildBeats,
  checkinTarget,
  fill,
  hasCountableDose,
  pauseAfter,
  pieceSpeech,
  splitCards,
  warningAsk,
  warningSpeech,
} from "@/components/chat/briefing";
import { classifyReply, classifySection, isQuestionLike } from "@/components/chat/turns";
import { useVoice } from "@/components/chat/useVoice";
import { ask } from "@/lib/client/ask-stream";
import { readSheet, type ImageInput } from "@/lib/client/read-stream";
import type { ReadProgressPhase } from "@/lib/domain/read-policy";
import { DEFAULT_SAMPLE, isSampleId, loadSampleReading } from "@/lib/client/sample";
import type { Card, SourceReference, StoredReading } from "@/lib/domain/schemas";
import { downscale } from "@/lib/image/downscale";
import { scriptForDialect, toScript } from "@/lib/i18n/script";
import type { UiLocale } from "@/lib/i18n/ui";
import { memoryBrief, rememberExchange, rememberReading } from "@/lib/memory";
import { cardTitle } from "@/lib/rules/card-order";
import { crisisReferral, detectCrisis } from "@/lib/rules/crisis";
import { remaining } from "@/lib/rules/doses";
import { detectMedicineChange } from "@/lib/rules/refusal";
import { REFUSED_MEDICINE_CHANGE } from "@/lib/rules/template-fallback";
import { detectShareIntent } from "@/lib/share/card";
import {
  appendMessage,
  getSheetCards,
  loadSheets,
  sheetTitle,
  startSheet,
  subscribeSheets,
  takeDose,
  updateActive,
  type Sheet,
  type SheetsState,
  type ThreadMessage,
} from "@/lib/sheets";

/**
 * Copy with no key in `lib/i18n/ui.ts`. Written to the same rules as everything in that file:
 * no 診斷/治療/處方/治癒, no 能吃/唔食得, no "you should", no number about the person.
 */
const LOCAL: Record<"askUnavailable", Record<UiLocale, string>> = {
  // A question that could not reach the answering side. It says what happened and what still
  // works; it does not apologise and it does not guess at an answer.
  askUnavailable: {
    hant: "而家connect唔到，答唔到你。張紙上面嘅嘢仲喺度，可以撳「睇張紙點寫」自己睇。",
    hans: "现在连不上，答不了你。纸上的内容还在，可以按「看纸上怎么写」自己看。",
    en: "I can't reach the answering side right now, so I can't answer that. What the sheet says is still here — open “what the sheet says” to read it.",
  },
};

/** Long edge for the one retry after a 413 (contracts/api-read.md): the pre-5-September default, proven legible. */
const RETRY_LONG_EDGE = 1600;

/** How long into a read 明明 says he is still at it. A single page reads in about 25 s. */
const STILL_READING_MS = 18_000;

/**
 * Drops the turns that were never allowed off this phone, and the questions that provoked them.
 *
 * A refused medicine-change question and anything crisis-related are answered by the rules alone —
 * the model is never called, and `lib/memory/context.ts` states plainly that their text does not
 * reach it. Sending the conversation would have quietly broken that promise a turn later, so the
 * pair goes out together: the refusal, and the question above it that is the sensitive half.
 */
const WITHHELD: ReadonlySet<string> = new Set(["refused_medicine_change", "crisis_referral"]);

function withheldTurnsRemoved(thread: readonly ThreadMessage[]): ThreadMessage[] {
  const drop = new Set<number>();
  thread.forEach((message, index) => {
    if (message.outcome && WITHHELD.has(message.outcome)) {
      drop.add(index);
      if (thread[index - 1]?.role === "user") drop.add(index - 1);
    }
  });
  return thread.filter((_, index) => !drop.has(index));
}

export default function ChatPage() {
  return (
    <Suspense fallback={<Booting />}>
      <ChatScreen />
    </Suspense>
  );
}

function Booting() {
  return <div className="flex-1" aria-hidden="true" />;
}

type Status = "boot" | "reading" | "ready" | "declined";

function ChatScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dialect, script, locale, t } = useLocale();

  const [sheets, setSheets] = useState<SheetsState>(loadSheets);
  const [status, setStatus] = useState<Status>("boot");
  const [variant, setVariant] = useState<DeclineVariant>("notASheet");
  const [pageCount, setPageCount] = useState(0);
  /** Which half of the read the reader is watching, and the page they sent, for the reading card. */
  const [readPhase, setReadPhase] = useState<ReadProgressPhase>("submitting");
  const [firstPage, setFirstPage] = useState<string | null>(null);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [langOpen, setLangOpen] = useState(false);
  const [sourceFor, setSourceFor] = useState<{ source: SourceReference; title: string } | null>(
    null,
  );
  const [asking, setAsking] = useState(false);
  /** Which thing is making noise right now: a thread message id, or one of the driver's own tags. */
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  /** The beat being typed out, so its bubble can carry the right connective and tone. */
  const [beatOnAir, setBeatOnAir] = useState<Beat | null>(null);
  /** 明明 is between two things he is about to say: the three dots. */
  const [thinking, setThinking] = useState(false);
  /** The microphone is open, and what it has heard so far. */
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  /** One transient line after a hold that produced nothing. Cleared the moment anything happens. */
  const [nothingHeard, setNothingHeard] = useState(false);
  /** What 明明 says while the sheet is being read: fixed lines, never a claim about the page. */
  const [readingLine, setReadingLine] = useState<string | null>(null);
  const stillReading = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The warning signs `/api/read` has sent ahead of the reading, in index order, for the reading
   * screen. Each one is said the moment it arrives — the red flags are the first thing on the
   * page and the last thing a 33-second wait should be holding back (constitution II).
   */
  const [earlyWarnings, setEarlyWarnings] = useState<Card[]>([]);
  /**
   * What the reading screen has said so far, line by line, in the dialect it was said in. The
   * warning beat compares this against its own body when the sheet lands: equal means the
   * reader has heard it, and the beat says only its question. Cleared once consumed, so 「再講一次」
   * and a language change replay the whole bubble.
   */
  const earlySaid = useRef<string[]>([]);
  /** Lines waiting to be said on the reading screen, and whether one is being said now. */
  const earlyQueue = useRef<string[]>([]);
  const earlyBusy = useRef(false);
  /** Landing the sheet, held until the warning being said has finished. */
  const afterEarly = useRef<(() => void) | null>(null);
  const beginTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** One clock per mount for the widgets' counters, exactly as 跟進 does it. */
  const [today] = useState(() => new Date());

  const voice = useVoice(dialect, speakerOn);
  const { say, resay, warm, cancel } = voice;

  const threadRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const request = useRef<AbortController | null>(null);
  const readRequest = useRef<AbortController | null>(null);
  const readSequence = useRef(0);
  /** True while 明明 is mid-sentence, so nothing else may start talking over him. */
  const driving = useRef(false);
  /** True from the moment the script starts playing until it ends or the reader cuts in. */
  const playing = useRef(false);
  /**
   * 明明's 「好。」 waiting to be said as the opening of the NEXT bubble rather than as one of its own.
   *
   * An acknowledgement is one word. Giving it a bubble, a speaker button and an AI chip is three
   * rows of furniture for it — exactly the "shooting out a lot of text" this reshape is undoing —
   * and it costs a second round trip to the voice provider before the reader hears anything new.
   * Consumed once, by the first `runBeat` after it is set.
   */
  const pendingAck = useRef<string | null>(null);

  const sheet = sheets.active;
  const reading = sheet?.reading ?? null;

  /* ------------------------------------------------------------------ storage */

  // `loadSheets()` builds a fresh object on every call, so this is a subscription with a lazy
  // initial read rather than `useSyncExternalStore`, which would loop on the changing identity.
  // The first read happens during render, which is also when the first paint is the boot
  // placeholder — so there is nothing for the server and the client to disagree about.
  useEffect(() => subscribeSheets(setSheets), []);

  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const dropTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      request.current?.abort();
      readRequest.current?.abort();
      if (stillReading.current !== null) clearTimeout(stillReading.current);
      stillReading.current = null;
      cancel();
      readSequence.current += 1;
    },
    [cancel],
  );

  /* -------------------------------------------------------------------- cards */

  // The store owns the validated card set. Consumers must not rebuild from the reading and lose
  // source, status, uncertainty, or template metadata carried by the read route.
  const cards = useMemo<Card[]>(() => (sheet ? getSheetCards(sheet) : []), [sheet]);

  /** Converts display text into the reader's script. Verbatim page quotes are never converted. */
  const display = useCallback(
    (text: string) => (script === scriptForDialect(dialect) ? text : toScript(text, script)),
    [dialect, script],
  );

  // Derived live rather than read off `sheet.title`, so flipping the interface language also
  // flips the fallback 出院紙 / 出院纸 / Discharge sheet. Still `sheetTitle()`, still never invented.
  const title = useMemo(() => sheetTitle(reading, locale), [reading, locale]);

  /**
   * The whole briefing, in order, before a word of it has been said. `focus` is the section the
   * reader asked for at the opening, if they took the choice; it moves that run to just after the
   * warning signs and nothing else.
   */
  const focus = sheet?.briefing.focus ?? null;
  const beats = useMemo<Beat[]>(
    () =>
      cards.length > 0
        ? buildBeats(cards, { dialect, t, display, sheetWord: t("cards.header"), focus })
        : [],
    [cards, dialect, display, focus, t],
  );

  // `briefing.step` is deliberately NOT read into a render value: the driver reads it back out of
  // storage at the moment it starts a beat (`play`), so a re-render in the middle of a sentence
  // cannot make the script jump. Only the phase is needed up here, to know when it is over.
  const phase = sheet?.briefing.phase ?? "idle";
  const thread = useMemo(() => sheet?.thread ?? [], [sheet]);

  /* --------------------------------------------------------- the briefing */

  const setBriefing = useCallback((nextPhase: Sheet["briefing"]["phase"], nextStep: number) => {
    // Spread, so the reader's chosen `focus` survives every step of the script.
    updateActive((s) => ({ briefing: { ...s.briefing, phase: nextPhase, step: nextStep } }));
  }, []);

  /** Once the whole sheet has been said, and only when the page printed a countable frequency. */
  const openCheckinIfEarned = useCallback(() => {
    updateActive((s) =>
      s.checkin === "none" && hasCountableDose(s.reading) ? { checkin: "pending" } : {},
    );
  }, []);

  /**
   * The driver, as one recursive step: say beat `index`, commit it, pause, say the next.
   *
   * Held in a ref because it calls itself from inside a timeout, and a `useCallback` cannot name
   * itself. The ref is written in an effect rather than during render — the React Compiler is on
   * for this project and a ref written while rendering is not a safe thing for it to reason about.
   */
  const runRef = useRef<((index: number) => void) | null>(null);

  const runBeat = useCallback(
    (index: number) => {
      const beat = beats[index];
      if (!beat) {
        playing.current = false;
        setThinking(false);
        setBriefing("end", beats.length);
        openCheckinIfEarned();
        return;
      }

      // Swallow a waiting acknowledgement into this bubble, so 「好。」 opens the next thing 明明
      // says instead of standing alone as a message.
      const ack = pendingAck.current;
      pendingAck.current = null;
      /**
       * The amber bubble the reader has already heard. The reading screen said each warning as
       * it streamed in; if what it said is exactly this beat's body, saying it again would be
       * the same thirty seconds the early cards exist to give back. The bubble is still committed
       * in full — the record of what was said is the record — but only its question is spoken.
       * Any difference at all (a line the final pass repaired, a dialect switched mid-read) and
       * the whole bubble is said, so a corrected warning is never left at its uncorrected version.
       */
      const heard =
        beat.key === "warn" &&
        earlySaid.current.length > 0 &&
        earlySaid.current.join("\n") === warningSpeech(splitCards(cards).warnings, { dialect, t, display });
      if (beat.key === "warn") earlySaid.current = [];
      const said = heard ? warningAsk({ t, display }) : beatSpeech(beat);
      const spoken = ack ? `${ack} ${said}` : said;
      const body = ack ? `${ack}\n${beat.text}` : beat.text;

      driving.current = true;
      setThinking(false);
      setNothingHeard(false);
      setBeatOnAir(beat);
      // The step stored while a beat is in flight is the index of THAT beat, not the next one:
      // nothing has been committed yet, so a reader who leaves mid-sentence comes back to it
      // being said again from the top, which is the only honest meaning of "resume where it
      // stopped" for a message that never finished arriving.
      setBriefing("speaking", index);
      setSpeakingId("beat");

      say(spoken, () => {
        appendMessage({
          role: "agent",
          text: body,
          lead: beat.lead,
          origin: beat.origin,
          tone: beat.tone,
          sources: beat.sources,
          link: beat.link,
          outcome: null,
          stopped: beat.stopped,
          unverified: beat.unverified,
          widget: beat.widget ?? null,
        });
        setSpeakingId(null);
        setBeatOnAir(null);
        driving.current = false;

        const next = index + 1;

        /**
         * The end of a section. 明明 has asked, and now he waits — no timer, no next beat.
         *
         * This is the whole difference between a conversation and a monologue with pauses in it.
         * Before this, the script played to the end whatever the reader did, so the only way to be
         * heard was to interrupt; a reader in their seventies does not interrupt, they sit and
         * listen and then have nowhere to put a question. `submit()` is what starts it again.
         */
        if (beat.awaits) {
          playing.current = false;
          setThinking(false);
          setBriefing("waiting", next);
          return;
        }

        if (next >= beats.length) {
          playing.current = false;
          setBriefing("end", beats.length);
          openCheckinIfEarned();
          return;
        }

        setBriefing("ask", next);
        setThinking(true);
        at(pauseAfter(beat), () => {
          // The reader cut in during the pause: the floor is theirs and the script waits.
          if (driving.current || !playing.current) {
            setThinking(false);
            return;
          }
          runRef.current?.(next);
        });
        // Fetch the next few lines' audio while this one is still being said. A clip takes about
        // two seconds, and asking for it when the bubble is already on screen is why the words
        // used to finish typing and then sit in silence.
      }, beats.slice(index + 1, index + 4).map(beatSpeech));
    },
    [at, beats, cards, dialect, display, openCheckinIfEarned, say, setBriefing, t],
  );

  useEffect(() => {
    runRef.current = runBeat;
  }, [runBeat]);

  /** Take the floor back and carry on from `index`. The only way out of `waiting`. */
  const resumeFrom = useCallback((index: number) => {
    playing.current = true;
    driving.current = false;
    runRef.current?.(index);
  }, []);

  /**
   * The first beat of the section the reader was just asked about.
   *
   * `step` while waiting is the index AFTER the question, so the question itself is `step - 1`.
   * Walking back over its own section is what makes "say that again" replay the whole run of
   * medicines rather than the one bubble that happened to come last — which is what a person
   * means when they say they did not follow it.
   */
  const sectionStart = useCallback(
    (step: number) => {
      const askIndex = step - 1;
      const ask = beats[askIndex];
      if (!ask) return Math.max(0, askIndex);
      let i = askIndex;
      while (i > 0 && beats[i - 1].section === ask.section) i -= 1;
      return i;
    },
    [beats],
  );

  /**
   * Starts, or picks up, the script.
   *
   * `opening` is the beat before the first dots appear — the two seconds the reader gets to land
   * on the screen and see who is talking before anything starts moving.
   */
  const play = useCallback(
    (opening = false) => {
      if (playing.current || driving.current) return;
      const current = loadSheets().active;
      if (!current || beats.length === 0) return;
      if (current.briefing.phase === "end") return;

      /**
       * The floor belongs to the reader, and `play` may not take it back.
       *
       * `play` runs from an effect whenever the screen settles — a re-render, a keyboard opening,
       * a return to the tab. Without this line it resumed the script out of `waiting` on its own,
       * so 明明 asked a question and then answered it himself a beat later, which is the exact
       * monologue this whole change exists to end. Worse, it did it while the reader was typing:
       * by the time the reply arrived the phase had already moved to `speaking`, the reply was
       * posted to the model as a question, and 「明白」 came back as 「張紙冇講呢樣」.
       *
       * Only `resumeFrom`, called from the reply handler, moves the conversation on.
       */
      if (current.briefing.phase === "waiting") return;

      playing.current = true;
      const from = Math.min(Math.max(0, current.briefing.step), beats.length);
      setThinking(true);
      at(opening ? OPENING_MS : 350, () => {
        if (!playing.current || driving.current) return;
        runRef.current?.(from);
      });
    },
    [at, beats.length],
  );

  /** The reader has the floor: 明明 stops mid-sentence and the script waits where it is. */
  const takeFloor = useCallback(() => {
    playing.current = false;
    // `driving` is claimed by `runBeat` and released in the callback `say()` runs when the last
    // clause lands. Cancelling the utterance means that callback never runs — so without this
    // line the flag stays raised for the rest of the session and every later `play()` returns at
    // its first guard. The symptom was the conversation dying silently the first time anybody
    // held the bar: the reader's question was answered, and 明明 never said another word.
    driving.current = false;
    dropTimers();
    cancel();
    setSpeakingId(null);
    setBeatOnAir(null);
    setThinking(false);
    setNothingHeard(false);
  }, [cancel, dropTimers]);

  /** The per-message speaker: says one thing again, out loud, without re-typing a word of it. */
  const speakAgain = useCallback(
    (message: ThreadMessage) => {
      setSpeakingId(message.id);
      resay(message.lead ? `${message.lead} ${message.text}` : message.text);
    },
    [resay],
  );

  /* ---------------------------------------------------------- the check-in */

  const target = useMemo(() => (reading ? checkinTarget(reading) : null), [reading]);
  const checkinQuestion = useMemo(() => {
    if (!target) return "";
    return display(
      fill(t("checkin.question"), { name: target.name, printed: target.printed }),
    );
  }, [display, t, target]);

  const lastAgentText = useMemo(() => {
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      if (thread[i].role === "agent") return thread[i].text;
    }
    return "";
  }, [thread]);

  /** The 食咗 / 未食 pair is showing: the question has been asked and not yet answered. */
  const checkinOpen =
    sheet?.checkin === "open" && checkinQuestion.length > 0 && lastAgentText === checkinQuestion;

  /**
   * The check-in question this session has already put to the reader.
   *
   * Without it 明明 would ask again every time something else lands in the thread while `checkin`
   * is still `open` — a nag, from an app that has deliberately given itself no way to nag. It is
   * cleared when the check-in stops being open, so a check-in re-opened later still gets asked.
   */
  const askedCheckin = useRef<string | null>(null);

  const askCheckin = useCallback(() => {
    if (!checkinQuestion || driving.current) return;
    askedCheckin.current = checkinQuestion;
    driving.current = true;
    setSpeakingId("checkin");
    say(checkinQuestion, () => {
      appendMessage({ role: "agent", text: checkinQuestion, origin: "rule" });
      setSpeakingId(null);
      driving.current = false;
    });
  }, [checkinQuestion, say]);

  const onTook = useCallback(() => {
    if (!target) return;
    const today = new Date();
    const after = takeDose(target.key, today);
    appendMessage({ role: "user", text: t("checkin.took"), origin: "user" });
    const left = after ? remaining(target, after.doses[target.key], today) : 0;
    const replyText = display(
      left > 0 ? fill(t("checkin.tookReply"), { n: left }) : t("checkin.tookReplyAll"),
    );
    updateActive(() => ({ checkin: "done" }));
    setSpeakingId("checkin");
    say(replyText, () => {
      appendMessage({ role: "agent", text: replyText, origin: "rule" });
      setSpeakingId(null);
    });
  }, [display, say, t, target]);

  /** 未食 quotes the page back and says nothing else. No nudge, no promise of a second ask. */
  const onNotYet = useCallback(() => {
    if (!target) return;
    appendMessage({ role: "user", text: t("checkin.notYet"), origin: "user" });
    const replyText = display(fill(t("checkin.notYetReply"), { printed: target.printed }));
    updateActive(() => ({ checkin: "done" }));
    setSpeakingId("checkin");
    say(replyText, () => {
      appendMessage({ role: "agent", text: replyText, origin: "rule" });
      setSpeakingId(null);
    });
  }, [display, say, t, target]);

  /* ------------------------------------------------------------ questions */

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || asking || !reading) return;

      // The reader interrupting has the floor: whatever 明明 was saying stops, and the script must
      // not start the next beat on top of the answer while the request is in flight. `driving` is
      // claimed here and released on every way out; the script picks itself up afterwards.
      takeFloor();
      driving.current = true;
      appendMessage({ role: "user", text, origin: "user" });

      // Gate 1: crisis. The referral replaces the answer, nothing is sent, and nothing about a
      // crisis question is written to the memory brief (FR-014).
      if (detectCrisis(text).crisis) {
        const referral = crisisReferral(dialect);
        appendMessage({
          role: "agent",
          text: referral.text,
          origin: "rule",
          outcome: "crisis_referral",
        });
        driving.current = false;
        return;
      }

      // Gate 2: "should I change this medicine". A fixed template, nothing sent (FR-011).
      if (detectMedicineChange(text).refuse) {
        const refusalText = display(REFUSED_MEDICINE_CHANGE[dialect]);
        appendMessage({
          role: "agent",
          text: refusalText,
          origin: "rule",
          outcome: "refused_medicine_change",
        });
        rememberExchange({ question: text, outcome: "refused_medicine_change" });
        driving.current = false;
        return;
      }

      /**
       * Gate 3: 「發畀我個女」 — the reader wants the card, not an answer.
       *
       * A rule (`detectShareIntent`), so it costs no round trip and cannot come back as 「張紙冇講
       * 呢樣」. The reply is fixed copy and the card under it is drawn from the sheet on this phone.
       */
      if (detectShareIntent(text)) {
        const line = display(t("share.cardLine"));
        setSpeakingId("share");
        say(line, () => {
          appendMessage({ role: "agent", text: line, origin: "rule", widget: "share" });
          setSpeakingId(null);
          driving.current = false;
        });
        return;
      }

      /**
       * Gate 4: 明明 asked a question and this is the answer to it.
       *
       * "Yeah" is the commonest thing anyone says to this app. Posting it to a model to be told it
       * means yes would put a network round trip, a cost and a failure mode in the middle of every
       * turn — so the script answers its own question. Anything `classifyReply` cannot place falls
       * through to the model below, which is the same path a question has always taken.
       *
       * It runs AFTER the crisis and medicine-change gates on purpose: those two must win over
       * everything, including a reply that looks like a cheerful yes.
       */
      /*
       * Read the briefing back out of storage rather than off the captured `sheet`.
       *
       * `submit` is handed to the bar, and the bar keeps its handlers in refs so a press that
       * began before a re-render still completes — which is correct for the gesture and fatal
       * here: the closure can be one render behind, and one render behind is exactly the render
       * where the phase was not yet `waiting`. The symptom was 「明白」 being posted to the model,
       * answered with 「張紙冇講呢樣」, and the script resuming anyway — the reader saw 明明 fail to
       * understand the single commonest word in the conversation.
       */
      const live = loadSheets().active;
      if (live?.briefing.phase === "waiting") {
        const step = live.briefing.step;

        /**
         * The opening offered a choice of where to start, and the reader took it.
         *
         * 「藥」 at that one moment is not a question for the model, it is the answer to 明明's —
         * so the run they named moves to just after the warning signs (which nothing moves:
         * constitution II) and the script goes on from there. Only at the opening (`step` 1 is
         * the beat after the summary), and only for a reply that is not shaped like a question:
         * once the sheet is being read out, a section name in a reply is a question like any
         * other. The beats are rebuilt from the stored `focus`; the warning beat is at index 1 in
         * both orders, so resuming there is the same beat either way.
         */
        if (step === 1) {
          const wanted = classifySection(text);
          if (wanted !== null && !isQuestionLike(text)) {
            updateActive((s) => ({ briefing: { ...s.briefing, focus: wanted } }));
            pendingAck.current = display(t("brief.ackFocus"));
            resumeFrom(step);
            return;
          }
        }

        const intent = classifyReply(text);

        if (intent === "continue") {
          pendingAck.current = display(t("brief.ackContinue"));
          resumeFrom(step);
          return;
        }
        if (intent === "repeat") {
          pendingAck.current = display(t("brief.ackRepeat"));
          resumeFrom(sectionStart(step));
          return;
        }
        // "question" carries on into the model path below, and the phase stays `waiting` — so
        // once it is answered, the next "yes" still picks the script up where it left off.
      }

      setAsking(true);
      setThinking(true);
      const controller = new AbortController();
      request.current = controller;

      /**
       * The conversation travels with the question.
       *
       * Without it a follow-up is unanswerable: 「有冇其他藥？」 has no referent on its own, and
       * came back as "the sheet doesn't say" on a sheet listing three medicines — the reader had
       * just been told about one and the app had already forgotten. It used to be the last six
       * turns, which meant 明明 forgot the start of the briefing by the third question; now it is
       * the whole thread about this sheet, up to the forty turns `/api/ask` accepts. The reader's
       * own words and 明明's own replies, both already on this device.
       */
      const context = withheldTurnsRemoved(loadSheets().active?.thread ?? [])
        .slice(-40)
        .map((message) => ({
          role: message.role === "user" ? ("user" as const) : ("agent" as const),
          text: message.text.slice(0, 600),
        }));

      /**
       * The reader's own sentence arrives before the rest of the answer — the server sends it
       * the moment it has closed its quote, already through every gate — and it is said at once.
       * Its bubble is committed when it has finished being said; the citations, which land a few
       * seconds later with the full answer, are attached to that bubble when they arrive. So the
       * answer is heard about as soon as the model has written it, not after it has written the
       * same thing twice more in the other two languages.
       */
      const early: {
        text: string | null;
        outcome: NonNullable<ThreadMessage["outcome"]> | null;
        committed: boolean;
      } = {
        text: null,
        outcome: null,
        committed: false,
      };
      /** What the full answer added, when it landed before the sentence had finished being said. */
      let settled: Pick<ThreadMessage, "sources" | "outcome" | "unverified"> | null = null;

      const result = await ask(
        {
          reading,
          question: { text, inputLanguage: dialect },
          dialect,
          memory: memoryBrief(),
          ...(context.length > 0 ? { context } : {}),
        },
        {
          signal: controller.signal,
          onEarly: ({ text: sentence, outcome }) => {
            const shown = display(sentence);
            early.text = shown;
            early.outcome = outcome;
            setThinking(false);
            setSpeakingId("answer");
            say(shown, () => {
              appendMessage({
                role: "agent",
                text: shown,
                origin: "model",
                ...(settled ?? { sources: [], outcome }),
              });
              early.committed = true;
              setSpeakingId(null);
              driving.current = false;
            });
          },
        },
      );
      request.current = null;
      setAsking(false);
      setThinking(false);

      if (early.text !== null) {
        const earlyText = early.text;
        const settledOutcome =
          result.outcome === "bad_request" || result.outcome === "model_unavailable"
            ? early.outcome
            : (result.outcome as ThreadMessage["outcome"]);
        const citedCards = (result.citedCardIds ?? [])
          .map((id) => cards.find((c) => c.id === id) ?? null)
          .filter((card): card is Card => card !== null);
        const sources = (result.sources?.length
          ? result.sources
          : citedCards.map((card) => card.source)
        ).filter((source): source is SourceReference => !!source);
        const unverified = citedCards[0]?.unverified === true;
        settled = { sources, outcome: settledOutcome, unverified };
        // The bubble may already be in the thread (said before the rest arrived) or still being
        // said; either way the citations are attached to the sentence they belong to.
        if (early.committed) {
          updateActive((s) => ({
            thread: s.thread.map((message, i) =>
              i === s.thread.length - 1 && message.role === "agent" && message.text === earlyText
                ? { ...message, sources, outcome: settledOutcome, unverified }
                : message,
            ),
          }));
        }
        rememberExchange({
          question: text,
          outcome: settledOutcome ?? "not_on_sheet",
          citedCardId: result.citedCardIds?.[0] ?? null,
        });
        return;
      }

      const failed = result.outcome === "bad_request" || result.outcome === "model_unavailable";
      const answerText = failed
        ? LOCAL.askUnavailable[locale]
        : display(result.answer?.[dialect] ?? "");
      if (answerText.length === 0) {
        driving.current = false;
        return;
      }

      // Every card the answer stands on. A question about all three medicines cites all three.
      const citedCards = (result.citedCardIds ?? [])
        .map((id) => cards.find((c) => c.id === id) ?? null)
        .filter((card): card is Card => card !== null);
      const citedCard = citedCards[0] ?? null;

      setSpeakingId("answer");
      say(answerText, () => {
        appendMessage({
          role: "agent",
          text: answerText,
          origin: failed ? "rule" : "model",
          // Every printed line behind the answer — the server's list first, falling back to the
          // cited cards' own sources when the stream carried none.
          sources: (result.sources?.length
            ? result.sources
            : citedCards.map((card) => card.source)
          ).filter((source): source is SourceReference => !!source),
          outcome: failed ? null : (result.outcome as ThreadMessage["outcome"]),
          unverified: citedCard?.unverified === true,
        });
        setSpeakingId(null);
        driving.current = false;
      });

      if (!failed) {
        rememberExchange({
          question: text,
          outcome: result.outcome,
          citedCardId: result.citedCardIds?.[0] ?? null,
        });
      }
    },
    [asking, cards, dialect, display, locale, reading, resumeFrom, say, sectionStart, t, takeFloor],
  );

  /* ------------------------------------------------------- getting a sheet */

  const seedSample = useCallback(
    async (id: typeof DEFAULT_SAMPLE) => {
      const { reading: sampleReading, cards: sampleCards } = await loadSampleReading(id);
      // Deliberately NOT `saveReading()`. The top-level `reading` field is the pre-v2 shape, and
      // `lib/sheets/store.ts` reads it only to migrate an old phone forward. Writing it here made
      // `loadSheets()` materialise a phantom "migrated" sheet out of it a millisecond before
      // `startSheet` ran — which `startSheet` then dutifully archived, so one photograph left two
      // sheets and 記錄 said 「以前嘅 (1)」 on a phone that had read exactly one page.
      startSheet(sampleReading, 1, sampleCards);
      rememberReading(sampleReading, dialect);
      setSheets(loadSheets());
      setStatus("ready");
    },
    [dialect],
  );

  const land = useCallback(
    (next: StoredReading, pages: number, nextCards?: Card[]) => {
      if (stillReading.current !== null) clearTimeout(stillReading.current);
      const now = () => {
        // See `seedSample`: writing the legacy `reading` field here forged a sheet to archive.
        startSheet(next, pages, nextCards);
        rememberReading(next, dialect);
        setSheets(loadSheets());
        setEarlyWarnings([]);
        setStatus("ready");
      };
      // A warning still being said on the reading screen finishes first: cutting a red flag off
      // mid-sentence to start the greeting is the wrong order twice over.
      if (earlyBusy.current) afterEarly.current = now;
      else now();
    },
    [dialect],
  );

  /** Forgets everything the reading screen said or was about to say. */
  const dropEarly = useCallback(() => {
    earlyQueue.current = [];
    earlyBusy.current = false;
    earlySaid.current = [];
    afterEarly.current = null;
    setEarlyWarnings([]);
  }, []);

  /**
   * Says the reading screen's lines one after another. `say` cancels whatever is in the air, so
   * a second warning arriving mid-sentence has to wait its turn rather than take it.
   */
  const sayEarly = useCallback(
    (line: string) => {
      earlyQueue.current.push(line);
      if (earlyBusy.current) return;
      const drain = () => {
        const next = earlyQueue.current.shift();
        if (next === undefined) {
          earlyBusy.current = false;
          const landed = afterEarly.current;
          afterEarly.current = null;
          landed?.();
          return;
        }
        earlyBusy.current = true;
        say(next, drain);
      };
      drain();
    },
    [say],
  );

  const decline = useCallback(
    (next: DeclineVariant) => {
      if (stillReading.current !== null) clearTimeout(stillReading.current);
      cancel();
      dropEarly();
      setVariant(next);
      setStatus("declined");
    },
    [cancel, dropEarly],
  );

  const cancelRead = useCallback(() => {
    readSequence.current += 1;
    readRequest.current?.abort();
    readRequest.current = null;
    if (stillReading.current !== null) clearTimeout(stillReading.current);
    stillReading.current = null;
    cancel();
    dropEarly();
    setStatus("boot");
    router.push("/");
  }, [cancel, dropEarly, router]);

  const begin = useCallback(async () => {
    const requested = searchParams.get("sample");
    if (isSampleId(requested)) {
      await seedSample(requested);
      // Drop the parameter so a reload does not archive this sheet and start another one.
      router.replace("/chat");
      return;
    }

    const images = takePendingImages();
    if (images) {
      const sequence = ++readSequence.current;
      const readController = new AbortController();
      readRequest.current = readController;
      setPageCount(images.length);
      setFirstPage(`data:${images[0].mediaType};base64,${images[0].base64}`);
      setReadPhase("submitting");
      dropEarly();
      setStatus("reading");
      // The read takes twenty seconds or more, and a phone that goes silent for that long looks
      // broken. 明明 says he is reading — a fixed line, spoken and shown — and once more a while
      // later if the page is still not back. Neither line says anything about the sheet.
      const opening = t("reading.opening");
      setReadingLine(opening);
      say(opening);
      stillReading.current = setTimeout(() => {
        if (readController.signal.aborted || sequence !== readSequence.current) return;
        // A warning already on screen is worth more than a line saying he is still at it.
        if (earlySaid.current.length > 0) return;
        const still = t("reading.still");
        setReadingLine(still);
        say(still);
      }, STILL_READING_MS);
      // Status events describe progress; cards are committed only with a complete validated
      // reading. The exception is a warning sign sent ahead of it: shown and said at once, replaced
      // in place if the final copy differs, withdrawn if the reading it came from was unusable.
      const readHandlers = {
        signal: readController.signal,
        onStatus: (phase: string) => {
          if (readController.signal.aborted || sequence !== readSequence.current) return;
          if (phase === "reading" || phase === "checking") setReadPhase(phase);
        },
        onCard: (card: Card, arrival: { early: boolean }) => {
          if (readController.signal.aborted || sequence !== readSequence.current) return;
          if (card.type !== "warning") return;
          setEarlyWarnings((prev) =>
            prev.some((c) => c.id === card.id)
              ? prev.map((c) => (c.id === card.id ? card : c))
              : [...prev, card],
          );
          if (!arrival.early) {
            // The final pass changed a line that was already said. What was heard is no longer
            // the bubble, so the bubble will be said in full when the sheet lands.
            earlySaid.current = [];
            return;
          }
          const line = display(pieceSpeech(card, dialect));
          if (earlySaid.current.length === 0) {
            const lead = display(t("brief.warnLead"));
            earlySaid.current.push(lead, line);
            setReadingLine(null);
            sayEarly(`${lead}\n${line}`);
          } else {
            earlySaid.current.push(line);
            sayEarly(line);
          }
        },
        onRetract: () => {
          if (readController.signal.aborted || sequence !== readSequence.current) return;
          // The reading those warnings came from was unusable; the retry starts from nothing.
          cancel();
          dropEarly();
        },
      };
      let outcome = await readSheet(images, readHandlers);
      if (readController.signal.aborted || sequence !== readSequence.current) return;

      // contracts/api-read.md: on 413 the client re-downscales and retries ONCE. The pages are
      // shrunk further in memory and never stored; a second 413 falls to the honest decline.
      if (outcome.kind === "too_large") {
        const smaller = await shrinkImages(images, RETRY_LONG_EDGE, readController.signal);
        if (smaller) outcome = await readSheet(smaller, readHandlers);
      }

      if (readController.signal.aborted || sequence !== readSequence.current) return;

      switch (outcome.kind) {
        case "reading":
          land(outcome.reading, images.length, outcome.cards);
          return;
        case "unknown":
          decline("notASheet");
          return;
        case "invalid_reading":
        case "bad_request":
        case "too_large":
          decline("invalidReading");
          return;
        case "model_unavailable":
          decline("modelUnavailable");
          return;
        case "cancelled":
          decline("modelUnavailable");
          return;
        case "timed_out":
          decline("modelUnavailable");
          return;
      }
    }

    // Nothing new to read: talk about the sheet already on the phone. `loadSheets` migrates a
    // pre-v2 stored reading into a sheet on the way past, so an upgraded phone still lands here.
    if (loadSheets().active) {
      setStatus("ready");
      return;
    }
    router.replace("/");
  }, [cancel, decline, dialect, display, dropEarly, land, router, say, sayEarly, searchParams, seedSample, t]);

  useEffect(() => {
    beginTimer.current = setTimeout(() => {
      beginTimer.current = null;
      if (started.current) return;
      started.current = true;
      void begin();
    }, 0);
    return () => {
      if (beginTimer.current !== null) clearTimeout(beginTimer.current);
      beginTimer.current = null;
    };
  }, [begin]);

  /* ------------------------------------------------- the automatic driver */

  // Arriving from the 記錄 notification opens the check-in. Agent D may also set `checkin` to
  // "open" before navigating; both routes land in the same place.
  useEffect(() => {
    if (searchParams.get("checkin") === null) return;
    updateActive((s) => (s.checkin === "pending" ? { checkin: "open" } : {}));
  }, [searchParams]);

  /**
   * The one kick-off. It fires when a sheet becomes ready and never again for that sheet: from
   * there the script drives itself, and `play()` is called by hand after an interruption.
   */
  const sheetId = sheet?.id ?? null;
  const kicked = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "ready" || sheetId === null || beats.length === 0) return;
    if (kicked.current === sheetId) return;
    kicked.current = sheetId;
    // The opening bubble has nothing in front of it to have warmed it, so warm it here.
    warm(beats.slice(0, 3).map(beatSpeech));
    play(true);
  }, [beats, play, sheetId, status, warm]);

  /**
   * Changing the spoken language starts the sheet again, in the language just chosen.
   *
   * A committed message is a record of what was actually said, and rewriting one in another
   * language would be forging it — but leaving the reader with a thread they cannot read is
   * worse, and somebody who reaches for the language chip has just told you they did not
   * understand a word of it. So the thread is cleared and 明明 says the sheet again from the top.
   * Only an in-session change does this: the ref starts empty, so the first render never resets
   * anything, and a reload leaves what was said alone.
   */
  const restart = useCallback(() => {
    takeFloor();
    askedCheckin.current = null;
    updateActive(() => ({ thread: [], briefing: { phase: "idle", step: 0 } }));
    setSheets(loadSheets());
    play(true);
  }, [play, takeFloor]);

  const spokenIn = useRef<typeof dialect | null>(null);
  useEffect(() => {
    if (status !== "ready" || sheetId === null) return;
    const previous = spokenIn.current;
    spokenIn.current = dialect;
    if (previous === null || previous === dialect) return;
    restart();
  }, [dialect, restart, sheetId, status]);

  /**
   * Picking the script back up after the reader has had their turn. It waits for the answer to
   * finish speaking (`asking` false, nothing driving) and for the thread to have settled.
   */
  useEffect(() => {
    if (status !== "ready" || phase === "end" || asking || listening) return;
    if (playing.current || driving.current) return;
    const queued = setTimeout(() => {
      if (playing.current || driving.current) return;
      play();
    }, 900);
    return () => clearTimeout(queued);
  }, [asking, listening, phase, play, status, thread.length]);

  /** Once the briefing is over, the check-in question is asked at most once per opening. */
  const checkinState = sheet?.checkin ?? "none";
  useEffect(() => {
    if (status !== "ready" || phase !== "end") return;
    if (checkinState !== "open") {
      askedCheckin.current = null;
      return;
    }
    if (driving.current || checkinQuestion.length === 0) return;
    if (lastAgentText === checkinQuestion || askedCheckin.current === checkinQuestion) return;
    const queued = setTimeout(askCheckin, 500);
    return () => clearTimeout(queued);
  }, [askCheckin, checkinQuestion, checkinState, lastAgentText, phase, status]);

  /* ----------------------------------------------------------------- view */

  // Follow the conversation down as it grows, while a clause is being revealed, and while the
  // microphone is filling in the reader's own bubble.
  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [thread.length, voice.typing, thinking, listening, interim, checkinOpen]);

  const openSource = useCallback(
    (source: SourceReference, card: Card | null) => {
      setSourceFor({
        source,
        title: card ? cardTitle(card.type, script) : t("cards.header"),
      });
    },
    [script, t],
  );

  /**
   * Which card a stored message's source came from.
   *
   * `ThreadMessage` carries the `SourceReference` itself, not a card id, so the card is found back
   * by its quote and section. That is deliberate: it is a pure function of the reading, so it
   * still resolves after a reload, when nothing in memory remembers which card said what.
   */
  const cardForSource = useCallback(
    (source: SourceReference) =>
      cards.find(
        (c) =>
          c.source !== null &&
          c.source.quote === source.quote &&
          c.source.section === source.section,
      ) ?? null,
    [cards],
  );

  /** The heading announced with the source sheet, so the reader knows which line they opened. */
  const sourceTitleFor = useCallback(
    (message: ThreadMessage): string => {
      const first = message.sources?.[0];
      if (!first) return "";
      const card = cardForSource(first);
      return card ? cardTitle(card.type, script) : t("cards.header");
    },
    [cardForSource, script, t],
  );

  /**
   * A slot ticked in the checklist widget. `new Date()` rather than the mounted `today`: the write
   * must land on the calendar day the tap actually happened on. The store re-renders the thread
   * from the persisted value, so the widget shows the rules' own count, not an optimistic one.
   */
  const onTakeFromWidget = useCallback((key: string) => {
    takeDose(key, new Date());
  }, []);

  const onListeningChange = useCallback(
    (open: boolean) => {
      setListening(open);
      // Holding the bar is how the reader takes the floor. Nothing else stops 明明 mid-sentence,
      // and nothing should have to: the gesture that starts a question is the gesture that
      // interrupts the answer to the last one.
      if (open) takeFloor();
    },
    [takeFloor],
  );

  if (status === "reading") {
    return (
      <main className="mx-auto flex h-[calc(100dvh-var(--disclaimer-height))] w-full max-w-md flex-col lg:h-full lg:max-w-none">
        <ReadingProgress
          pageCount={pageCount}
          line={readingLine}
          phase={readPhase}
          pageImage={firstPage}
          warnings={earlyWarnings.map((card) => display(pieceSpeech(card, dialect)))}
          onCancel={cancelRead}
        />
      </main>
    );
  }

  if (status === "declined") {
    return (
      <main className="mx-auto flex h-[calc(100dvh-var(--disclaimer-height))] w-full max-w-md flex-col overflow-y-auto px-5 pt-6 pb-6 lg:h-full lg:max-w-lg lg:justify-center">
        <DeclineState
          variant={variant}
          onRetake={() => router.push("/")}
          onSample={() => void seedSample(DEFAULT_SAMPLE)}
        />
        <AgentLimits className="mt-3" />
      </main>
    );
  }

  if (status === "boot" || !sheet) return <Booting />;

  return (
    <main className="mx-auto flex h-[calc(100dvh-var(--disclaimer-height))] w-full max-w-md flex-col overflow-hidden lg:h-full lg:max-w-none">
      <ChatHeader
        title={title}
        capturedAt={sheet.capturedAt}
        speakerOn={speakerOn}
        onToggleSpeaker={() => setSpeakerOn((on) => !on)}
        onBack={() => router.push("/")}
        onRestart={restart}
        langOpen={langOpen}
        onOpenLang={() => setLangOpen(true)}
        onCloseLang={() => setLangOpen(false)}
        mascotState={listening ? "listening" : speakingId && voice.speaking ? "speaking" : "idle"}
      />

      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-2 lg:px-6 lg:pt-6">
        <div className="desktop-chat-col">
        {thread.length === 0 && voice.typing === null && !thinking ? (
          <div className="mb-8 hidden flex-col items-center pt-10 pb-4 text-center lg:flex">
            <span className="companion-plate grid h-[132px] w-[132px] place-items-center rounded-full">
              <Mascot size={92} state="greeting" />
            </span>
            <p className="mt-5 text-[22px] font-bold text-ink">{t("mascot.name")}</p>
            <p className="mt-2 max-w-md text-[16px] leading-relaxed text-muted">{title}</p>
          </div>
        ) : null}

        <p className="mb-3 text-center text-[11px] font-medium tracking-[1.3px] text-muted uppercase">
          {t("chat.today")}
        </p>

        {reading?.sample === true ? (
          <div className="mb-3 flex justify-center">
            <SampleBanner />
          </div>
        ) : null}

        {/*
          FR-022: what the agent will and will not do, on the screen with the microphone, never
          behind a disclosure. It sits at the TOP of the thread rather than the bottom — the thread
          scrolls itself to the newest message, so a block pinned after the last message was on
          screen for the whole conversation and took a third of it. Here it is read once, before
          anything has been said, and then scrolls away like everything else.
        */}
        <AgentLimits className="mb-4" />

        {thread.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            reading={speakingId === message.id && voice.speaking}
            sourceTitle={sourceTitleFor(message)}
            dialect={dialect}
            onOpenSource={(m) => {
              const first = m.sources?.[0];
              if (first) openSource(first, cardForSource(first));
            }}
            onOpenTrack={() => router.push("/track")}
            onSpeak={speakAgain}
            widget={
              message.widget ? (
                <ThreadWidgetView
                  widget={message.widget}
                  ctx={{ sheet, today, display, onTake: onTakeFromWidget }}
                />
              ) : null
            }
          />
        ))}

        {voice.typing !== null ? (
          <SpeakingBubble
            lead={beatOnAir?.lead ?? null}
            text={voice.typing}
            warn={beatOnAir?.tone === "warn"}
            speaking={voice.speaking}
          />
        ) : null}

        {thinking && voice.typing === null ? <TypingBubble /> : null}

        {listening ? <ListeningBubble text={interim} /> : null}

        {nothingHeard && !listening ? (
          <p role="status" className="mb-2.5 px-1 text-fine text-muted">
            {t("chat.nothingHeard")}
          </p>
        ) : null}

        {checkinOpen ? <CheckinPrompt onTook={onTook} onNotYet={onNotYet} /> : null}

        {voice.voiceUnavailable ? (
          <p className="mb-2.5 px-1 text-fine text-muted">{t("fallback.noVoiceNote")}</p>
        ) : null}
        </div>
      </div>

      <DesktopComposer
        language={dialect}
        locale={locale}
        busy={asking}
        onSend={(text) => void submit(text)}
        onListening={onListeningChange}
        onInterim={setInterim}
        onNothingHeard={() => setNothingHeard(true)}
      />
      <div className="lg:hidden">
        <ChatBar
          language={dialect}
          locale={locale}
          busy={asking}
          onSend={(text) => void submit(text)}
          onListening={onListeningChange}
          onInterim={setInterim}
          onNothingHeard={() => setNothingHeard(true)}
        />
      </div>

      {sourceFor ? (
        <SourceSheet
          source={sourceFor.source}
          cardTitle={sourceFor.title}
          onClose={() => setSourceFor(null)}
        />
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Re-encodes already-downscaled pages at a smaller long edge, in memory only. Returns null when
 * the browser cannot decode them, in which case the caller shows the honest decline instead.
 */
async function shrinkImages(
  images: ImageInput[],
  maxLongEdge: number,
  signal?: AbortSignal,
): Promise<ImageInput[] | null> {
  try {
    const smaller: ImageInput[] = [];
    for (const image of images) {
      if (signal?.aborted) return null;
      const blob = await (await fetch(`data:${image.mediaType};base64,${image.base64}`)).blob();
      const { mediaType, base64 } = await downscale(blob, maxLongEdge);
      if (signal?.aborted) return null;
      smaller.push({ mediaType, base64 });
    }
    return smaller;
  } catch {
    return null;
  }
}

/**
 * Reads the pages `components/Capture.tsx` left behind and deletes them in the same breath.
 *
 * `sessionStorage["fitornot.pending-images"]` exists only to carry the downscaled pages across one
 * client navigation, because a route change cannot take a File in its URL. It is read once and
 * removed in a `finally` before the request even resolves, so the bytes live in this tab for a few
 * milliseconds and nowhere else (FR-018, constitution V).
 */
function takePendingImages(): ImageInput[] | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_IMAGES_KEY);
    if (raw === null) return null;
  } catch {
    return null;
  } finally {
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
