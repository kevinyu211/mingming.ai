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
 * S1 on the design canvas: the app mark, the title, one muted line, and the three promises as a
 * grouped card — the same promises the settings screen spells out in full, small enough to read
 * in a taxi before agreeing to anything.
 */
import { useCallback, useSyncExternalStore, type ReactNode, type SVGProps } from "react";
import { useLocale } from "@/components/LocaleProvider";
import type { UiLocale } from "@/lib/i18n/ui";
import { loadState, setConsented, subscribe } from "@/lib/storage/local";

const SESSION_KEY = "fitornot.consent.session";

/** Copy with no key in `lib/i18n/ui.ts`. Same rules as everything there (design.md section 6). */
const LOCAL: Record<"onlyQuestion" | "photoGone", Record<UiLocale, string>> = {
  onlyQuestion: {
    hant: "除咗你問嘅問題，乜都唔會傳出去。",
    hans: "除了你问的问题，什么都不会传出去。",
    en: "Nothing leaves except the question you ask.",
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
      className="fixed inset-x-0 top-0 bottom-[var(--disclaimer-height)] z-50 flex flex-col bg-ground"
    >
      {/* `m-auto` rather than `justify-center`: a centred flex child in a scroll container hides
          its own overflow above the top edge, and this column grows in English. */}
      <div className="flex flex-1 flex-col overflow-y-auto px-8">
        <div className="m-auto flex w-full max-w-md flex-col items-center gap-6 py-4">
          <AppMark />

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

      <div className="shrink-0 px-5 pb-[18px]">
        <button
          type="button"
          onClick={accept}
          className="tap h-[54px] w-full rounded-full bg-accent text-body font-semibold text-accent-ink shadow-raised"
        >
          {t("consent.button")}
        </button>
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

/**
 * The app mark: a speech bubble wrapping a folded page (design.md section 8, artboard 16).
 * Painted from the palette variables rather than literal hex so it follows the tokens.
 */
function AppMark() {
  return (
    <svg viewBox="0 0 120 120" width="104" height="104" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="112" height="112" rx="27" fill="var(--accent)" />
      <path
        d="M28 40c0-5 4-9 9-9h46c5 0 9 4 9 9v33c0 5-4 9-9 9H57l-16 13V82h-4c-5 0-9-4-9-9V40z"
        fill="var(--ground)"
      />
      <path
        d="M50 42h18l8 8v22c0 1.7-1.3 3-3 3H50c-1.7 0-3-1.3-3-3V45c0-1.7 1.3-3 3-3z"
        fill="var(--accent)"
      />
      <path d="M68 42v8h8" fill="var(--warning-fg)" />
      <rect x="53" y="56" width="16" height="3" rx="1.5" fill="var(--ground)" />
      <rect x="53" y="62" width="12" height="3" rx="1.5" fill="var(--ground)" />
      <rect x="53" y="68" width="17" height="3" rx="1.5" fill="var(--warning-fg)" />
    </svg>
  );
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
