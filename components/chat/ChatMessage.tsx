"use client";

/**
 * One line in the 傾偈 thread — the briefing, the answers and the refusals all in one conversation.
 *
 * The refusal, the not-on-sheet answer and the crisis referral are **messages in the thread,
 * styled by `outcome`**, not separate screens (v2 build brief §6). That is a deliberate change
 * from v1: a refusal is part of the conversation, and throwing the reader onto another screen for
 * it made the app look broken rather than careful.
 *
 * ## Why this is a bubble now, and a small one
 *
 * The first build gave 明明 full-width 20 px paragraphs and put the warning signs in a 22 px block
 * of their own. On a phone that is one and a half messages per screen: the conversation — the
 * thing the whole product is — could not be seen. So both sides are bubbles at the scale a
 * messaging app uses, the avatar is 30 px, and a warning is an amber bubble in the same column as
 * everything else rather than a panel above it. Nothing about the ORDER changed: the warning beats
 * are still first, still spoken first, still unskippable (constitution II). Only the furniture
 * around them got out of the way.
 *
 * Four flags on a message change what it says about itself, and all four come from the rules,
 * never from a model turn:
 *
 *   `origin: "model"` → the AI chip, required on every model-written body (FR-009).
 *   `lead`            → the app's own connective, shown as a quiet line above the body. It is
 *                       never generated, which is what lets it share a bubble with a model body.
 *   `stopped`         → the page has withdrawn this medicine. Marked as ended, and given no
 *                       counter and no 食咗 affordance anywhere in this screen.
 *   `unverified`      → the card and its own quoted line disagree. The caution sentence is
 *                       already in the text; here the source link is emphasised, because that
 *                       line is the one to go and check on the paper.
 */
import AiLabel from "@/components/AiLabel";
import { useT } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import ReferralCard from "@/components/ReferralCard";
import Waveform from "@/components/chat/Waveform";
import type { Dialect } from "@/lib/domain/schemas";
import type { ThreadMessage } from "@/lib/sheets/types";

export interface ChatMessageProps {
  message: ThreadMessage;
  /** Audio for this message is playing right now. Status; the speaker button is the control. */
  reading: boolean;
  /** The card heading the source belongs to, resolved by the page from the reading. */
  sourceTitle: string;
  /** The language the reader is being spoken to in; the referral card's numbers follow it. */
  dialect: Dialect;
  onOpenSource: (message: ThreadMessage) => void;
  onOpenTrack: () => void;
  /**
   * Says this message again, out loud, without re-typing it. This replaced the 再講一次 button
   * that used to sit under a 明唔明？ prompt: the repeat belongs to the thing being repeated, and
   * a reader who wants the third message again should not have to get back to it through a prompt
   * that has long scrolled away.
   */
  onSpeak: (message: ThreadMessage) => void;
}

export default function ChatMessage({
  message,
  reading,
  sourceTitle,
  dialect,
  onOpenSource,
  onOpenTrack,
  onSpeak,
}: ChatMessageProps) {
  const t = useT();

  if (message.role === "user") {
    return (
      <div className="animate-rise mb-2.5 flex justify-end pl-10">
        <p className="max-w-[82%] rounded-[16px_4px_16px_16px] bg-jade-bubble px-3.5 py-2.5 text-[16px] leading-[1.55] break-words text-ink">
          {message.text}
        </p>
      </div>
    );
  }

  // The crisis referral replaces the answer rather than joining it: fixed text, a real list of
  // numbers, nothing model-written and nothing spoken (rules.md §12).
  if (message.outcome === "crisis_referral") {
    return (
      <div className="animate-rise mb-2.5 flex items-start gap-2">
        <Mascot size={30} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <ReferralCard inputLanguage={dialect} text={message.text} />
        </div>
      </div>
    );
  }

  const warn = message.tone === "warn";
  const refusal =
    message.outcome === "refused_medicine_change" || message.outcome === "not_on_sheet";
  /**
   * A general explanation gets its own heading, and that heading is the whole safety of the
   * feature (constitution IV, amended 1.1.0).
   *
   * It is answered from ordinary knowledge, not from this person's page, so it cites no line and
   * nothing behind it can be checked against the paper. The reader must be able to tell at a
   * glance that 明明 is explaining a word rather than reporting their sheet — otherwise a general
   * statement about fasting reads as an instruction their doctor wrote down.
   */
  const heading =
    message.outcome === "refused_medicine_change"
      ? t("ask.refused")
      : message.outcome === "not_on_sheet"
        ? t("ask.notOnSheet")
        : message.outcome === "explained"
          ? t("ask.explained")
          : null;

  const bubble = warn
    ? "bg-warn-bg text-warn-ink"
    : refusal
      ? "bg-neutral text-ink"
      : "bg-card text-ink shadow-card";

  return (
    <div className="animate-rise mb-2.5 flex items-start gap-2 pr-8">
      <Mascot size={30} state={reading ? "speaking" : "idle"} className="mt-0.5 shrink-0" />

      <div className="min-w-0 flex-1">
        <div className={`rounded-[4px_16px_16px_16px] px-3.5 py-2.5 ${bubble}`}>
          {/*
            The connective. 13 px and muted so it reads as the app's own signposting rather than as
            the first sentence of the body — which matters, because the body underneath may be
            model-written and the line above it never is.
          */}
          {message.lead ? (
            <p
              className={`mb-1 text-fine font-medium ${warn ? "text-warn-stroke" : "text-muted"}`}
            >
              {message.lead}
            </p>
          ) : null}

          {/* A refusal keeps a real heading: it is a different kind of answer, and a screen
              reader has to be able to tell that from the body alone. */}
          {heading ? (
            <h2 className="mb-1 text-fine font-semibold text-muted">{heading}</h2>
          ) : null}

          {warn ? (
            /* `whitespace-pre-line` on both: a bubble is a SECTION now, so its text carries real
               newlines — one line per red flag, and a blank line before the question it ends with.
               Without this CSS collapses them and four warning signs run together into a wall of
               prose, which is the shape this change exists to get away from. */
            <p className="flex items-start gap-2 text-[16.5px] leading-[1.55] font-medium break-words whitespace-pre-line">
              <WarningMark />
              <span className="min-w-0 flex-1">{message.text}</span>
            </p>
          ) : (
            <p className="text-[16.5px] leading-[1.6] break-words whitespace-pre-line">
              {message.text}
            </p>
          )}

          {message.stopped === true ? (
            <span className="mt-1.5 inline-flex rounded-full bg-neutral px-2.5 py-1 text-fine font-medium text-muted">
              {t("dose.stopped")}
            </span>
          ) : null}

          {/*
            Everything the bubble says about itself, on one line: who wrote it, where on the paper
            it came from, and how to hear it again. One row instead of three stacked blocks is most
            of where the height went.
          */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => onSpeak(message)}
              aria-label={t("chat.speakAgain")}
              className={`flex min-h-9 items-center gap-1.5 text-fine font-semibold ${
                warn ? "text-warn-ink" : "text-jade-ink"
              }`}
            >
              {reading ? <Waveform tone={warn ? "warn" : "jade"} /> : <SpeakerMark />}
              {reading ? t("chat.reading") : t("chat.speakAgain")}
            </button>

            {(message.sources?.length ?? 0) > 0 ? (
              <button
                type="button"
                onClick={() => onOpenSource(message)}
                className={
                  // An unverified card is the one to go and check against the paper, so its link
                  // is drawn on the warning fill even inside an ordinary white bubble.
                  message.unverified === true && !warn
                    ? "min-h-9 rounded-[10px] bg-warn-bg px-2 py-1 text-fine font-semibold text-warn-ink underline underline-offset-4"
                    : `min-h-9 text-fine font-semibold underline underline-offset-4 ${
                        warn ? "text-warn-ink" : "text-jade-ink"
                      }`
                }
              >
                {t("card.sourceLink")}
                <span className="sr-only"> · {sourceTitle}</span>
              </button>
            ) : null}

            {message.origin === "model" ? <AiLabel /> : null}
          </div>
        </div>

        {message.link === "track" ? (
          <button
            type="button"
            onClick={onOpenTrack}
            className="mt-1.5 min-h-10 rounded-[12px] bg-jade-tint-2 px-3.5 py-2 text-fine font-medium text-jade-ink"
          >
            {t("brief.trackLink")} ›
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The amber triangle, inline with the first line of a warning rather than over a block of them. */
function WarningMark() {
  return (
    <svg
      viewBox="0 0 21 19"
      aria-hidden="true"
      focusable="false"
      className="mt-1 h-4 w-[18px] shrink-0"
      fill="none"
      stroke="var(--warn-stroke)"
      strokeWidth="2.1"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M10.5 1.6 19.6 17H1.4L10.5 1.6Z" />
      <path d="M10.5 7.2v4M10.5 13.9v.2" strokeWidth="2.3" />
    </svg>
  );
}

function SpeakerMark() {
  return (
    <svg
      viewBox="0 0 18 16"
      aria-hidden="true"
      focusable="false"
      className="h-3.5 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M8.4 2.2 5.1 5.2H2.4v5.6h2.7l3.3 3V2.2Z" />
      <path d="M11.6 5.4a3.7 3.7 0 0 1 0 5.2M14.2 3.2a7 7 0 0 1 0 9.6" />
    </svg>
  );
}
