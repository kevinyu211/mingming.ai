"use client";

/**
 * S7 Setup — the two screens that make the app personal without making it identifying.
 *
 * One route, one step counter, because "under 30 seconds" (SC-008) means the second question is
 * already on screen by the time the thumb lifts off the first. Screen 1 asks who you cook for,
 * screen 2 asks what they listen in, and tapping a tile is also the save: there is no separate
 * confirm button to hunt for. The bottom capsule exists for the one answer a tap cannot give —
 * a word typed into "other" — and for walking forward again after stepping back.
 *
 * Nothing is written until that last tap, and what is written is exactly three fields —
 * `{ label, dialect, script }` (FR-016). No name, no age, no diagnosis, no anything else; the
 * `Profile` type has nowhere to put them. The privacy line is on both screens, verbatim from
 * design.md S7, because acceptance scenario 5 of Story 2 says it must be visible on any setup
 * screen, not just the first.
 *
 * The interface-language control sits in the top right of screen one on purpose: someone who
 * cannot read traditional characters must be able to switch before answering anything.
 *
 * `saveProfile` notifies `LocaleProvider` through the storage subscription, so the dialect and
 * script are live before the redirect lands on the capture screen.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import LabelChips from "@/components/LabelChips";
import { useLocale } from "@/components/LocaleProvider";
import UiLanguageToggle from "@/components/UiLanguageToggle";
import type { Dialect } from "@/lib/domain/schemas";
import { scriptForDialect } from "@/lib/i18n/script";
import type { UiLocale } from "@/lib/i18n/ui";
import { loadState, saveProfile } from "@/lib/storage/local";

/** Copy with no key in `lib/i18n/ui.ts`. Same rules as everything there (design.md section 6). */
const LOCAL: Record<"back", Record<UiLocale, string>> = {
  back: { hant: "返上一步", hans: "回上一步", en: "Back a step" },
};

type Step = 1 | 2;

export default function SetupPage() {
  const router = useRouter();
  const { script, locale, t } = useLocale();

  const [step, setStep] = useState<Step>(1);
  // Seeded from an existing profile so re-running setup is a correction, not a reset.
  const [label, setLabel] = useState(() => loadState().profile?.label ?? "");
  /** The word being typed into "other", reported up by `LabelChips`. */
  const [draft, setDraft] = useState("");

  const pickLabel = useCallback((next: string) => {
    setLabel(next);
    setStep(2);
  }, []);

  const finish = useCallback(
    (dialect: Dialect) => {
      // The dialect decides the written form unless the reader has already said otherwise.
      // Choosing 繁 or 简 for the interface IS saying otherwise; choosing EN is not, because the
      // cards are what gets read aloud to the parent and they stay in the parent's own script.
      const chosenLocale = loadState().uiLocale;
      const explicitScript = chosenLocale === "hant" || chosenLocale === "hans";
      const chosen = explicitScript ? script : scriptForDialect(dialect);
      saveProfile({ label, dialect, script: chosen });
      // `replace`, not `push`: setup is done and the back button should not walk into it again.
      router.replace("/");
    },
    [label, router, script],
  );

  /** Whatever the bottom capsule would submit: the typed word first, then the chosen tile. */
  const pending = draft || label;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-3 pb-4">
      <header className="flex min-h-12 items-center justify-between gap-3">
        {step === 2 ? (
          <button
            type="button"
            onClick={() => setStep(1)}
            className="tap -ml-1 gap-1 rounded-full px-1 text-meta font-semibold text-accent"
          >
            <ChevronLeft />
            {LOCAL.back[locale]}
          </button>
        ) : (
          <Link
            href="/settings"
            className="tap -ml-1 rounded-full px-1 text-meta font-semibold text-accent"
          >
            {t("settings.title")}
          </Link>
        )}
        {step === 1 ? (
          // The component's own segments are 36 px; design.md section 7 wants 48, no exceptions.
          <UiLanguageToggle className="[&_button]:h-12 [&_button]:min-w-12" />
        ) : null}
      </header>

      {/* Two steps, two bars. Decorative: the question itself says where you are. */}
      <div aria-hidden="true" className="mt-3 flex items-center gap-2.5">
        <span className="h-1 flex-1 rounded-full bg-accent" />
        <span className={`h-1 flex-1 rounded-full ${step === 2 ? "bg-accent" : "bg-card-border"}`} />
      </div>

      <div className="flex flex-1 flex-col pt-9">
        {step === 1 ? (
          <section aria-labelledby="setup-label-heading">
            <h1 id="setup-label-heading" className="text-display font-bold text-ink">
              {t("setup.labelQuestion")}
            </h1>
            <p className="mt-2.5 text-meta text-muted">{t("setup.labelHint")}</p>
            <LabelChips onPick={pickLabel} value={label} onDraftChange={setDraft} />
          </section>
        ) : (
          <section aria-labelledby="setup-dialect-heading">
            <h1 id="setup-dialect-heading" className="text-display font-bold text-ink">
              {t("setup.dialectQuestion")}
            </h1>

            <div className="mt-7 grid grid-cols-2 gap-3">
              {(["yue", "cmn"] as const).map((dialect) => (
                <button
                  key={dialect}
                  type="button"
                  onClick={() => finish(dialect)}
                  className="surface tap h-[76px] w-full px-2 text-center text-med leading-tight font-semibold text-ink"
                >
                  {t(dialect === "yue" ? "language.yue" : "language.cmn")}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="flex flex-col gap-3.5 pt-6">
        {/* Story 2, acceptance scenario 5: visible on ANY setup screen, not only the first. */}
        <p className="px-1 text-fine leading-normal text-muted">{t("setup.privacy")}</p>
        {step === 1 ? (
          <button
            type="button"
            onClick={() => pickLabel(pending)}
            disabled={pending.length === 0}
            className="tap h-[54px] w-full gap-2 rounded-full bg-accent text-body font-semibold text-accent-ink shadow-raised disabled:opacity-40 disabled:shadow-none"
          >
            {t("setup.next")}
            <ChevronRight />
          </button>
        ) : null}
      </div>
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

function ChevronRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 6l6 6-6 6" />
    </svg>
  );
}
