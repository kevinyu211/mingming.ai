"use client";

/**
 * The language pill in the header: one tap cycles 廣東話 → 普通話 → English.
 *
 * It changes the SPOKEN language and the interface language together, exactly as the chip in the
 * chat header does — dialect first, then locale, so the card script follows the dialect and the
 * interface follows what was actually picked. Both persist on the device (`LocaleProvider`).
 */
import { useLocale } from "@/components/LocaleProvider";
import type { Dialect } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";

const ORDER: Dialect[] = ["yue", "cmn", "en"];
const LOCALE_FOR: Record<Dialect, UiLocale> = { yue: "hant", cmn: "hans", en: "en" };
const LABEL: Record<Dialect, "language.yue" | "language.cmn" | "language.en"> = {
  yue: "language.yue",
  cmn: "language.cmn",
  en: "language.en",
};

export default function LanguagePill({ dark = false }: { dark?: boolean }) {
  const { dialect, setDialect, setLocale, t } = useLocale();

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(dialect) + 1) % ORDER.length];
    setDialect(next);
    setLocale(LOCALE_FOR[next]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={t("companion.language")}
      className={`pill min-h-9 ${dark ? "pill-dark" : ""}`}
    >
      {t(LABEL[dialect])}
      <span aria-hidden="true" className={`text-[10px] ${dark ? "opacity-60" : "text-faint"}`}>
        ⌄
      </span>
    </button>
  );
}
