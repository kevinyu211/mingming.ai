"use client";

/**
 * The amber block: what the page says means "go back to hospital now".
 *
 * It renders and reads itself the moment the briefing starts, before anything else 明仔 says, and
 * it is never behind a tap — constitution II is implemented as position and as autoplay, not as a
 * recommendation. Its order comes from `buildCards`; nothing on this screen can reorder it.
 *
 * When the page printed no warning signs at all, the `noWarnings` card takes this same slot and
 * says so. It is drawn on the quiet fill rather than in amber: dressing "this page printed none"
 * as an alarm would be inventing a warning, which is the one thing the slot exists to prevent.
 *
 * Every row carries its own 睇張紙點寫 link (constitution IV). The link is `--warn-ink` on the
 * amber, 7.17:1 — the jade would drop to about 4.4:1 on this fill and this is the block that has
 * to be readable without glasses.
 */
import { useT } from "@/components/LocaleProvider";
import Waveform from "@/components/chat/Waveform";
import type { Card, SourceReference } from "@/lib/domain/schemas";

export interface WarningBlockProps {
  /** The `warning` cards, or the single `noWarnings` card that takes the slot. */
  cards: Card[];
  /** Body text per card, already in the reader's script. Same length and order as `cards`. */
  lines: string[];
  /** True when the slot is filled by `noWarnings`. */
  empty: boolean;
  /** Audio for this block is playing right now. Status only. */
  reading: boolean;
  onOpenSource: (source: SourceReference, card: Card) => void;
}

export default function WarningBlock({
  cards,
  lines,
  empty,
  reading,
  onOpenSource,
}: WarningBlockProps) {
  const t = useT();
  if (cards.length === 0) return null;

  const amber = !empty;

  return (
    <section
      aria-label={amber ? t("brief.warnTitle") : t("card.noWarnings")}
      className={`animate-rise mb-[22px] rounded-[22px] p-[22px_20px] ${amber ? "bg-warn-bg" : "bg-soft"}`}
    >
      <div className="mb-4 flex items-center gap-[11px]">
        {amber ? <WarningMark /> : null}
        <h2
          className={`flex-1 text-[23px] leading-[1.3] font-bold ${amber ? "text-warn-ink" : "text-ink"}`}
        >
          {amber ? t("brief.warnTitle") : t("card.noWarnings")}
        </h2>
      </div>

      <ul className="flex flex-col gap-[13px]">
        {cards.map((card, i) => (
          <li key={card.id} className="flex items-start gap-3">
            {amber ? (
              <span
                aria-hidden="true"
                className="mt-[9px] block h-2 w-2 shrink-0 rounded-full bg-warn-dot"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p
                className={`text-[22px] leading-[1.45] font-medium break-words ${amber ? "text-warn-ink" : "text-ink"}`}
              >
                {lines[i]}
              </p>
              {card.source ? (
                <button
                  type="button"
                  onClick={() => card.source && onOpenSource(card.source, card)}
                  className={`mt-1.5 min-h-11 text-meta font-semibold underline underline-offset-4 ${amber ? "text-warn-ink" : "text-jade-ink"}`}
                >
                  {t("card.sourceLink")}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {reading ? (
        <p className="mt-4 flex items-center gap-[9px] text-meta font-medium text-warn-ink">
          <Waveform tone={amber ? "warn" : "jade"} />
          {t("chat.readingThis")}
        </p>
      ) : null}
    </section>
  );
}

function WarningMark() {
  return (
    <svg
      viewBox="0 0 21 19"
      aria-hidden="true"
      focusable="false"
      className="h-6 w-[26px] shrink-0"
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
