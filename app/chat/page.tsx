"use client";

/**
 * 傾偈 — the whole product, as one conversation with 明仔 (v2 build brief §6).
 *
 * The sheet does not arrive as a stack of cards. It arrives as messages: 明仔 types himself out
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
import { PENDING_IMAGES_KEY } from "@/components/Capture";
import ChatBar from "@/components/chat/ChatBar";
import ChatHeader from "@/components/chat/ChatHeader";
import ChatMessage from "@/components/chat/ChatMessage";
import ReadingProgress from "@/components/chat/ReadingProgress";
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
} from "@/components/chat/briefing";
import { useVoice } from "@/components/chat/useVoice";
import { ask } from "@/lib/client/ask-stream";
import { readSheet, type ImageInput } from "@/lib/client/read-stream";
import { DEFAULT_SAMPLE, filterCards, isSampleId, loadSampleReading } from "@/lib/client/sample";
import type { Card, SourceReference, StoredReading } from "@/lib/domain/schemas";
import { downscale } from "@/lib/image/downscale";
import { scriptForDialect, toScript } from "@/lib/i18n/script";
import type { UiLocale } from "@/lib/i18n/ui";
import { memoryBrief, rememberExchange, rememberReading } from "@/lib/memory";
import { buildCards, cardTitle } from "@/lib/rules/card-order";
import { crisisReferral, detectCrisis } from "@/lib/rules/crisis";
import { remaining } from "@/lib/rules/doses";
import { detectMedicineChange } from "@/lib/rules/refusal";
import { REFUSED_MEDICINE_CHANGE } from "@/lib/rules/template-fallback";
import {
  appendMessage,
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

/** Long edge for the one retry after a 413 (contracts/api-read.md). 1200 px keeps 9 pt print legible. */
const RETRY_LONG_EDGE = 1200;

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
  /** 明仔 is between two things he is about to say: the three dots. */
  const [thinking, setThinking] = useState(false);
  /** The microphone is open, and what it has heard so far. */
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  /** One transient line after a hold that produced nothing. Cleared the moment anything happens. */
  const [nothingHeard, setNothingHeard] = useState(false);

  const voice = useVoice(dialect, speakerOn);
  const { say, resay, cancel } = voice;

  const threadRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const request = useRef<AbortController | null>(null);
  /** True while 明仔 is mid-sentence, so nothing else may start talking over him. */
  const driving = useRef(false);
  /** True from the moment the script starts playing until it ends or the reader cuts in. */
  const playing = useRef(false);

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
    },
    [],
  );

  /* -------------------------------------------------------------------- cards */

  // The order guarantee. Rebuilt from the reading rather than stored, so a card can never drift
  // out of `CARD_ORDER`, and re-filtered because a rebuilt body has not been through the route's
  // banned-term pass (`lib/client/sample.ts`).
  const cards = useMemo<Card[]>(
    () => (reading ? filterCards(buildCards(reading)) : []),
    [reading],
  );

  /** Converts display text into the reader's script. Verbatim page quotes are never converted. */
  const display = useCallback(
    (text: string) => (script === scriptForDialect(dialect) ? text : toScript(text, script)),
    [dialect, script],
  );

  // Derived live rather than read off `sheet.title`, so flipping the interface language also
  // flips the fallback 出院紙 / 出院纸 / Discharge sheet. Still `sheetTitle()`, still never invented.
  const title = useMemo(() => sheetTitle(reading, locale), [reading, locale]);

  /** The whole briefing, in order, before a word of it has been said. */
  const beats = useMemo<Beat[]>(
    () =>
      cards.length > 0
        ? buildBeats(cards, { dialect, t, display, sheetWord: t("cards.header") })
        : [],
    [cards, dialect, display, t],
  );

  // `briefing.step` is deliberately NOT read into a render value: the driver reads it back out of
  // storage at the moment it starts a beat (`play`), so a re-render in the middle of a sentence
  // cannot make the script jump. Only the phase is needed up here, to know when it is over.
  const phase = sheet?.briefing.phase ?? "idle";
  const thread = useMemo(() => sheet?.thread ?? [], [sheet]);

  /* --------------------------------------------------------- the briefing */

  const setBriefing = useCallback((nextPhase: Sheet["briefing"]["phase"], nextStep: number) => {
    updateActive(() => ({ briefing: { phase: nextPhase, step: nextStep } }));
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

      say(beatSpeech(beat), () => {
        appendMessage({
          role: "agent",
          text: beat.text,
          lead: beat.lead,
          origin: beat.origin,
          tone: beat.tone,
          source: beat.source,
          link: beat.link,
          outcome: null,
          stopped: beat.stopped,
          unverified: beat.unverified,
        });
        setSpeakingId(null);
        setBeatOnAir(null);
        driving.current = false;

        const next = index + 1;
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
      });
    },
    [at, beats, openCheckinIfEarned, say, setBriefing],
  );

  useEffect(() => {
    runRef.current = runBeat;
  }, [runBeat]);

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

  /** The reader has the floor: 明仔 stops mid-sentence and the script waits where it is. */
  const takeFloor = useCallback(() => {
    playing.current = false;
    // `driving` is claimed by `runBeat` and released in the callback `say()` runs when the last
    // clause lands. Cancelling the utterance means that callback never runs — so without this
    // line the flag stays raised for the rest of the session and every later `play()` returns at
    // its first guard. The symptom was the conversation dying silently the first time anybody
    // held the bar: the reader's question was answered, and 明仔 never said another word.
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
   * Without it 明仔 would ask again every time something else lands in the thread while `checkin`
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

      // The reader interrupting has the floor: whatever 明仔 was saying stops, and the script must
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

      setAsking(true);
      setThinking(true);
      const controller = new AbortController();
      request.current = controller;

      const result = await ask(
        { reading, question: { text, inputLanguage: dialect }, dialect, memory: memoryBrief() },
        { signal: controller.signal },
      );
      request.current = null;
      setAsking(false);
      setThinking(false);

      const failed = result.outcome === "bad_request" || result.outcome === "model_unavailable";
      const answerText = failed
        ? LOCAL.askUnavailable[locale]
        : display(result.answer?.[dialect] ?? "");
      if (answerText.length === 0) {
        driving.current = false;
        return;
      }

      const citedCard = result.citedCardId
        ? (cards.find((c) => c.id === result.citedCardId) ?? null)
        : null;

      setSpeakingId("answer");
      say(answerText, () => {
        appendMessage({
          role: "agent",
          text: answerText,
          origin: failed ? "rule" : "model",
          source: result.source ?? citedCard?.source ?? null,
          outcome: failed ? null : (result.outcome as ThreadMessage["outcome"]),
          unverified: citedCard?.unverified === true,
        });
        setSpeakingId(null);
        driving.current = false;
      });

      if (!failed) {
        rememberExchange({
          question: text,
          outcome: result.outcome as "answered" | "not_on_sheet" | "refused_medicine_change",
          citedCardId: result.citedCardId ?? null,
        });
      }
    },
    [asking, cards, dialect, display, locale, reading, say, takeFloor],
  );

  /* ------------------------------------------------------- getting a sheet */

  const seedSample = useCallback(
    async (id: typeof DEFAULT_SAMPLE) => {
      const { reading: sampleReading } = await loadSampleReading(id);
      // Deliberately NOT `saveReading()`. The top-level `reading` field is the pre-v2 shape, and
      // `lib/sheets/store.ts` reads it only to migrate an old phone forward. Writing it here made
      // `loadSheets()` materialise a phantom "migrated" sheet out of it a millisecond before
      // `startSheet` ran — which `startSheet` then dutifully archived, so one photograph left two
      // sheets and 記錄 said 「以前嘅 (1)」 on a phone that had read exactly one page.
      rememberReading(sampleReading, dialect);
      startSheet(sampleReading, 1);
      setSheets(loadSheets());
      setStatus("ready");
    },
    [dialect],
  );

  const land = useCallback(
    (next: StoredReading, pages: number) => {
      // See `seedSample`: writing the legacy `reading` field here forged a sheet to archive.
      rememberReading(next, dialect);
      startSheet(next, pages);
      setSheets(loadSheets());
      setStatus("ready");
    },
    [dialect],
  );

  const decline = useCallback((next: DeclineVariant) => {
    setVariant(next);
    setStatus("declined");
  }, []);

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
      setPageCount(images.length);
      setStatus("reading");
      let outcome = await readSheet(images, {});

      // contracts/api-read.md: on 413 the client re-downscales and retries ONCE. The pages are
      // shrunk further in memory and never stored; a second 413 falls to the honest decline.
      if (outcome.kind === "too_large") {
        const smaller = await shrinkImages(images, RETRY_LONG_EDGE);
        if (smaller) outcome = await readSheet(smaller, {});
      }

      switch (outcome.kind) {
        case "reading":
          land(outcome.reading, images.length);
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
      }
    }

    // Nothing new to read: talk about the sheet already on the phone. `loadSheets` migrates a
    // pre-v2 stored reading into a sheet on the way past, so an upgraded phone still lands here.
    if (loadSheets().active) {
      setStatus("ready");
      return;
    }
    router.replace("/");
  }, [decline, land, router, searchParams, seedSample]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
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
    play(true);
  }, [beats.length, play, sheetId, status]);

  /**
   * Changing the spoken language starts the sheet again, in the language just chosen.
   *
   * A committed message is a record of what was actually said, and rewriting one in another
   * language would be forging it — but leaving the reader with a thread they cannot read is
   * worse, and somebody who reaches for the language chip has just told you they did not
   * understand a word of it. So the thread is cleared and 明仔 says the sheet again from the top.
   * Only an in-session change does this: the ref starts empty, so the first render never resets
   * anything, and a reload leaves what was said alone.
   */
  const spokenIn = useRef<typeof dialect | null>(null);
  useEffect(() => {
    if (status !== "ready" || sheetId === null) return;
    const previous = spokenIn.current;
    spokenIn.current = dialect;
    if (previous === null || previous === dialect) return;
    takeFloor();
    askedCheckin.current = null;
    updateActive(() => ({ thread: [], briefing: { phase: "idle", step: 0 } }));
    setSheets(loadSheets());
    play(true);
  }, [dialect, play, sheetId, status, takeFloor]);

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
      if (!message.source) return "";
      const card = cardForSource(message.source);
      return card ? cardTitle(card.type, script) : t("cards.header");
    },
    [cardForSource, script, t],
  );

  const onListeningChange = useCallback(
    (open: boolean) => {
      setListening(open);
      // Holding the bar is how the reader takes the floor. Nothing else stops 明仔 mid-sentence,
      // and nothing should have to: the gesture that starts a question is the gesture that
      // interrupts the answer to the last one.
      if (open) takeFloor();
    },
    [takeFloor],
  );

  if (status === "reading") {
    return (
      <main className="mx-auto flex h-[calc(100dvh-var(--disclaimer-height))] w-full max-w-md flex-col">
        <ReadingProgress pageCount={pageCount} />
      </main>
    );
  }

  if (status === "declined") {
    return (
      <main className="mx-auto flex h-[calc(100dvh-var(--disclaimer-height))] w-full max-w-md flex-col overflow-y-auto px-5 pt-6 pb-6">
        <DeclineState
          variant={variant}
          onRetake={() => router.push("/")}
          onSample={() => void seedSample(DEFAULT_SAMPLE)}
        />
        <AgentLimits className="mt-6" />
      </main>
    );
  }

  if (status === "boot" || !sheet) return <Booting />;

  return (
    <main className="mx-auto flex h-[calc(100dvh-var(--disclaimer-height))] w-full max-w-md flex-col overflow-hidden">
      <ChatHeader
        title={title}
        capturedAt={sheet.capturedAt}
        speakerOn={speakerOn}
        onToggleSpeaker={() => setSpeakerOn((on) => !on)}
        onBack={() => router.push("/")}
        langOpen={langOpen}
        onOpenLang={() => setLangOpen(true)}
        onCloseLang={() => setLangOpen(false)}
      />

      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-2">
        <p className="mb-3 text-center text-fine text-faint">{t("chat.today")}</p>

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
            onOpenSource={(m) => m.source && openSource(m.source, cardForSource(m.source))}
            onOpenTrack={() => router.push("/track")}
            onSpeak={speakAgain}
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

      <ChatBar
        language={dialect}
        locale={locale}
        busy={asking}
        onSend={(text) => void submit(text)}
        onListening={onListeningChange}
        onInterim={setInterim}
        onNothingHeard={() => setNothingHeard(true)}
      />

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
