"use client";

/**
 * The desktop ask box. Phone 傾偈 keeps the full-width hold-to-talk bar; this is `display: none`
 * below 1024 px and is the shape people already know from ChatGPT / Claude: a field that grows,
 * Enter to send, a microphone on the left, a send on the right.
 *
 * Hold-to-talk is still here, on the microphone, with the same 220 ms threshold and the same
 * `listen()` path as the phone bar — so a laptop with a mic still works, and the phone bar's
 * markup (and its unit test: exactly one control) is left alone.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useT } from "@/components/LocaleProvider";
import type { UiLocale } from "@/lib/i18n/ui";
import type { InputLanguage } from "@/lib/domain/schemas";
import {
  isSttAvailable,
  listen,
  SpeechUnavailableError,
  type SpeechUnavailableReason,
} from "@/lib/speech/stt";

const NO_MIC: Record<UiLocale, string> = {
  hant: "而家聽唔到你講嘢，打字問就得。",
  hans: "现在听不到你说话，打字问就行。",
  en: "Speech input isn't working right now. Type the question instead.",
};

const NOT_SENT: Record<UiLocale, string> = {
  hant: "聽到你講嘢，但係送唔到出去。撳住再講多次，或者打字問。",
  hans: "听到你说话，但是发不出去。按住再说一次，或者打字问。",
  en: "I heard you, but it couldn't go through. Hold and say it again, or type it.",
};

const NO_MIC_NOW: Record<UiLocale, string> = {
  hant: "麥克風未開到。撳住耐啲再講一次，或者打字問。",
  hans: "麦克风还没开。按住久一点再说一次，或者打字问。",
  en: "The microphone wasn't open. Hold it a little longer and say it again, or type it.",
};

function noteFor(reason: SpeechUnavailableReason): Record<UiLocale, string> | null {
  if (reason === "network") return NOT_SENT;
  if (reason === "provider") return NO_MIC_NOW;
  return null;
}

type Phase = "idle" | "opening" | "listening" | "sending";

const HOLD_MS = 220;

export interface DesktopComposerProps {
  language: InputLanguage;
  locale: UiLocale;
  busy: boolean;
  onSend: (text: string) => void;
  onListening?: (listening: boolean) => void;
  onInterim?: (text: string) => void;
  onNothingHeard?: () => void;
}

function noSubscribe(): () => void {
  return () => {};
}
function sttOnServer(): boolean {
  return true;
}

export default function DesktopComposer({
  language,
  locale,
  busy,
  onSend,
  onListening,
  onInterim,
  onNothingHeard,
}: DesktopComposerProps) {
  const t = useT();
  const sttAvailable = useSyncExternalStore(noSubscribe, isSttAvailable, sttOnServer);

  const [denied, setDenied] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Record<UiLocale, string> | null>(null);
  const [draft, setDraft] = useState("");

  const holding = phase === "opening" || phase === "listening";
  const sending = phase === "sending";
  const noMic = !sttAvailable || denied;

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapCandidate = useRef(false);
  const stopSignal = useRef<AbortController | null>(null);
  const cancelSignal = useRef<AbortController | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const listening = useRef(false);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      cancelSignal.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }, [draft]);

  const stopListening = useCallback(() => {
    if (!listening.current) return;
    setPhase("sending");
    onInterim?.("");
    onListening?.(false);
    stopSignal.current?.abort();
  }, [onInterim, onListening]);

  const beginListening = useCallback(async () => {
    if (listening.current) return;
    listening.current = true;
    const stop = new AbortController();
    const cancel = new AbortController();
    stopSignal.current = stop;
    cancelSignal.current = cancel;
    setFailure(null);
    setPhase("opening");
    onInterim?.("");
    onListening?.(true);

    try {
      const { text } = await listen(language, {
        onInterim: (partial) => onInterim?.(partial),
        onOpen: () => setPhase((current) => (current === "opening" ? "listening" : current)),
        stop: stop.signal,
        cancel: cancel.signal,
      });
      const said = text.trim();
      if (said.length > 0) onSend(said);
      else onNothingHeard?.();
    } catch (error) {
      const reason =
        error instanceof SpeechUnavailableError ? error.reason : ("provider" as const);
      if (reason === "no_api" || reason === "denied") {
        setDenied(true);
      } else {
        const note = noteFor(reason);
        if (note) setFailure(note);
        else onNothingHeard?.();
      }
    } finally {
      listening.current = false;
      stopSignal.current = null;
      cancelSignal.current = null;
      setPhase("idle");
      onInterim?.("");
      onListening?.(false);
    }
  }, [language, onInterim, onListening, onNothingHeard, onSend]);

  const onDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (listening.current || noMic) return;
      setFailure(null);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Older engines refuse capture; the hold still works on the control itself.
      }
      tapCandidate.current = true;
      holdTimer.current = setTimeout(() => {
        tapCandidate.current = false;
        void beginListening();
      }, HOLD_MS);
    },
    [beginListening, noMic],
  );

  const onRelease = useCallback(
    (event?: ReactPointerEvent<HTMLButtonElement>) => {
      if (event) {
        try {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Nothing to release.
        }
      }
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      if (tapCandidate.current) {
        tapCandidate.current = false;
        return;
      }
      stopListening();
    },
    [stopListening],
  );

  const send = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    setDraft("");
    setFailure(null);
    onSend(text);
  }, [busy, draft, onSend]);

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      send();
    },
    [send],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      send();
    },
    [send],
  );

  const noteText = noMic ? NO_MIC[locale] : (failure?.[locale] ?? null);
  const canSend = draft.trim().length > 0 && !busy && !sending;

  return (
    <div className="relative z-10 hidden shrink-0 px-4 pt-1 pb-4 lg:block">
      <form onSubmit={onSubmit} className="desktop-chat-col">
        {noteText ? (
          <p role="status" className="mb-2 px-1 text-[13px] leading-[1.4] text-muted">
            {noteText}
          </p>
        ) : null}

        <div
          className={`rounded-[28px] border border-hairline bg-card px-2 pt-1 pb-2 shadow-[0_10px_40px_rgb(42_39_35/0.08)] transition-[box-shadow] duration-200 ${
            holding ? "ring-2 ring-jade/30" : ""
          }`}
        >
          <label className="sr-only" htmlFor="desktop-composer">
            {t("bar.typePlaceholder")}
          </label>
          <textarea
            id="desktop-composer"
            ref={fieldRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("bar.typePlaceholder")}
            rows={1}
            disabled={busy || sending || holding}
            className="block max-h-40 min-h-[48px] w-full resize-none bg-transparent px-4 py-3 text-[16px] leading-[1.55] text-ink outline-none placeholder:text-muted disabled:opacity-70"
          />

          <div className="flex items-center justify-between gap-2 px-1.5">
            {noMic ? (
              <span className="h-10 w-10" aria-hidden="true" />
            ) : (
              <button
                type="button"
                disabled={sending || busy}
                onPointerDown={onDown}
                onPointerUp={onRelease}
                onPointerCancel={onRelease}
                onContextMenu={(event) => event.preventDefault()}
                aria-label={t("bar.hold")}
                aria-pressed={holding}
                className={`grid h-10 w-10 shrink-0 touch-none place-items-center rounded-full select-none transition-colors duration-150 ${
                  holding ? "bg-jade text-white shadow-raised" : "bg-neutral text-muted hover:text-ink"
                } ${sending || busy ? "opacity-60" : ""}`}
              >
                {holding ? <HoldingWave /> : <MicMark />}
              </button>
            )}

            <button
              type="submit"
              disabled={!canSend}
              aria-label={t("bar.send")}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-jade text-white transition-opacity duration-150 disabled:opacity-35"
            >
              <SendMark />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function MicMark() {
  return (
    <svg
      viewBox="0 0 15 21"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-[14px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <rect x="4.5" y="1" width="6" height="11.4" rx="3" />
      <path d="M1.2 10.2a6.3 6.3 0 0 0 12.6 0M7.5 16.6V20" />
    </svg>
  );
}

function SendMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 16V4M5 9l5-5 5 5" />
    </svg>
  );
}

function HoldingWave() {
  return (
    <span aria-hidden="true" className="flex h-4 items-end gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="animate-wv w-0.5 rounded-sm bg-white"
          style={{ height: "100%", animationDelay: `${i * 0.08}s` }}
        />
      ))}
    </span>
  );
}
