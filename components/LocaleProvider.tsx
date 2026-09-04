"use client";

/**
 * Three settings live here, and they are deliberately not the same thing:
 *
 *   dialect  — which voice speaks to the parent (Cantonese or Mandarin). Never changed by the
 *              interface language: the parent's language is the parent's.
 *   script   — which written form the CARD text is converted to. Follows the interface language
 *              when that is Chinese; left alone when the interface is English, because the cards
 *              are what gets read aloud to the parent.
 *   locale   — the language of the interface itself: traditional, simplified, or English.
 *
 * All three are remembered on the device. `locale` sits at the top level of storage rather than on
 * the profile, so someone can switch the interface to English before they have set a profile up.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Dialect } from "@/lib/domain/schemas";
import { scriptForDialect } from "@/lib/i18n/script";
import { t, type UiKey, type UiLocale } from "@/lib/i18n/ui";
import {
  loadState,
  saveProfile,
  saveUiLocale,
  subscribe,
  type Profile,
  type Script,
} from "@/lib/storage/local";

const DEFAULT_DIALECT: Dialect = "yue";

/** The interface language a Chinese script implies, and vice versa. */
function scriptForLocale(locale: UiLocale, fallback: Script): Script {
  if (locale === "hant") return "hant";
  if (locale === "hans") return "hans";
  return fallback;
}

export interface LocaleContextValue {
  dialect: Dialect;
  script: Script;
  /** The interface language: traditional Chinese, simplified Chinese, or English. */
  locale: UiLocale;
  /** False during the first client render, before the stored preferences have been read. */
  hydrated: boolean;
  setDialect: (dialect: Dialect) => void;
  setScript: (script: Script) => void;
  /** Sets the interface language, and the card script with it when the language is Chinese. */
  setLocale: (locale: UiLocale) => void;
  t: (key: UiKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Writes a language choice to the profile, creating one if there is none.
 *
 * These setters used to write only `if (profile)`, which was safe while `/setup` ran before
 * anything else and every user therefore had a profile. In v2, 記錄 is the entry screen and
 * `/setup` is never visited, so a fresh phone has no profile — and every language change was held
 * in React state alone and lost on the next reload. Someone switching the app to English watched
 * it revert to Cantonese the moment they navigated.
 *
 * The label stays empty. It is a relationship word (阿媽, 老豆), never a name, and nothing may
 * invent one on the user's behalf — `lib/storage/local.ts` documents it as never a person's name,
 * and an empty string is honestly "not set".
 */
function persist(patch: Partial<Pick<Profile, "dialect" | "script">>): void {
  const profile = loadState().profile;
  saveProfile({
    label: profile?.label ?? "",
    dialect: profile?.dialect ?? DEFAULT_DIALECT,
    script: profile?.script ?? scriptForDialect(DEFAULT_DIALECT),
    ...patch,
  });
}

export function LocaleProvider({
  children,
  defaultDialect = DEFAULT_DIALECT,
}: {
  children: ReactNode;
  defaultDialect?: Dialect;
}) {
  const [dialect, setDialectState] = useState<Dialect>(defaultDialect);
  const [script, setScriptState] = useState<Script>(scriptForDialect(defaultDialect));
  const [locale, setLocaleState] = useState<UiLocale>(scriptForDialect(defaultDialect));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const apply = () => {
      const state = loadState();
      const profile = state.profile;
      if (profile) {
        setDialectState(profile.dialect);
        setScriptState(profile.script);
      }
      // An explicit choice wins; otherwise the interface follows the card script.
      const stored = state.uiLocale;
      setLocaleState(stored ?? profile?.script ?? scriptForDialect(defaultDialect));
      setHydrated(true);
    };
    apply();
    return subscribe(apply);
  }, [defaultDialect]);

  const setDialect = useCallback((next: Dialect) => {
    setDialectState(next);
    // English is not a written form of Chinese, so choosing it as the SPOKEN language must leave
    // the card script alone. `scriptForDialect` is a yue/else binary and answers "hans" for "en" —
    // which would quietly turn a Cantonese-reading family's traditional cards into simplified the
    // moment they asked 明仔 to speak English. Harmless while it was held in memory; not once the
    // choice is persisted.
    if (next === "en") {
      persist({ dialect: next });
      return;
    }
    const nextScript = scriptForDialect(next);
    setScriptState(nextScript);
    persist({ dialect: next, script: nextScript });
  }, []);

  const setScript = useCallback((next: Script) => {
    setScriptState(next);
    persist({ script: next });
  }, []);

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    saveUiLocale(next);
    setScriptState((current) => {
      const nextScript = scriptForLocale(next, current);
      if (nextScript !== current) persist({ script: nextScript });
      return nextScript;
    });
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      dialect,
      script,
      locale,
      hydrated,
      setDialect,
      setScript,
      setLocale,
      t: (key: UiKey) => t(locale, key),
    }),
    [dialect, script, locale, hydrated, setDialect, setScript, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside <LocaleProvider>");
  return value;
}

/** `const tr = useT(); tr("cards.playAll")` — the common case, without the whole context. */
export function useT(): (key: UiKey) => string {
  return useLocale().t;
}

export { t };
