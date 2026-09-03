"use client";

/**
 * S4 — one card of a reading.
 *
 * Two shapes, from the design canvas:
 *
 *   **A card of its own** — the warning card (amber, its own 警號 header row and a position
 *   indicator), the "no warnings printed" card that takes the same slot, and the unreadable
 *   card, which stays dotted because an honest state is designed, not apologised for.
 *
 *   **A row in a grouped list** — medicines, follow-up, diet, activity and referral. These sit
 *   inside one white surface owned by `components/CardStack.tsx`, separated by an inset hairline,
 *   iOS grouped-list style. The row leads with the printed facts (the medicine's name, the
 *   clinic) rather than repeating the group's own heading, so the heading is carried by the small
 *   section label above the group and stays on the card for screen readers only.
 *
 * Card anatomy is otherwise unchanged, in order down the card: the type heading, the lead facts,
 * the body, the AI chip when the body was written by the model, the play button and the "from the
 * page" link. Nothing is optional except the AI chip and the source link, and the source link is
 * only absent on the two rule-generated cards that quote nothing.
 *
 * Script handling: the card carries both written forms. `body[dialect]` is what the voice will
 * say, so that is what is shown; `toScript` runs over it **only** when the reader has flipped the
 * script toggle away from the dialect's own written form. Printed facts (a medicine's name,
 * strength, amount, frequency) and the source quote are verbatim page text and are never
 * converted — FR-003 says exactly, and exactly means exactly.
 */
import { useCallback, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import AiLabel from "@/components/AiLabel";
import SourceSheet from "@/components/SourceSheet";
import SpeakButton from "@/components/SpeakButton";
import type { Card as CardModel, CardType } from "@/lib/domain/schemas";
import { langForScript, scriptForDialect, toScript } from "@/lib/i18n/script";
import { cardTitle } from "@/lib/rules/card-order";

export interface CardProps {
  card: CardModel;
  speaking: boolean;
  unavailable: boolean;
  onPlay: () => void;
  onStop: () => void;
  /** Position in the stack, for the 120 ms staggered arrival. */
  index?: number;
  /** Presentational: this card's place among its own kind, for the warning card's "1 / 3". */
  groupIndex?: number;
  /** Presentational: how many cards of this kind there are. */
  groupCount?: number;
}

/**
 * The card types that become rows inside one shared surface. `CardStack` groups them and draws
 * the hairlines; a row therefore paints no ground and no radius of its own.
 */
const GROUPED: ReadonlySet<CardType> = new Set<CardType>([
  "medicine",
  "followUp",
  "diet",
  "activity",
  "referral",
]);

export function isGroupedType(type: CardType): boolean {
  return GROUPED.has(type);
}

/** Container styling per card type (design.md section 3). Colour is never the only signal. */
function shell(type: CardType): string {
  switch (type) {
    case "warning":
      return "rounded-card bg-warning-bg p-[18px] shadow-card";
    case "noWarnings":
      // The warning slot's shape, so it reads as "this is where the red flags would be",
      // with none of the amber, because there is nothing to be alarmed about.
      return "rounded-card bg-soft p-[18px]";
    case "unreadable":
      return "rounded-card border-2 border-dashed border-card-border bg-soft p-[18px]";
    default:
      return "px-[18px] py-4";
  }
}

function bodyTone(type: CardType): string {
  if (type === "warning") return "text-[24px] leading-[1.4] font-bold tracking-[-0.3px] text-ink";
  if (type === "unreadable") return "text-body text-muted";
  return "text-body text-ink";
}

interface Lead {
  /** The printed name that titles the row: a medicine, a clinic. */
  primary: string;
  /** The line under it: how often, what to bring. */
  secondary: string | null;
  /** Right-aligned: strength and amount, or when. */
  trailing: string | null;
}

/** Trims a fact and drops the empties, so a null field never prints as a blank line. */
function fact(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export default function Card({
  card,
  speaking,
  unavailable,
  onPlay,
  onStop,
  index = 0,
  groupIndex = 0,
  groupCount = 1,
}: CardProps) {
  const { dialect, script, t } = useLocale();
  const [sourceOpen, setSourceOpen] = useState(false);

  const openSource = useCallback(() => setSourceOpen(true), []);
  const closeSource = useCallback(() => setSourceOpen(false), []);

  const title = cardTitle(card.type, script);
  const spoken = card.body[dialect];
  const body = script === scriptForDialect(dialect) ? spoken : toScript(spoken, script);
  const headingId = `card-${card.id}-title`;

  const facts = card.facts ?? {};
  const isWarning = card.type === "warning";
  const grouped = isGroupedType(card.type);

  let lead: Lead | null = null;
  if (card.type === "medicine") {
    lead = {
      primary: fact(facts.name) ?? title,
      // The frequency is the line under the name; when the page did not print one, the honest
      // note takes its place rather than leaving a gap (FR-003).
      secondary: fact(facts.frequency) ?? t("card.missingFrequency"),
      trailing: [fact(facts.strength), fact(facts.amount)].filter(Boolean).join(" · ") || null,
    };
  } else if (card.type === "followUp") {
    lead = {
      primary: fact(facts.clinic) ?? title,
      secondary: fact(facts.tests),
      trailing: fact(facts.when),
    };
  }

  return (
    <article
      aria-labelledby={headingId}
      lang={langForScript(script)}
      style={{ animationDelay: `${Math.min(index, 8) * 120}ms` }}
      className={`card-rise ${shell(card.type)}`}
    >
      {isWarning ? (
        <div className="flex items-center gap-2">
          <AlertGlyph />
          <h2 id={headingId} className="text-fine font-bold tracking-[0.2px] text-warning-fg">
            {title}
          </h2>
          <span className="flex-1" />
          {groupCount > 1 ? (
            // The canvas dims this to 75%, but amber on amber is already only 4:1 and the
            // bystander is 72; weight carries the de-emphasis instead of opacity.
            <span aria-hidden="true" className="text-fine font-normal text-warning-fg">
              {groupIndex + 1} / {groupCount}
            </span>
          ) : null}
        </div>
      ) : null}

      {lead ? (
        <>
          {/* The heading stays for the card's accessible name; the printed fact titles the row. */}
          <h2 id={headingId} className="sr-only">
            {title}
          </h2>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <p className="dose text-[19px] font-semibold break-words text-ink">{lead.primary}</p>
              {lead.secondary ? (
                <p className="text-meta break-words text-muted">{lead.secondary}</p>
              ) : null}
            </div>
            {lead.trailing ? (
              <p className="dose max-w-[46%] shrink-0 text-right text-[17px] text-muted">
                {lead.trailing}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {!isWarning && !lead ? (
        <h2
          id={headingId}
          className={`${grouped ? "text-[19px]" : "text-card-title"} font-bold ${
            card.type === "unreadable" ? "text-muted" : "text-ink"
          }`}
        >
          {card.type === "unreadable" ? (
            <span aria-hidden="true" className="mr-2">
              ?
            </span>
          ) : null}
          {title}
        </h2>
      ) : null}

      <p className={`mt-3 ${bodyTone(card.type)}`}>{body}</p>

      {card.aiGenerated ? <AiLabel className="mt-2" /> : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SpeakButton
          label={title}
          speaking={speaking}
          unavailable={unavailable}
          onPlay={onPlay}
          onStop={onStop}
          tone={isWarning ? "warning" : "accent"}
        />
        {card.source ? (
          <button
            type="button"
            onClick={openSource}
            aria-haspopup="dialog"
            aria-label={`${t("card.sourceLink")}：${title}`}
            className={`tap gap-1.5 rounded-full px-1 text-meta font-semibold underline underline-offset-4 ${
              isWarning ? "text-warning-fg" : "text-accent"
            }`}
          >
            <QuoteMark />
            {t("card.sourceLink")}
          </button>
        ) : null}
      </div>

      {isWarning && groupCount > 1 ? (
        // Which of the warnings this is, said a second way: the amber index above is a number,
        // this is its shape. Colour is never the only signal (design.md 7).
        <div aria-hidden="true" className="mt-3 flex gap-1.5">
          {Array.from({ length: groupCount }, (_, i) => (
            <span
              key={i}
              className={`h-[3px] w-[22px] rounded-[2px] bg-warning-fg ${
                i === groupIndex ? "" : "opacity-25"
              }`}
            />
          ))}
        </div>
      ) : null}

      {sourceOpen && card.source ? (
        <SourceSheet source={card.source} cardTitle={title} onClose={closeSource} />
      ) : null}
    </article>
  );
}

/** The warning card's mark: a circle with an exclamation, two strokes, no medical symbols. */
function AlertGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5 shrink-0 text-warning-fg"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8v5" />
      <circle cx="12" cy="16.5" r=".6" fill="currentColor" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function QuoteMark() {
  return (
    <svg
      viewBox="0 0 24 16"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 13c0-5 2-8.5 6-10M11 13c0-5 2-8.5 6-10" />
    </svg>
  );
}
