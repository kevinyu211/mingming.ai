"use client";

/**
 * One line in the 傾偈 thread — the briefing, the answers and the refusals all in one conversation.
 *
 * The refusal, the not-on-sheet answer and the crisis referral are **messages in the thread,
 * styled by `outcome`**, not separate screens (v2 build brief §6). That is a deliberate change
 * from v1: a refusal is part of the conversation, and throwing the reader onto another screen for
 * it made the app look broken rather than careful.
 *
 * Three flags on a message change what it says about itself, and all three come from the rules,
 * never from a model turn:
 *
 *   `origin: "model"` → the AI chip, required on every model-written body (FR-009).
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
  /** Audio for this message is playing right now (再講一次). Status only, never a control. */
  reading: boolean;
  /** The card heading the source belongs to, resolved by the page from the reading. */
  sourceTitle: string;
  /** The language the reader is being spoken to in; the referral card's numbers follow it. */
  dialect: Dialect;
  onOpenSource: (message: ThreadMessage) => void;
  onOpenTrack: () => void;
}

export default function ChatMessage({
  message,
  reading,
  sourceTitle,
  dialect,
  onOpenSource,
  onOpenTrack,
}: ChatMessageProps) {
  const t = useT();

  if (message.role === "user") {
    return (
      <div className="animate-rise mb-[22px] flex justify-end">
        <p className="max-w-[80%] rounded-[20px_6px_20px_20px] bg-jade-bubble px-5 py-4 text-med break-words text-ink">
          {message.text}
        </p>
      </div>
    );
  }

  // The crisis referral replaces the answer rather than joining it: fixed text, a real list of
  // numbers, nothing model-written and nothing spoken (rules.md §12).
  if (message.outcome === "crisis_referral") {
    return (
      <div className="animate-rise mb-[22px] flex items-start gap-[11px]">
        <Mascot size={44} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <ReferralCard inputLanguage={dialect} text={message.text} />
        </div>
      </div>
    );
  }

  const refusal =
    message.outcome === "refused_medicine_change" || message.outcome === "not_on_sheet";
  const heading =
    message.outcome === "refused_medicine_change"
      ? t("ask.refused")
      : message.outcome === "not_on_sheet"
        ? t("ask.notOnSheet")
        : null;

  return (
    <div className="animate-rise mb-[22px] flex items-start gap-[11px]">
      <Mascot size={44} state={reading ? "speaking" : "idle"} className="mt-0.5" />

      <div className="min-w-0 flex-1">
        {refusal ? (
          <section className="surface px-[18px] py-5">
            <h2 className="text-card-title font-bold text-ink">{heading}</h2>
            <p className="mt-2 text-[19px] leading-[1.6] break-words text-ink">{message.text}</p>
          </section>
        ) : (
          <p className="text-[20px] leading-[1.68] break-words text-ink">{message.text}</p>
        )}

        {message.stopped === true ? (
          <p className="mt-2 inline-flex rounded-full bg-neutral px-3 py-1.5 text-meta font-medium text-muted">
            {t("dose.stopped")}
          </p>
        ) : null}

        {reading ? (
          <p className="mt-2.5 flex items-center gap-[9px] text-meta font-medium text-jade-ink">
            <Waveform />
            {t("chat.reading")}
          </p>
        ) : null}

        {message.origin === "model" ? <AiLabel className="mt-2.5" /> : null}

        {message.source ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onOpenSource(message)}
              className={
                message.unverified === true
                  ? "min-h-11 rounded-[12px] bg-warn-bg px-3.5 py-2 text-[17px] font-semibold text-warn-ink underline underline-offset-4"
                  : "min-h-11 text-meta font-semibold text-jade-ink underline underline-offset-4"
              }
            >
              {t("card.sourceLink")}
              <span className="sr-only"> · {sourceTitle}</span>
            </button>
          </div>
        ) : null}

        {message.link === "track" ? (
          <button
            type="button"
            onClick={onOpenTrack}
            className="mt-3 min-h-12 rounded-[14px] bg-jade-tint-2 px-[18px] py-3.5 text-[17px] font-medium text-jade-ink"
          >
            {t("brief.trackLink")} ›
          </button>
        ) : null}
      </div>
    </div>
  );
}
