"use client";

/**
 * S9 Settings — where the privacy promise is written out in full and where it can be kept.
 *
 * Four things, in this order:
 *   1. the data statement, verbatim from `lib/i18n/data-statement.ts` — the same words that go
 *      into the submission, so the app and the paperwork cannot drift (research.md R13);
 *   2. the agent-limits block (FR-022);
 *   3. the interface language, 繁 / 简 / EN, which is the one setting there is;
 *   4. 刪除所有資料 behind a confirm sheet (FR-017).
 *
 * Delete really deletes. `deleteEverything()` removes the single localStorage key; this screen
 * then clears sessionStorage (the consent mark and any page bytes `Capture` left mid-navigation)
 * and drops the in-memory audio cache, so nothing about the sheet survives anywhere in the tab.
 * The redirect lands on 記錄, which shows the consent notice again over an empty 記錄 — the same
 * state a phone that has never seen this app is in.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import AgentLimits from "@/components/AgentLimits";
import ConfirmSheet from "@/components/ConfirmSheet";
import { useLocale } from "@/components/LocaleProvider";
import UiLanguageToggle from "@/components/UiLanguageToggle";
import { dataStatementLines } from "@/lib/i18n/data-statement";
import type { UiLocale } from "@/lib/i18n/ui";
import { resetSpeechSession } from "@/lib/speech/tts";
import { deleteEverything } from "@/lib/storage/local";

/** Copy with no key in `lib/i18n/ui.ts`. Same rules as everything there (design.md section 6). */
const LOCAL: Record<"back" | "language", Record<UiLocale, string>> = {
  back: { hant: "返去", hans: "返回", en: "Back" },
  language: { hant: "語言", hans: "语言", en: "Language" },
};

export default function SettingsPage() {
  const router = useRouter();
  const { locale, t } = useLocale();
  const [confirming, setConfirming] = useState(false);

  const remove = useCallback(() => {
    deleteEverything();
    // The consent mark and any pages Capture left behind live in sessionStorage, which
    // `deleteEverything` cannot see. This origin is the app and nothing else, so clearing it
    // whole is both correct and provable — the point of the button is that nothing is left.
    try {
      window.sessionStorage.clear();
    } catch {
      // Private mode: nothing was ever written there.
    }
    // Audio of the sheet is cached in memory for the session. It goes too.
    resetSpeechSession();
    setConfirming(false);
    router.replace("/");
  }, [router]);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-5 pt-3 pb-4">
      <header className="flex min-h-12 items-center justify-between gap-3">
        <h1 className="min-w-0 text-display font-bold text-ink">{t("settings.title")}</h1>
        <Link
          href="/"
          className="tap shrink-0 gap-1 rounded-full px-1 text-meta font-semibold text-accent"
        >
          <ChevronLeft />
          {LOCAL.back[locale]}
        </Link>
      </header>

      <div className="mt-5 flex flex-col gap-6">
        <section aria-labelledby="data-statement-heading">
          <h2 id="data-statement-heading" className="mb-2 ml-1 text-fine font-semibold text-muted">
            {t("settings.dataStatement")}
          </h2>
          <div className="surface flex flex-col gap-3 p-[18px]">
            {dataStatementLines(locale).map((line) => (
              <p key={line} className="text-body leading-relaxed text-ink">
                {line}
              </p>
            ))}
          </div>
        </section>

        <AgentLimits />

        <section aria-labelledby="ui-language-heading">
          <h2 id="ui-language-heading" className="mb-2 ml-1 text-fine font-semibold text-muted">
            {LOCAL.language[locale]}
          </h2>
          <div className="surface p-3">
            {/* The control's own segments are 36 px; design.md section 7 wants 48, no exceptions. */}
            <UiLanguageToggle size="full" className="[&_button]:h-12" />
          </div>
        </section>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-haspopup="dialog"
          className="surface tap h-[58px] w-full text-body font-semibold text-danger"
        >
          {t("settings.delete")}
        </button>
      </div>

      {confirming ? (
        <ConfirmSheet
          title={t("settings.deleteConfirmTitle")}
          body={t("settings.deleteConfirmBody")}
          confirmLabel={t("settings.deleteConfirm")}
          cancelLabel={t("settings.cancel")}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </main>
  );
}

function ChevronLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[18px] w-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 6l-6 6 6 6" />
    </svg>
  );
}
