"use client";

/**
 * The three-way input-language toggle on the ask screen: 廣東話 / 普通話 / English.
 *
 * This chooses the language the QUESTION is asked in, not the one the answer comes back in
 * (FR-012: the answer is always in the parent's dialect, whatever the question was asked in).
 * The label above it says so, and the component never touches the dialect.
 *
 * Radio semantics rather than three buttons, so a screen reader announces "1 of 3" and the
 * arrow keys move between the tiles the way a native radio group does.
 *
 * Visually it is an iOS segmented control (design canvas, S6): one warm track, a white pill on the
 * chosen segment. The segments are 32 px tall so the composer panel above the mic stays quiet, and
 * each one carries an invisible ::after that stretches the hit area to 48 px — the tap target rule
 * is about the finger, not about the paint. The group's own label is kept for assistive tech and
 * taken off the screen: the three words say what the control is.
 */
import { useRef } from "react";
import { useT } from "@/components/LocaleProvider";
import type { InputLanguage } from "@/lib/domain/schemas";
import type { UiKey } from "@/lib/i18n/ui";

const OPTIONS: readonly { value: InputLanguage; key: UiKey }[] = [
  { value: "yue", key: "language.yue" },
  { value: "cmn", key: "language.cmn" },
  { value: "en", key: "language.en" },
];

export default function LanguageToggle({
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  value: InputLanguage;
  onChange: (language: InputLanguage) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, step: number) => {
    const next = (from + step + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className={className}>
      <p id="ask-input-language" className="sr-only">
        {t("ask.inputLanguage")}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="ask-input-language"
        className="mx-auto flex w-fit max-w-full items-center rounded-full bg-track p-[3px]"
      >
        {OPTIONS.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              // Only the selected tile is in the tab order; the arrow keys move within the group.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  move(index, -1);
                }
              }}
              // The ::after is the 48 px hit area around a 32 px pill: it has no paint of its
              // own, so the control stays the size the canvas drew and the finger still lands.
              className={`relative inline-flex h-8 min-w-[76px] shrink items-center justify-center rounded-full px-3 text-[14px] whitespace-nowrap transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] disabled:opacity-50 ${
                selected
                  ? "bg-card font-semibold text-ink shadow-[0_1px_3px_rgba(31,27,22,0.12)]"
                  : "font-medium text-muted"
              }`}
            >
              {t(option.key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
