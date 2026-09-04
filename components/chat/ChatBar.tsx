"use client";

/**
 * The one control at the bottom of 傾偈: hold it to talk, tap it to type (v2 build brief §6).
 *
 * 72 px tall and the full width, because it is the only thing on the screen a seventy-year-old
 * has to hit while holding the phone in one hand. The 220 ms threshold is what separates the two
 * gestures: past it the microphone opens and releasing sends; before it the bar turns into a
 * 56 px field with 送 and a mic button back. Sliding a thumb off the bar while holding ends the
 * hold through exactly the same path as letting go, which is what the canvas does — a gesture
 * that dies silently because the finger drifted is the thing people blame themselves for.
 *
 * When there is no speech input on this device at all, the bar starts in keyboard mode and says
 * so in one plain sentence rather than offering a microphone that cannot work. `lib/speech/stt.ts`
 * distinguishes "this browser has none" and "permission refused" (permanent — stay typing) from
 * "nothing was heard" (transient — the bar simply resets).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useT } from "@/components/LocaleProvider";
import type { UiLocale } from "@/lib/i18n/ui";
import type { InputLanguage } from "@/lib/domain/schemas";
import { isSttAvailable, listen, SpeechUnavailableError } from "@/lib/speech/stt";

/**
 * Copy with no key in `lib/i18n/ui.ts`. Word for word the sentence `components/VoiceBar.tsx`
 * already shows on the v1 screen, so the honest state reads identically wherever it appears.
 * Same rules as everything in that file: no 診斷/治療/處方, no "you should", no number about
 * the person.
 */
const NO_MIC: Record<UiLocale, string> = {
  hant: "而家聽唔到你講嘢，打字問就得。",
  hans: "现在听不到你说话，打字问就行。",
  en: "Speech input isn't working right now. Type the question instead.",
};

/** Past this, the press is a hold and the microphone opens. Under it, it is a tap. */
const HOLD_MS = 220;

export interface ChatBarProps {
  /** The language the question is spoken or typed in. Follows the reader's own language. */
  language: InputLanguage;
  locale: UiLocale;
  /** A question is in flight; the bar stays put rather than stacking a second one. */
  busy: boolean;
  onSend: (text: string) => void;
}

/** A subscription that never fires: whether this device has a microphone does not change mid-session. */
function noSubscribe(): () => void {
  return () => {};
}
/** The server has no microphone API to ask about, so it assumes there is one and hydration decides. */
function sttOnServer(): boolean {
  return true;
}

export default function ChatBar({ language, locale, busy, onSend }: ChatBarProps) {
  const t = useT();
  // Read through `useSyncExternalStore` rather than in an effect, so the honest keyboard-only
  // state is right on the first client render instead of one frame after it.
  const sttAvailable = useSyncExternalStore(noSubscribe, isSttAvailable, sttOnServer);

  const [chosen, setChosen] = useState<"voice" | "text" | null>(null);
  const [denied, setDenied] = useState(false);
  const [holding, setHolding] = useState(false);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");

  const noMic = !sttAvailable || denied;
  const mode: "voice" | "text" = noMic ? "text" : (chosen ?? "voice");

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapCandidate = useRef(false);
  const stopSignal = useRef<AbortController | null>(null);
  const cancelSignal = useRef<AbortController | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const listening = useRef(false);

  // Nothing may keep recording after the screen is gone.
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      cancelSignal.current?.abort();
    },
    [],
  );

  const beginListening = useCallback(async () => {
    if (listening.current) return;
    listening.current = true;
    const stop = new AbortController();
    const cancel = new AbortController();
    stopSignal.current = stop;
    cancelSignal.current = cancel;
    setHolding(true);
    setInterim("");

    try {
      const { text } = await listen(language, {
        onInterim: setInterim,
        stop: stop.signal,
        cancel: cancel.signal,
      });
      const said = text.trim();
      if (said.length > 0) onSend(said);
    } catch (error) {
      // "No API" and "permission refused" are permanent for this session, so the bar moves to
      // typing and says so. "Nothing was heard" is not a failure of the product — it resets.
      if (
        error instanceof SpeechUnavailableError &&
        (error.reason === "no_api" || error.reason === "denied")
      ) {
        setDenied(true);
      }
    } finally {
      listening.current = false;
      stopSignal.current = null;
      cancelSignal.current = null;
      setHolding(false);
      setInterim("");
    }
  }, [language, onSend]);

  const onDown = useCallback(() => {
    if (listening.current) return;
    tapCandidate.current = true;
    holdTimer.current = setTimeout(() => {
      tapCandidate.current = false;
      void beginListening();
    }, HOLD_MS);
  }, [beginListening]);

  /** Release, and also thumb-off-the-bar: both end the hold the same way and send what was heard. */
  const onRelease = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (tapCandidate.current) {
      tapCandidate.current = false;
      setChosen("text");
      // The field is mounted by this same state change, so focus waits a frame for it.
      requestAnimationFrame(() => fieldRef.current?.focus());
      return;
    }
    stopSignal.current?.abort();
  }, []);

  const send = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    onSend(text);
  }, [draft, onSend]);

  const note = noMic ? <p className="mb-2.5 text-meta text-muted">{NO_MIC[locale]}</p> : null;

  return (
    <div className="relative z-10 shrink-0 border-t border-hairline bg-ground px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {note}

      {mode === "voice" ? (
        <button
          type="button"
          disabled={busy}
          onPointerDown={onDown}
          onPointerUp={onRelease}
          onPointerLeave={onRelease}
          onPointerCancel={onRelease}
          // The press is a gesture, not a click: without this the browser starts a text selection
          // and iOS pops the magnifier over the bar mid-hold.
          onContextMenu={(event) => event.preventDefault()}
          aria-pressed={holding}
          className={`flex min-h-[72px] w-full touch-none items-center justify-center gap-3 rounded-[24px] px-5 py-5 select-none ${
            holding ? "bg-jade shadow-raised" : "surface"
          } ${busy ? "opacity-60" : ""}`}
        >
          {holding ? <HoldingWave /> : <MicMark />}
          <span
            className={`text-[21px] font-bold ${holding ? "text-white" : "text-ink"}`}
          >
            {holding ? interim || t("bar.listening") : t("bar.hold")}
          </span>
          <span
            className={`text-[16px] whitespace-nowrap ${holding ? "text-white/80" : "text-muted"}`}
          >
            {holding ? t("bar.listeningSub") : t("bar.holdSub")}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2.5">
          {!noMic ? (
            <button
              type="button"
              onClick={() => setChosen("voice")}
              aria-label={t("bar.backToVoice")}
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-neutral text-muted"
            >
              <MicMark tone="muted" />
            </button>
          ) : null}
          <input
            ref={fieldRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
            placeholder={t("bar.typePlaceholder")}
            aria-label={t("bar.typePlaceholder")}
            enterKeyHint="send"
            className="surface h-14 min-w-0 flex-1 rounded-full px-5 text-[19px] text-ink outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={draft.trim().length === 0 || busy}
            className="chunky grid h-14 w-14 shrink-0 place-items-center rounded-full text-[19px] font-bold text-white disabled:opacity-50"
            style={
              { background: "var(--jade)", "--chunky-edge": "var(--jade-shadow)" } as CSSProperties
            }
          >
            {t("bar.send")}
          </button>
        </div>
      )}
    </div>
  );
}

function MicMark({ tone = "jade" }: { tone?: "jade" | "muted" }) {
  return (
    <svg
      viewBox="0 0 15 21"
      aria-hidden="true"
      focusable="false"
      className="h-[30px] w-[22px] shrink-0"
      fill="none"
      stroke={tone === "muted" ? "currentColor" : "var(--jade-ink)"}
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <rect x="4.5" y="1" width="6" height="11.4" rx="3" />
      <path d="M1.2 10.2a6.3 6.3 0 0 0 12.6 0M7.5 16.6V20" />
    </svg>
  );
}

/** The listening waveform, in white on the jade fill. Status, not a control. */
function HoldingWave() {
  return (
    <span aria-hidden="true" className="flex h-[26px] items-end gap-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="animate-wv w-1 rounded-[3px] bg-white"
          style={{ height: "100%", animationDelay: `${i * 0.08}s` }}
        />
      ))}
    </span>
  );
}
