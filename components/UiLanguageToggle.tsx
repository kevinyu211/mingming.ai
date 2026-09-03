"use client";

/**
 * The interface language: 繁 / 简 / EN.
 *
 * Not the dialect. The dialect is what the parent hears and it is set once during setup; this
 * only changes what the person holding the phone reads. Picking a Chinese option also converts
 * the card text to that script; picking English leaves the cards in the parent's own script,
 * because those words are the ones being read aloud to them.
 *
 * Styled as an iOS segmented control: a recessed track, a white selected pill, no borders.
 */
import { useLocale } from "@/components/LocaleProvider";
import type { UiLocale } from "@/lib/i18n/ui";

const OPTIONS: { value: UiLocale; label: string; aria: string }[] = [
  { value: "hant", label: "繁", aria: "繁體中文" },
  { value: "hans", label: "简", aria: "简体中文" },
  { value: "en", label: "EN", aria: "English" },
];

export default function UiLanguageToggle({
  size = "compact",
  className = "",
}: {
  /** `compact` for a page header, `full` for a settings row that fills its card. */
  size?: "compact" | "full";
  className?: string;
}) {
  const { locale, setLocale } = useLocale();
  const full = size === "full";

  return (
    <div
      role="group"
      aria-label="Interface language"
      className={`inline-flex items-center rounded-full bg-track p-[3px] ${full ? "w-full" : ""} ${className}`}
    >
      {OPTIONS.map((option) => {
        const active = locale === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setLocale(option.value)}
            aria-label={option.aria}
            aria-pressed={active}
            className={`${full ? "flex-1" : "min-w-[42px]"} h-9 rounded-full text-[15px] transition-colors ${
              active
                ? "bg-card font-semibold text-ink shadow-[0_1px_3px_rgba(31,27,22,0.12)]"
                : "font-medium text-muted"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
