"use client";

/**
 * The three bubbles that are not yet messages: 明明 about to speak, 明明 speaking, and the reader
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
import { useT } from "@/components/LocaleProvider";
import Spark from "@/components/chat/Spark";
import Waveform from "@/components/chat/Waveform";

/** Two lilac dots on the agent's side: 明明 is about to say something. */
export function TypingBubble() {
  const t = useT();
  return (
    <div className="animate-rise mb-3 flex items-center gap-2.5 pr-8 lg:mb-5 lg:gap-3 lg:pr-16">
      <Spark />
      <div role="status" aria-label={t("chat.typing")} className="flex items-center gap-2.5">
        <Dots />
        <span className="text-[15px] text-muted">{t("chat.typing")}</span>
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
    <div className="mb-3 flex items-end gap-2.5 pr-8 lg:mb-5 lg:gap-3 lg:pr-16">
      <Spark />
      <div className="min-w-0 flex-1 whitespace-pre-line">
        <div
          className={`rounded-[18px_18px_18px_4px] px-4 py-3.5 ${
            warn ? "bg-warn-bg text-warn-ink" : "bg-card text-ink"
          }`}
        >
          {lead ? (
            <p className={`mb-1 text-fine font-medium ${warn ? "text-warn-stroke" : "text-muted"}`}>
              {lead}
            </p>
          ) : null}
          <p className="text-[17px] leading-[26px] break-words whitespace-pre-line">
            {text}
            <span
              aria-hidden="true"
              className={`animate-blink ml-[3px] inline-block h-4 w-[2px] translate-y-[2px] ${
                warn ? "bg-warn-stroke" : "bg-ink"
              }`}
            />
          </p>
        </div>
        {speaking ? (
          <p
            className={`mt-1.5 flex items-center gap-2 pl-1 text-[13px] font-medium ${
              warn ? "text-warn-ink" : "text-speaking"
            }`}
          >
            <Waveform tone={warn ? "warn" : "speaking"} />
            {t("chat.reading")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What the microphone has heard so far, as the design's LISTENING card on the reader's side.
 *
 * On the browser recognition path this fills in live. On the cloud path there are no interim
 * results at all, so it shows the dots and the 聽住… label instead of pretending to transcribe —
 * the reader still sees that the phone is listening and where the words will appear.
 */
export function ListeningBubble({ text }: { text: string }) {
  const t = useT();
  const said = text.trim();
  return (
    <div className="animate-fade-up mb-3 flex justify-end pl-10 lg:mb-5 lg:pl-24" role="status" aria-live="polite">
      <div className="w-full max-w-[86%] rounded-[16px] border border-hairline bg-card px-4 py-3.5 lg:max-w-[68%]">
        <p className="flex items-center gap-2 text-[11px] font-medium tracking-[1.3px] text-muted uppercase">
          <Waveform tone="speaking" />
          {t("chat.listening")}
        </p>
        {said ? (
          <p className="mt-1.5 min-h-[27px] text-[19px] leading-[27px] break-words text-ink">{said}</p>
        ) : (
          <div className="mt-2.5">
            <Dots />
          </div>
        )}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1 py-0.5">
      <span className="animate-blink block h-[7px] w-[7px] rounded-full" style={{ background: "#978db0" }} />
      <span
        className="animate-blink block h-[7px] w-[7px] rounded-full"
        style={{ background: "#bf87ab", animationDelay: "0.3s" }}
      />
    </span>
  );
}
