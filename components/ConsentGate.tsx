"use client";

/**
 * The simulated-input notice with one-tap consent (FR-015). It is the first thing in every
 * session, before any health-related input, and it covers the app until the user taps through.
 *
 * "Every session" is deliberate: the tap is recorded in localStorage as `consentedAt` (the
 * data-model's stored state) *and* in sessionStorage, and only the sessionStorage mark
 * dismisses the gate — so a new visit sees the notice again even on a phone that has used the
 * app before. The disclaimer footer sits below the gate and stays visible behind it.
 *
 * Consent is read with `useSyncExternalStore`, so there is no state-setting effect and no
 * chance of rendering a health screen behind the notice on the first paint.
 *
 * S1 on the design canvas: 明明 waving, the title, one muted line, and the three promises as a
 * grouped card — the same promises the settings screen spells out in full, small enough to read
 * in a taxi before agreeing to anything.
 */
import { useCallback, useSyncExternalStore, type ReactNode, type SVGProps } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import type { UiLocale } from "@/lib/i18n/ui";
import { unlockAudio } from "@/lib/speech/tts";
import { loadState, setConsented, subscribe } from "@/lib/storage/local";

const SESSION_KEY = "fitornot.consent.session";

/** Copy with no key in `lib/i18n/ui.ts`. Same rules as everything there (design.md section 6). */
const LOCAL: Record<"onlyQuestion" | "photoGone", Record<UiLocale, string>> = {
  onlyQuestion: {
    hant: "傳出去嘅淨係張紙、你嘅問題同你把聲，用嚟讀同答。唔會有你個名。",
    hans: "传出去的只有那张纸、你的问题和你的声音，用来读和答。不会带上你的名字。",
    en: "Only the sheet, your question and your voice leave, to be read and answered. Never your name.",
  },
  photoGone: {
    hant: "張相讀完就掉咗，唔會留低。",
    hans: "照片读完就丢掉，不会留底。",
    en: "The photo is thrown away once it has been read.",
  },
};

type ConsentState = "unknown" | "given" | "needed";

function readSessionMark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage?.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSessionMark(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(SESSION_KEY, "1");
  } catch {
    // Private mode: the gate simply reappears on the next navigation. Safe direction to fail.
  }
}

function clientSnapshot(): ConsentState {
  return readSessionMark() && loadState().consentedAt !== null ? "given" : "needed";
}

/** On the server nothing is known, so neither the gate nor the app is rendered yet. */
function serverSnapshot(): ConsentState {
  return "unknown";
}

export default function ConsentGate({ children }: { children: ReactNode }) {
  const { locale, t } = useLocale();
  const consent = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  const accept = useCallback(() => {
    /**
     * FIRST, and synchronously, before anything that could yield.
     *
     * iOS only lets an audio element make a sound if a real user gesture touched THAT element, and
     * 明明 speaks with nothing to press — so without this the very first `play()` is refused and
     * every later one is refused identically. This tap is the one gesture that always precedes a
     * reading, so it is where the session's single audio element gets unlocked. Moving this below
     * an `await`, or into a promise continuation, silently breaks it: the gesture only counts on
     * its own tick.
     */
    unlockAudio();
    // Session mark first, so the store notification already sees the final state.
    writeSessionMark();
    setConsented();
  }, []);

  if (consent === "unknown") {
    return <div className="flex-1" aria-hidden="true" />;
  }

  if (consent === "given") return <>{children}</>;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      // `--disclaimer-height` is measured and published by the footer itself, so this stops
      // exactly where the disclaimer starts in every locale (rules.md 16).
      className="fixed inset-x-0 top-0 bottom-[var(--disclaimer-height)] z-50 flex flex-col bg-ground lg:items-center lg:justify-center lg:bg-[color-mix(in_srgb,var(--ink)_28%,transparent)] lg:px-6 lg:py-8"
    >
      {/* `m-auto` rather than `justify-center`: a centred flex child in a scroll container hides
          its own overflow above the top edge, and this column grows in English. */}
      <div className="flex min-h-0 flex-1 flex-col lg:m-0 lg:max-h-full lg:w-full lg:max-w-md lg:flex-none lg:overflow-hidden lg:rounded-[28px] lg:bg-ground lg:shadow-[0_24px_80px_rgb(42_39_35/0.22)]">
        <div className="flex flex-1 flex-col overflow-y-auto px-8 lg:px-12">
          <div className="m-auto flex w-full max-w-md flex-col items-center gap-6 py-4 lg:m-0 lg:max-w-none lg:py-10">
            <span className="companion-plate grid h-[132px] w-[132px] place-items-center rounded-full">
              <Mascot size={92} state="greeting" />
            </span>

            <div className="flex flex-col gap-3 text-center">
              <h1 id="consent-title" className="text-display font-bold text-ink">
                {t("consent.title")}
              </h1>
              <p className="text-body text-muted">{t("consent.body1")}</p>
            </div>

            <div className="surface w-full px-[18px] py-1">
              <PromiseRow glyph={<PhoneGlyph />} text={t("consent.body2")} />
              <Hairline />
              <PromiseRow glyph={<BubbleGlyph />} text={LOCAL.onlyQuestion[locale]} />
              <Hairline />
              <PromiseRow glyph={<NoCameraGlyph />} text={LOCAL.photoGone[locale]} />
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 pb-[18px] lg:px-12 lg:pb-10">
          <button
            type="button"
            onClick={accept}
            className="tap h-[54px] w-full rounded-full bg-accent text-body font-semibold text-accent-ink shadow-raised"
          >
            {t("consent.button")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromiseRow({ glyph, text }: { glyph: ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-[14px] py-3">
      <span className="mt-0.5 shrink-0 text-accent">{glyph}</span>
      <span className="text-body leading-relaxed text-ink">{text}</span>
    </div>
  );
}

function Hairline() {
  return <div aria-hidden="true" className="h-px bg-hairline" />;
}

/** design.md section 3: rounded, 2 px stroke, no medical symbols. */
function glyphProps(): SVGProps<SVGSVGElement> {
  return {
    viewBox: "0 0 24 24",
    width: 22,
    height: 22,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: false,
  };
}

function PhoneGlyph() {
  return (
    <svg {...glyphProps()}>
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <path d="M10 18h4" />
    </svg>
  );
}

function BubbleGlyph() {
  return (
    <svg {...glyphProps()}>
      <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-5l-4.5 4v-4H7a3 3 0 0 1-3-3V7z" />
    </svg>
  );
}

function NoCameraGlyph() {
  return (
    <svg {...glyphProps()}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
