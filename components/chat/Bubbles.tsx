"use client";

/**
 * The three bubbles that are not yet messages: 明仔 about to speak, 明仔 speaking, and the reader
 * being heard.
 *
 * All three live in the thread, in the same column and at the same size as the committed messages,
 * because that is the whole of what "the conversation is the product" means in layout terms. A
 * transcript that appears inside the microphone button, or a pause with nothing on screen, both
 * leave the reader looking at a screen that is not visibly doing anything.
 *
 * None of them is a control. `ListeningBubble` shows what the speech API has heard SO FAR, and the
 * text it shows is thrown away and re-shown as a real user message once the reader lets go, so
 * nothing is ever sent that was not first put in front of them (research.md R6).
 */
import Mascot from "@/components/Mascot";
import { useT } from "@/components/LocaleProvider";
import Waveform from "@/components/chat/Waveform";

/** Three dots on the agent's side: 明仔 is about to say something. */
export function TypingBubble() {
  const t = useT();
  return (
    <div className="animate-rise mb-2.5 flex items-start gap-2 pr-8">
      <Mascot size={30} className="mt-0.5 shrink-0" />
      <div
        role="status"
        aria-label={t("chat.typing")}
        className="rounded-[4px_16px_16px_16px] bg-card px-4 py-3 shadow-card"
      >
        <Dots />
      </div>
    </div>
  );
}

/**
 * The message being typed out. Committed to the thread by `appendMessage` the moment the last
 * clause lands, so this and the real bubble are never on screen together.
 */
export function SpeakingBubble({
  lead,
  text,
  warn,
  speaking,
}: {
  lead: string | null;
  text: string;
  warn: boolean;
  speaking: boolean;
}) {
  const t = useT();
  return (
    <div className="mb-2.5 flex items-start gap-2 pr-8">
      <Mascot size={30} state="speaking" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 whitespace-pre-line">
        <div
          className={`rounded-[4px_16px_16px_16px] px-3.5 py-2.5 ${
            warn ? "bg-warn-bg text-warn-ink" : "bg-card text-ink shadow-card"
          }`}
        >
          {lead ? (
            <p className={`mb-1 text-fine font-medium ${warn ? "text-warn-stroke" : "text-muted"}`}>
              {lead}
            </p>
          ) : null}
          <p className="text-[16.5px] leading-[1.6] break-words whitespace-pre-line">
            {text}
            <span
              aria-hidden="true"
              className={`animate-blink ml-[3px] inline-block h-4 w-[2px] translate-y-[2px] ${
                warn ? "bg-warn-stroke" : "bg-jade"
              }`}
            />
          </p>
          {speaking ? (
            <p
              className={`mt-1.5 flex items-center gap-1.5 text-fine font-medium ${
                warn ? "text-warn-ink" : "text-jade-ink"
              }`}
            >
              <Waveform tone={warn ? "warn" : "jade"} />
              {t("chat.reading")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * What the microphone has heard so far, on the reader's own side of the thread.
 *
 * On the browser recognition path this fills in live. On the cloud path there are no interim
 * results at all, so it shows the dots and the 聽住… label instead of pretending to transcribe —
 * the reader still sees that the phone is listening and where the words will appear.
 */
export function ListeningBubble({ text }: { text: string }) {
  const t = useT();
  const said = text.trim();
  return (
    <div className="mb-2.5 flex justify-end pl-10" role="status" aria-live="polite">
      <div className="max-w-[82%] rounded-[16px_4px_16px_16px] bg-jade-bubble px-3.5 py-2.5">
        {said ? (
          <p className="text-[16px] leading-[1.55] break-words text-ink">{said}</p>
        ) : (
          <Dots tone="jade" />
        )}
        <p className="mt-1 flex items-center justify-end gap-1.5 text-fine font-medium text-jade-ink">
          <Waveform />
          {t("chat.listening")}
        </p>
      </div>
    </div>
  );
}

function Dots({ tone = "muted" }: { tone?: "muted" | "jade" }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-1.5 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`animate-blink block h-[7px] w-[7px] rounded-full ${
            tone === "jade" ? "bg-jade" : "bg-faint"
          }`}
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}
