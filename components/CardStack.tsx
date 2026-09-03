"use client";

/**
 * The sheet, as the agent's first message in the one-screen conversation (`app/read/page.tsx`).
 *
 * This renders ONE assistant message: the rule-generated cards in the fixed order from
 * `lib/rules/card-order.ts` — red flags first, always — with a single "read it all" control at the
 * top of the message. It is also the one place that owns speaking the sheet: "read it all" walks
 * the cards in order without overlapping voices, and tapping one line plays just that line.
 *
 * A run counter (not just an AbortSignal) guards the sequence, so a tap on card 3 mid-way through
 * "read it all" cleanly abandons the old walk. `onSpeakStart` lets the page stop the *answer* voice
 * before the sheet starts, and `stopRef` hands this walk's stop up so the answer's own play can stop
 * the sheet — the two speakers never talk over each other.
 *
 * Every spoken string is the card body plus the caution sentence the rulebook requires (FR-008),
 * appended here at the call site because `lib/speech/tts.ts` says exactly the string it is given —
 * which is what keeps its per-string audio cache honest.
 *
 * Nothing autoplays. iOS needs a user gesture before audio, and a phone that starts talking on its
 * own in a taxi is its own kind of failure, so the message waits for a tap.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import CardView, { isGroupedType } from "@/components/Card";
import { useLocale } from "@/components/LocaleProvider";
import type { Card, CardType, Dialect } from "@/lib/domain/schemas";
import { cardTitle } from "@/lib/rules/card-order";
import { CAUTION_SUFFIX } from "@/lib/rules/template-fallback";
import { ensureVoicesLoaded, speak, stopSpeaking } from "@/lib/speech/tts";

/** Longest a three-character form of address may hold up the reading if `onend` never fires. */
const ADDRESS_TIMEOUT_MS = 3000;

/**
 * Says one short phrase with the phone's own voice and nothing else (T039).
 *
 * `speak()` is the normal path, but it posts its text to `/api/tts` first, and no request may
 * carry the relationship label — not the model's, not the voice provider's (constitution
 * principle V, FR-019, and the data statement this app shows in settings). So the form of
 * address goes straight to `window.speechSynthesis`, which is on the phone, and the card text
 * that follows goes through `speak()` without it.
 *
 * Best-effort by design: a device with no Cantonese or Mandarin voice simply hears the cards
 * without the address rather than losing the reading.
 */
async function sayLocally(phrase: string, dialect: Dialect, signal: AbortSignal): Promise<void> {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
  const voices = await ensureVoicesLoaded();
  const wanted = dialect === "yue" ? "zh-hk" : "zh-cn";
  const voice = voices.find((entry) =>
    (entry.lang ?? "").toLowerCase().replace(/_/g, "-").startsWith(wanted),
  );
  if (!voice || signal.aborted) return;

  const utterance = new SpeechSynthesisUtterance(phrase);
  utterance.voice = voice;
  utterance.lang = voice.lang;

  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      utterance.onend = null;
      utterance.onerror = null;
      resolve();
    };
    // Some engines drop `onend` when the tab loses focus mid-phrase; the reading goes on anyway.
    const timer = setTimeout(done, ADDRESS_TIMEOUT_MS);
    utterance.onend = done;
    utterance.onerror = done;
    signal.addEventListener(
      "abort",
      () => {
        window.speechSynthesis.cancel();
        done();
      },
      { once: true },
    );
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * The 120 ms staggered fade-and-rise from design.md section 3. Injected once here and used by
 * `components/Card.tsx` (which sets its own `animation-delay`). The reduced-motion rule in
 * globals.css already collapses every animation, and this repeats it so the intent is local.
 */
const ARRIVAL_CSS = `
@keyframes card-rise {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: none; }
}
/* fill-mode "backwards", not "both": the card is hidden during its stagger delay, and once the
   animation ends nothing keeps filling a transform — a permanently filling transform promotes the
   card to its own layer, which then paints over neighbours and becomes a containing block. */
.card-rise { animation: card-rise 320ms ease-out backwards; }
@media (prefers-reduced-motion: reduce) {
  .card-rise { animation: none; opacity: 1; transform: none; }
}
`;

/**
 * One run of same-kind cards. The reading arrives in a fixed order (`lib/rules/card-order.ts`),
 * so a run is exactly what the design canvas draws as one grouped list: three medicines under one
 * small heading, inside one white surface, with an inset hairline between them.
 */
interface Group {
  type: CardType;
  cards: Card[];
  /** Index into `cards` of the whole stack, for the staggered arrival and the play callbacks. */
  offset: number;
}

function groupCards(cards: Card[]): Group[] {
  const groups: Group[] = [];
  cards.forEach((card, index) => {
    const last = groups[groups.length - 1];
    if (last && last.type === card.type) last.cards.push(card);
    else groups.push({ type: card.type, cards: [card], offset: index });
  });
  return groups;
}

export interface CardStackProps {
  cards: Card[];
  /**
   * The relationship label from the profile, e.g. 阿媽. "read it all" opens with it so the parent
   * knows the phone is talking to her. Spoken by the device only — see `sayLocally`.
   */
  address?: string;
  /**
   * Called the instant this message starts speaking, so the page can stop the answer voice first.
   * The two speakers (sheet here, answer on the page) must never overlap.
   */
  onSpeakStart?: () => void;
  /** Handed this walk's stop, so the answer's own play control can stop the sheet in turn. */
  stopRef?: MutableRefObject<(() => void) | null>;
  /** Extra content above the message (the sample banner, say). */
  children?: ReactNode;
}

export default function CardStack({
  cards,
  address = "",
  onSpeakStart,
  stopRef,
  children,
}: CardStackProps) {
  const { dialect, script, t } = useLocale();
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [played, setPlayed] = useState(false);

  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Chrome and iOS Safari both return an empty voice list on the first synchronous call, so warm
  // it before the first tap rather than failing one silently. On unmount the run counter is bumped
  // so any walk still in progress stops instead of talking on.
  useEffect(() => {
    void ensureVoicesLoaded();
    const run = runRef;
    const abort = abortRef;
    return () => {
      run.current += 1;
      abort.current?.abort();
      stopSpeaking();
    };
  }, []);

  const stop = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    stopSpeaking();
    setSpeakingId(null);
  }, []);

  // Hand this walk's stop up to the page, so playing an answer can silence the sheet.
  useEffect(() => {
    if (!stopRef) return;
    stopRef.current = stop;
    return () => {
      if (stopRef.current === stop) stopRef.current = null;
    };
  }, [stop, stopRef]);

  /** Speak `count` cards starting at `from`, in order, abandoning the walk if anything else starts. */
  const play = useCallback(
    async (from: number, count: number, addressFirst = false) => {
      // Silence the answer voice before the sheet starts (they share the one speaker).
      onSpeakStart?.();
      runRef.current += 1;
      abortRef.current?.abort();
      stopSpeaking();

      const run = runRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setPlayed(true);

      // A snapshot on purpose: a card that arrives mid-walk joins the next play, not this one.
      const list = cards;
      const end = Math.min(list.length, from + count);

      for (let i = from; i < end; i += 1) {
        if (runRef.current !== run) return;
        const card = list[i];
        setSpeakingId(card.id);

        // "阿媽，" before the first sentence of a full reading, and only there: a form of
        // address on every card would nag. The label is never appended to `text` below.
        if (i === from && addressFirst && address.length > 0) {
          await sayLocally(`${address}，`, dialect, controller.signal);
          if (runRef.current !== run) return;
        }

        const text = `${card.body[dialect]} ${CAUTION_SUFFIX[dialect]}`;
        let mode: string;
        try {
          mode = (await speak(text, dialect, { signal: controller.signal })).mode;
        } catch {
          mode = "text-only";
        }

        // A newer tap already took over; that run owns the UI now.
        if (runRef.current !== run) return;
        if (mode === "text-only") {
          // No cloud voice and no device voice: switch the whole message to the S10 read-it state.
          setUnavailable(true);
          setSpeakingId(null);
          return;
        }
      }

      if (runRef.current === run) setSpeakingId(null);
    },
    [address, cards, dialect, onSpeakStart],
  );

  const playOne = useCallback((index: number) => void play(index, 1), [play]);
  const playAll = useCallback(() => void play(0, cards.length, true), [play, cards.length]);

  const speaking = speakingId !== null;
  const groups = groupCards(cards);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ARRIVAL_CSS }} />

      {children}

      {/* The one "read it all" control for the whole message. Its states are the old play-all bar's:
          idle, speaking, and — when the phone has no voice at all — the S10 read-it note, so the
          words already on the cards are still the fallback. */}
      {cards.length > 0 ? (
        <div className="mt-4">
          {unavailable ? (
            // Ink rather than muted grey: this line is the whole fallback, and muted on the panel
            // is only 3.9:1.
            <p className="tap h-[52px] w-full gap-2 rounded-full bg-panel px-4 text-meta text-ink">
              <EyeGlyph />
              <span className="min-w-0">{t("fallback.noVoiceNote")}</span>
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={speaking ? stop : playAll}
                aria-pressed={speaking}
                className="tap h-[52px] w-full gap-2 rounded-full bg-accent px-5 text-body font-semibold text-accent-ink shadow-raised"
              >
                <SpeechGlyph />
                {speaking ? t("cards.stop") : t("cards.playAll")}
              </button>
              {!played ? (
                <p className="mt-2 text-center text-meta text-muted">{t("progress.note")}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-[22px]">
        {groups.map((group) => {
          const grouped = isGroupedType(group.type);
          return (
            <div key={`${group.type}-${group.offset}`}>
              {grouped ? (
                // The small heading the grouped list hangs under. It repeats the heading each
                // card still carries for screen readers, so it is hidden from them.
                <p aria-hidden="true" className="mb-2 ml-1 text-fine font-semibold text-muted">
                  {cardTitle(group.type, script)}
                </p>
              ) : null}
              <div className={grouped ? "surface overflow-hidden" : "flex flex-col gap-3"}>
                {group.cards.map((card, within) => (
                  <Fragment key={card.id}>
                    {grouped && within > 0 ? (
                      <div aria-hidden="true" className="ml-[18px] h-px bg-hairline" />
                    ) : null}
                    <CardView
                      card={card}
                      index={group.offset + within}
                      groupIndex={within}
                      groupCount={group.cards.length}
                      speaking={speakingId === card.id}
                      unavailable={unavailable}
                      onPlay={() => playOne(group.offset + within)}
                      onStop={stop}
                    />
                  </Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A speech bubble with sound coming out of it. No medical symbols anywhere (design.md 3). */
function SpeechGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h6A2.5 2.5 0 0 1 15 6.5v5A2.5 2.5 0 0 1 12.5 14H9l-4 3.5V14h-.5" />
      <path d="M18 8.5a4 4 0 0 1 0 7" />
    </svg>
  );
}

function EyeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[19px] w-[19px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
