"use client";

/**
 * S7 screen 1 — the chip group that answers 你煮飯畀邊個？
 *
 * The whole point of this component is what it does NOT ask for. FR-016 allows a relationship
 * label and nothing else, so the five suggestions are relationships, the free-text field is
 * capped at 12 characters (data-model.md, Profile.label), and neither the placeholder nor the
 * hint contains the word "name" in any locale — a field that says "name" is a field that gets a
 * name typed into it, and then the app is holding an identifier it promised never to hold.
 *
 * The label never leaves the phone: it is saved by the setup page and used only for the header
 * line and the spoken form of address (constitution principle V).
 *
 * Design canvas S7: a two-column grid of white tiles, the chosen one filled teal, and "other" as
 * a full-width outlined tile. The action that submits the free text is the page's own bottom
 * capsule, so the thumb never has to travel — `onDraftChange` is how it hears what was typed.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import type { UiKey } from "@/lib/i18n/ui";

/** data-model.md: `label` is a string of at most 12 characters. */
export const MAX_LABEL_LENGTH = 12;

/** design.md S7: 阿媽 · 阿爸 · 老豆 · 家婆 · 其他. */
const SUGGESTIONS: readonly UiKey[] = [
  "setup.chip.mother",
  "setup.chip.father",
  "setup.chip.dad",
  "setup.chip.motherInLaw",
];

export interface LabelChipsProps {
  /** Fires with the chosen label, trimmed and capped. Never fires with an empty string. */
  onPick: (label: string) => void;
  /** A label already chosen, so coming back to this screen shows it selected. */
  value?: string;
  /**
   * The word currently typed into "other", trimmed and capped, or "" when that field is closed
   * or blank. The setup page uses it so one bottom capsule can submit either kind of answer.
   */
  onDraftChange?: (draft: string) => void;
}

export default function LabelChips({ onPick, value = "", onDraftChange }: LabelChipsProps) {
  const { t } = useLocale();
  const [otherOpen, setOtherOpen] = useState(false);
  const [other, setOther] = useState("");

  const suggestions = SUGGESTIONS.map((key) => t(key));
  const trimmed = other.trim().slice(0, MAX_LABEL_LENGTH);
  const draft = otherOpen ? trimmed : "";

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const submitOther = useCallback(() => {
    if (trimmed.length === 0) return;
    onPick(trimmed);
  }, [onPick, trimmed]);

  return (
    <div className="mt-7">
      <ul className="grid grid-cols-2 gap-3" role="list">
        {suggestions.map((label) => {
          const selected = value === label;
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => onPick(label)}
                aria-pressed={selected}
                className={`tap h-[58px] w-full rounded-card px-2 text-center text-med leading-tight font-semibold ${
                  selected
                    ? "bg-accent text-accent-ink shadow-raised"
                    : "surface text-ink"
                }`}
              >
                {label}
              </button>
            </li>
          );
        })}
        <li className="col-span-2">
          <button
            type="button"
            onClick={() => setOtherOpen((open) => !open)}
            aria-expanded={otherOpen}
            className={`tap h-[58px] w-full rounded-card border-[1.5px] px-2 text-center text-med leading-tight font-medium ${
              otherOpen ? "border-accent text-accent" : "border-card-border text-muted"
            }`}
          >
            {t("setup.chip.other")}
          </button>
        </li>
      </ul>

      {otherOpen ? (
        <div className="surface mt-3 p-3.5">
          {/* The placeholder carries the same words on screen, so this is for the screen reader
              only rather than the same sentence printed twice. */}
          <label htmlFor="setup-other" className="sr-only">
            {t("setup.otherPlaceholder")}
          </label>
          <input
            id="setup-other"
            type="text"
            inputMode="text"
            autoComplete="off"
            // Not `name`, not `nickname`: nothing here may invite the browser to autofill a
            // person's name into a field the app has promised is only a relationship word.
            maxLength={MAX_LABEL_LENGTH}
            value={other}
            onChange={(event) => setOther(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitOther();
              }
            }}
            placeholder={t("setup.otherPlaceholder")}
            className="h-[54px] w-full rounded-card bg-panel px-4 text-body text-ink"
          />
        </div>
      ) : null}
    </div>
  );
}
