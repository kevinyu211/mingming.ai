"use client";

/**
 * An explicit language choice, available before consent and on the home screen.
 * Keep the existing voice/interface pairing and remember both on this device.
 */
import { useLocale } from "@/components/LocaleProvider";
import type { Dialect } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";

const LANGUAGES: { locale: UiLocale; dialect: Dialect; label: string; lang: string }[] = [
  { locale: "hant", dialect: "yue", label: "繁體中文", lang: "zh-Hant" },
  { locale: "hans", dialect: "cmn", label: "简体中文", lang: "zh-Hans" },
  { locale: "en", dialect: "en", label: "English", lang: "en" },
];

export default function LanguagePill({ dark = false }: { dark?: boolean }) {
  const { locale, setDialect, setLocale, t } = useLocale();

  return (
    <div className="relative shrink-0">
      <select
        value={locale}
        onChange={(event) => {
          const next = LANGUAGES.find((language) => language.locale === event.target.value);
          if (!next) return;
          setDialect(next.dialect);
          setLocale(next.locale);
        }}
        aria-label={t("companion.language")}
        className={`pill min-h-11 cursor-pointer appearance-none !pr-8 ${dark ? "pill-dark" : ""}`}
      >
        {LANGUAGES.map((language) => (
          <option key={language.locale} value={language.locale} lang={language.lang}>
            {language.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[10px] ${dark ? "opacity-60" : "text-faint"}`}
      >
        ⌄
      </span>
    </div>
  );
}
