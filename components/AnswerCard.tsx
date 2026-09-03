"use client";

/**
 * The last answer on the ask screen (design.md S6, drawn on the design canvas as AskAnswered and
 * AskRefused). One component, four looks, because each outcome is a designed state rather than a
 * variation on "here is your answer":
 *
 *   answered                a teal chip naming the card it came from, the sentence set large, the
 *                           verbatim line from the page under a teal rule, then play and the AI note
 *   refused_medicine_change neutral card, a quiet round glyph and 呢樣要問藥劑師, plus the hospital
 *                           contact line the sheet printed, when it printed one (FR-011)
 *   not_on_sheet            same shape, muted "?" glyph, 張紙冇講呢樣 (FR-013)
 *   model_unavailable /     calm card: it cannot answer right now, and the cards read off the
 *   bad_request             sheet are unchanged (contracts/api-ask.md, Errors)
 *
 * The crisis outcome is not here: it is `components/ReferralCard.tsx`, because it replaces the
 * answer rather than being one.
 *
 * On `answered` the title is the sentence itself, so the card's own heading is kept for assistive
 * tech and taken off the screen — the section stays labelled, the canvas stays uncluttered. The
 * other three keep a visible heading, because there the heading IS the state.
 *
 * The AI note rides only on `answered`. The other three bodies are fixed templates from
 * `lib/rules/`, and labelling a rule-written sentence as model-written would be a lie in the one
 * place the product cannot afford one. The refusal says so out loud instead.
 *
 * The source affordance and the play control are the same components the read screen uses
 * (`SourceSheet`, `SpeakButton`), so an answer and a card behave identically: same bottom sheet
 * over the verbatim quote, same three play states. On this screen the quote is also shown inline —
 * tapping the block is what opens the sheet.
 */
import { useId, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import SourceSheet from "@/components/SourceSheet";
import SpeakButton from "@/components/SpeakButton";
import type { SourceReference, Speakable } from "@/lib/domain/schemas";
import { toScript } from "@/lib/i18n/script";
import type { UiLocale } from "@/lib/i18n/ui";

/** The outcomes this card renders. `crisis_referral` goes to `ReferralCard`. */
export type AnswerCardOutcome =
  | "answered"
  | "refused_medicine_change"
  | "not_on_sheet"
  | "model_unavailable"
  | "bad_request";

/**
 * Copy that has no key in `lib/i18n/ui.ts` yet. Same rules as everything there: no 診斷/治療/
 * 處方/治癒, no "you should", no number about the person.
 */
const LOCAL: Record<
  "unavailableTitle" | "unavailableBody" | "retry" | "sheetPhone" | "fixedText",
  Record<UiLocale, string>
> = {
  unavailableTitle: {
    hant: "而家答唔到",
    hans: "现在答不了",
    en: "I can't answer right now",
  },
  unavailableBody: {
    hant: "張紙讀出嚟嗰幾張卡冇變，照樣睇得。等陣再問多次。",
    hans: "这张纸读出来的那几张卡没有变，照样看得到。等一下再问一次。",
    en: "The cards read off the sheet have not changed and are still there. Try the question again in a moment.",
  },
  retry: { hant: "再問一次", hans: "再问一次", en: "Ask again" },
  sheetPhone: {
    hant: "張紙上面嘅電話",
    hans: "纸上面的电话",
    en: "The number printed on the sheet",
  },
  fixedText: {
    hant: "呢個答案冇經過 AI，係固定寫好嘅。",
    hans: "这个答案没有经过 AI，是固定写好的。",
    en: "This answer is fixed text. It did not go through AI.",
  },
};

/**
 * A number the phone can actually dial, or null. The sheets in the demo print a masked line
 * ("Ward enquiries: 2xxx xxxx"), and a call button that dials nothing is worse than no button.
 */
function dialable(contact: string): string | null {
  const match = contact.match(/[0-9][0-9\s-]{4,}[0-9]/);
  return match ? match[0].replace(/[\s-]/g, "") : null;
}

export interface AnswerCardProps {
  outcome: AnswerCardOutcome;
  /** The sentence to show and speak. Absent while the sentence is still streaming. */
  answer?: Speakable | null;
  /** The cited card's heading, e.g. 藥, shown as a chip. Only meaningful for `answered`. */
  citedCardTitle?: string | null;
  /** The line on the page the answer came from (constitution principle IV). */
  source?: SourceReference | null;
  /** The contact line printed on the sheet, shown with a refusal (FR-011). */
  hospitalContact?: string | null;
  /** Tapping play speaks the answer. Never called on its own: iOS needs the gesture. */
  onPlay?: () => void;
  onStop?: () => void;
  playing?: boolean;
  /** The device produced no voice for this dialect; the words stay on screen. */
  voiceUnavailable?: boolean;
  /** Retry affordance for the two failure outcomes. */
  onRetry?: () => void;
}

export default function AnswerCard({
  outcome,
  answer,
  citedCardTitle,
  source,
  hospitalContact,
  onPlay,
  onStop,
  playing = false,
  voiceUnavailable = false,
  onRetry,
}: AnswerCardProps) {
  const { dialect, script, locale, t } = useLocale();
  const titleId = useId();
  const [sourceOpen, setSourceOpen] = useState(false);

  const failed = outcome === "model_unavailable" || outcome === "bad_request";
  const answered = outcome === "answered";
  const refused = outcome === "refused_medicine_change";

  const title = failed
    ? LOCAL.unavailableTitle[locale]
    : answered
      ? t("ask.answered")
      : refused
        ? t("ask.refused")
        : t("ask.notOnSheet");

  // The written form follows the script toggle; the spoken form follows the dialect (FR-007).
  const body = failed
    ? LOCAL.unavailableBody[locale]
    : answer
      ? toScript(answer[dialect], script)
      : t("ask.processing");

  const contactNumber = refused && hospitalContact ? dialable(hospitalContact) : null;
  const lineLabel =
    source && source.lineIndex !== null
      ? `${t("source.line")} ${source.lineIndex + 1}`
      : t("source.lineUnknown");
  const caption = source?.section ? `${source.section} · ${lineLabel}` : lineLabel;

  return (
    <section
      aria-labelledby={titleId}
      className="surface flex flex-col gap-3.5 p-[18px]"
      lang={script === "hant" ? "zh-HK" : "zh-CN"}
    >
      {answered ? (
        <>
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
          {citedCardTitle ? (
            <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full bg-chip px-2.5 py-[5px] text-[12px] font-semibold text-accent">
              <Sparkle />
              <span className="truncate">
                {t("ask.answeredFrom")} · {citedCardTitle}
              </span>
            </span>
          ) : null}
          <p className="text-card-title leading-[1.45] font-semibold tracking-[-0.2px] text-ink">
            {body}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-soft text-muted"
            >
              {refused ? <PharmacistGlyph /> : <QuestionGlyph />}
            </span>
            <h2 id={titleId} className="text-med font-bold tracking-[-0.2px] text-ink">
              {title}
            </h2>
          </div>
          <p className="text-body leading-relaxed text-ink">{body}</p>
        </>
      )}

      {refused && hospitalContact ? (
        <div className="flex items-center justify-between gap-3 rounded-[12px] bg-soft px-4 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[12px] text-muted">{LOCAL.sheetPhone[locale]}</span>
            <span className="dose text-[18px] font-semibold break-words text-ink">
              {hospitalContact}
            </span>
          </div>
          {contactNumber ? (
            <a
              href={`tel:${contactNumber}`}
              aria-label={`${t("ask.referralCall")} ${hospitalContact}`}
              className="tap shrink-0 gap-1.5 rounded-full bg-accent px-4 text-meta font-semibold text-accent-ink"
            >
              <PhoneGlyph />
              {t("ask.referralCall")}
            </a>
          ) : null}
        </div>
      ) : null}

      {/* The line on the page, shown rather than promised. Tapping it opens the full sheet. */}
      {source ? (
        <button
          type="button"
          onClick={() => setSourceOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${t("card.sourceLink")}：${title}`}
          className="relative block w-full overflow-hidden rounded-[12px] bg-soft py-3 pr-3.5 pl-[14px] text-left"
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
          <span className="block truncate text-[12px] text-muted">{caption}</span>
          <span className="dose mt-1 block text-[16px] font-medium break-words text-ink">
            {source.quote.trim().length > 0 ? source.quote : t("card.unreadableBody")}
          </span>
          <span className="mt-1.5 flex items-center justify-end gap-1 text-fine font-semibold text-accent">
            <QuoteGlyph />
            {t("card.sourceLink")}
          </span>
        </button>
      ) : null}

      {failed && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="tap h-12 w-full rounded-full bg-accent px-4 text-body font-bold text-accent-ink"
        >
          {LOCAL.retry[locale]}
        </button>
      ) : null}

      {/* Never speaks on its own: the tap is the gesture iOS needs and the courtesy the room needs. */}
      {!failed && answer && onPlay ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <SpeakButton
            label={title}
            speaking={playing}
            unavailable={voiceUnavailable}
            onPlay={onPlay}
            onStop={onStop ?? onPlay}
          />
          {answered ? <span className="text-fine text-muted">{t("aiChip")}</span> : null}
        </div>
      ) : null}

      {refused ? <p className="text-fine text-muted">{LOCAL.fixedText[locale]}</p> : null}

      {sourceOpen && source ? (
        <SourceSheet
          source={source}
          cardTitle={citedCardTitle ?? title}
          onClose={() => setSourceOpen(false)}
        />
      ) : null}
    </section>
  );
}

function Sparkle() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.75 9.4 5.6a1 1 0 0 0 .6.6l3.85 1.4-3.85 1.4a1 1 0 0 0-.6.6L8 13.45 6.6 9.6a1 1 0 0 0-.6-.6L2.15 7.6 6 6.2a1 1 0 0 0 .6-.6L8 1.75Z" />
    </svg>
  );
}

function QuoteGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4.5C4 5.5 3 7.2 3 9.5h2.6V13H2V9.5" />
      <path d="M13 4.5c-2 1-3 2.7-3 5h2.6V13H9V9.5" />
    </svg>
  );
}

/** An open circle with a stroke out of it: "this one is for a person", no medical symbols. */
function PharmacistGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[19px] w-[19px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.5" r=".7" fill="currentColor" />
    </svg>
  );
}

function QuestionGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[19px] w-[19px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.3A2.6 2.6 0 0 1 14.5 10c0 1.7-2.5 2-2.5 3.5" />
      <circle cx="12" cy="17" r=".7" fill="currentColor" />
    </svg>
  );
}

function PhoneGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[17px] w-[17px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1.1 1A16 16 0 0 1 4 5.1 1 1 0 0 1 5 4z" />
    </svg>
  );
}
