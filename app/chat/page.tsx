"use client";

/**
 * 傾偈 — the whole product, as one conversation with 明仔 (v2 build brief §6).
 *
 * The sheet does not arrive as a stack of cards any more. It arrives as messages: 明仔 types
 * himself out clause by clause and speaks at the same time, stops after every piece to ask
 * 明唔明？, and takes questions in the same thread. There is **no play button anywhere** — the
 * 讀住 waveform is a status indicator and the only voice control is the speaker toggle in the
 * header.
 *
 * ── What is a rule here and what is a model turn ────────────────────────────────────────────
 *
 * The **order** is `lib/rules/card-order.ts` and nothing else. Warning signs are spoken first, by
 * construction: the amber block renders and reads itself before the first 明唔明？, and no model
 * output can reorder, delay or bury it (constitution II). The **check-in question**, the intro,
 * the refusals and every reply to 食咗 / 未食 are fixed templates from `lib/i18n/ui.ts` with the
 * page's own clause dropped into the slot verbatim — a model never assembles one of those
 * sentences. The **crisis and medicine-change gates run before any network call**, exactly as
 * they did on `/read`, and a crisis question is answered from a fixed list with nothing sent.
 * The only model-written strings on this screen are the card bodies and the answers, and both
 * carry the AI chip.
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
 *      never a name; nothing here addresses anybody.
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
import Mascot from "@/components/Mascot";
import SampleBanner from "@/components/SampleBanner";
import SourceSheet from "@/components/SourceSheet";
import { PENDING_IMAGES_KEY } from "@/components/Capture";
import ChatBar from "@/components/chat/ChatBar";
import ChatHeader from "@/components/chat/ChatHeader";
import ChatMessage from "@/components/chat/ChatMessage";
import ReadingProgress from "@/components/chat/ReadingProgress";
import Waveform from "@/components/chat/Waveform";
import WarningBlock from "@/components/chat/WarningBlock";
import { CheckinPrompt, UnderstandPrompt } from "@/components/chat/Prompts";
import {
  CLAUSE_MS,
  COMMIT_MS,
  checkinTarget,
  chunks,
  fill,
  hasCountableDose,
  pieceSpeech,
  splitCards,
  trackLinkIndex,
  warningSpeech,
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

/**
 * The least time the amber block stays on screen before 明唔明？ appears over it, whether or not
 * there is a voice on this phone. A silent device must not skip past the red flags in 200 ms.
 */
const MIN_WARN_MS = 4200;

/** The beat between the thread painting and 明仔 starting to speak. The canvas waits about this long. */
const START_MS = 400;

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
  /** Which thing is making noise right now: a thread message id, "warn", or null. */
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const voice = useVoice(dialect, speakerOn);
  const { say, resay, cancel } = voice;

  const threadRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const request = useRef<AbortController | null>(null);
  /** True while an automatic step of the briefing is running, so an effect cannot start a second. */
  const driving = useRef(false);

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
  const { warnings, pieces, empty } = useMemo(() => splitCards(cards), [cards]);
  const trackIndex = useMemo(() => trackLinkIndex(pieces), [pieces]);

  /** Converts display text into the reader's script. Verbatim page quotes are never converted. */
  const display = useCallback(
    (text: string) => (script === scriptForDialect(dialect) ? text : toScript(text, script)),
    [dialect, script],
  );

  const warnLines = useMemo(
    () => warnings.map((card) => display(card.body[dialect])),
    [warnings, display, dialect],
  );

  const phase = sheet?.briefing.phase ?? "idle";
  const step = sheet?.briefing.step ?? 0;
  const thread = useMemo(() => sheet?.thread ?? [], [sheet]);

  /* --------------------------------------------------------- the briefing */

  const setBriefing = useCallback((nextPhase: Sheet["briefing"]["phase"], nextStep: number) => {
    updateActive(() => ({ briefing: { phase: nextPhase, step: nextStep } }));
  }, []);

  /** Speaks the amber block. It is already on screen — a rendered block is never re-typed. */
  const readWarnings = useCallback(
    (list: Card[], onDone?: () => void) => {
      const text = warningSpeech(list, dialect);
      setSpeakingId("warn");
      resay(text);
      // Long enough to read, and at least as long as the clause chain would have taken, so a
      // phone with no voice still holds the red flags on screen instead of flashing past them.
      const held = Math.max(MIN_WARN_MS, chunks(text).length * CLAUSE_MS + COMMIT_MS);
      at(held, () => {
        setSpeakingId(null);
        onDone?.();
      });
    },
    [at, dialect, resay],
  );

  /** Types out one piece, commits it to the thread, and lines up the next 明唔明？ (or the end). */
  const sayPiece = useCallback(
    (index: number) => {
      const card = pieces[index];
      if (!card) return;
      driving.current = true;
      setBriefing("speaking", index + 1);
      const text = display(pieceSpeech(card, dialect));
      setSpeakingId("piece");
      say(text, () => {
        appendMessage({
          role: "agent",
          text,
          origin: card.aiGenerated ? "model" : "rule",
          source: card.source ?? null,
          link: index === trackIndex ? "track" : null,
          outcome: null,
          stopped: card.stopped === true,
          unverified: card.unverified === true,
        });
        setSpeakingId(null);
        const done = index + 1 >= pieces.length;
        setBriefing(done ? "end" : "ask", index + 1);
        // The in-app check-in becomes available only once the whole sheet has been said, and only
        // when the page actually printed a frequency this app can count (brief §6).
        if (done) {
          updateActive((s) =>
            s.checkin === "none" && hasCountableDose(s.reading)
              ? { checkin: "pending" }
              : {},
          );
        }
        driving.current = false;
      });
    },
    [dialect, display, pieces, say, setBriefing, trackIndex],
  );

  /**
   * Picks the briefing up wherever it stopped. Called once per sheet.
   *
   * `speaking` means the reader left while a piece was being typed: nothing was committed, so
   * that piece is said again from the top, which is what "resumes exactly where it stopped" has
   * to mean for a message that never finished arriving.
   */
  const resumeBriefing = useCallback(() => {
    if (driving.current) return;
    const current = loadSheets().active;
    if (!current) return;
    const { phase: p, step: s } = current.briefing;

    if (p === "idle") {
      driving.current = true;
      const introText = display(t("brief.intro"));
      setSpeakingId("intro");
      say(introText, () => {
        appendMessage({ role: "agent", text: introText, origin: "rule" });
        setSpeakingId(null);
        setBriefing("intro", 0);
        readWarnings(warnings, () => {
          setBriefing("ask", 0);
          driving.current = false;
        });
      });
      return;
    }

    if (p === "intro") {
      driving.current = true;
      setBriefing("warn", s);
      readWarnings(warnings, () => {
        setBriefing("ask", s);
        driving.current = false;
      });
      return;
    }

    // The block is already on screen and has already been read: 再講一次 is how it repeats.
    if (p === "warn") {
      setBriefing("ask", s);
      return;
    }

    if (p === "speaking") sayPiece(Math.max(0, s - 1));
  }, [display, readWarnings, say, sayPiece, setBriefing, t, warnings]);

  const onUnderstand = useCallback(() => {
    if (step >= pieces.length) {
      setBriefing("end", step);
      updateActive((s) =>
        s.checkin === "none" && hasCountableDose(s.reading) ? { checkin: "pending" } : {},
      );
      return;
    }
    sayPiece(step);
  }, [pieces.length, sayPiece, setBriefing, step]);

  /** 再講一次: says the last thing again, out loud, without re-typing a word of it. */
  const onRepeat = useCallback(() => {
    const lastAgent = [...thread].reverse().find((m) => m.role === "agent" && m.origin !== "user");
    if (step === 0 || !lastAgent) {
      readWarnings(warnings);
      return;
    }
    setSpeakingId(lastAgent.id);
    resay(lastAgent.text);
  }, [readWarnings, resay, step, thread, warnings]);

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

      // The reader interrupting has the floor: whatever 明仔 was saying stops, and — this is the
      // part that is easy to miss — the automatic driver must not start the briefing on top of the
      // answer while the request is in flight. `driving` is claimed here and released on every
      // way out, so the two never speak over each other. The briefing picks itself up afterwards.
      cancel();
      setSpeakingId(null);
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
      const controller = new AbortController();
      request.current = controller;

      const result = await ask(
        { reading, question: { text, inputLanguage: dialect }, dialect, memory: memoryBrief() },
        { signal: controller.signal },
      );
      request.current = null;
      setAsking(false);

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
    [asking, cancel, cards, dialect, display, locale, reading, say],
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
   * One driver, one guard: it starts (or picks up) the briefing when a sheet is ready, and asks
   * the check-in question once the notification has been opened. Never both at once, never twice.
   *
   * The step is queued rather than run inline. That is not a lint dodge: 明仔 starting to speak in
   * the same frame the thread paints reads as a jump cut, the design canvas waits ~400 ms before
   * `startBriefing` for the same reason, and the timeout is cleared on unmount so a briefing that
   * was about to start on a screen the reader has left never starts at all.
   */
  const sheetId = sheet?.id ?? null;
  const checkinState = sheet?.checkin ?? "none";
  useEffect(() => {
    if (status !== "ready" || sheetId === null) return;
    if (driving.current) return;
    const queued = setTimeout(() => {
      if (driving.current) return;
      if (phase !== "ask" && phase !== "end") {
        resumeBriefing();
        return;
      }
      if (checkinState !== "open") {
        askedCheckin.current = null;
        return;
      }
      if (
        checkinQuestion.length > 0 &&
        lastAgentText !== checkinQuestion &&
        askedCheckin.current !== checkinQuestion
      ) {
        askCheckin();
      }
    }, START_MS);
    return () => clearTimeout(queued);
  }, [
    askCheckin,
    checkinQuestion,
    checkinState,
    lastAgentText,
    phase,
    resumeBriefing,
    sheetId,
    status,
  ]);

  /* ----------------------------------------------------------------- view */

  // Follow the conversation down as it grows, and while a clause is being revealed.
  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [thread.length, voice.typing, phase, checkinOpen]);

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

  // Derived live rather than read off `sheet.title`, so flipping the interface language also
  // flips the fallback 出院紙 / 出院纸 / Discharge sheet. Still `sheetTitle()`, still never invented.
  const title = useMemo(() => sheetTitle(reading, locale), [reading, locale]);

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

  const showWarn = phase !== "idle" && phase !== "intro" && warnings.length > 0;
  const warnReading = speakingId === "warn" && voice.speaking;

  /** One thread bubble. Shared by the two slices either side of the amber block. */
  const renderMessage = (message: ThreadMessage) => (
    <ChatMessage
      key={message.id}
      message={message}
      reading={speakingId === message.id && voice.speaking}
      sourceTitle={sourceTitleFor(message)}
      dialect={dialect}
      onOpenSource={(m) => m.source && openSource(m.source, cardForSource(m.source))}
      onOpenTrack={() => router.push("/track")}
    />
  );

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

      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-[22px] pt-5 pb-2">
        <p className="mb-[22px] text-center text-meta text-faint">{t("chat.today")}</p>

        {reading?.sample === true ? (
          <div className="mb-[22px] flex justify-center">
            <SampleBanner />
          </div>
        ) : null}

        {/*
         * 明仔 greets, and THEN the amber block appears. The order is the whole point of the
         * greeting: 「我睇完你張紙。最緊要嘅先講。」 promises that the most important thing comes
         * next, so rendering the warnings above it makes the sentence describe something the
         * reader has already scrolled past. The canvas has the intro bubble first for the same
         * reason (design-canvas/workflow-v2.dc.html, the `isChat` block).
         *
         * The intro is thread message 0 and the warnings occupy the slot straight after it, so the
         * split is at 1 rather than at a phase: on a resumed sheet the thread already has its later
         * messages, and they belong below the block exactly as they did when they were first said.
         */}
        {thread.slice(0, 1).map(renderMessage)}

        {showWarn ? (
          <WarningBlock
            cards={warnings}
            lines={warnLines}
            empty={empty}
            reading={warnReading}
            onOpenSource={(source, card) => openSource(source, card)}
          />
        ) : null}

        {thread.slice(1).map(renderMessage)}

        {voice.typing !== null ? (
          <div className="mb-[22px] flex items-start gap-[11px]">
            <Mascot size={44} state="speaking" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[20px] leading-[1.68] break-words text-ink">
                {voice.typing}
                <span
                  aria-hidden="true"
                  className="animate-blink ml-[3px] inline-block h-5 w-[3px] translate-y-[3px] bg-jade"
                />
              </p>
              {voice.speaking ? (
                <p className="mt-2.5 flex items-center gap-[9px] text-meta font-medium text-jade-ink">
                  <Waveform />
                  {t("chat.reading")}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {checkinOpen ? <CheckinPrompt onTook={onTook} onNotYet={onNotYet} /> : null}

        {phase === "ask" && voice.typing === null && !checkinOpen ? (
          <UnderstandPrompt
            remaining={pieces.length - step}
            showRemaining={step > 0}
            onRepeat={onRepeat}
            onUnderstand={onUnderstand}
          />
        ) : null}

        {phase === "end" && voice.typing === null && !checkinOpen ? (
          <p className="animate-rise mb-4 px-0.5 text-body text-muted">{t("brief.end")}</p>
        ) : null}

        {asking ? <p className="mb-4 px-0.5 text-body text-muted">{t("ask.processing")}</p> : null}

        {voice.voiceUnavailable ? (
          <p className="mb-4 px-0.5 text-meta text-muted">{t("fallback.noVoiceNote")}</p>
        ) : null}

        {/* FR-022: what the agent will and will not do, on the screen with the microphone. */}
        <AgentLimits className="mt-2 mb-2" />
      </div>

      <ChatBar language={dialect} locale={locale} busy={asking} onSend={(text) => void submit(text)} />

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
