"use client";

/**
 * The two places the conversation stops and waits for the reader.
 *
 * **明白 / 再講一次** is teach-back. The briefing already stops at the end of a section
 * (`Beat.awaits`) and will not take the floor back until something comes in. The buttons make that
 * wait *stick* as a visible action — a seventy-year-old HK carer should not have to hold a
 * microphone to say the one word this product exists to hear. Spoken or typed 「明白」 still
 * works through the same `classifyReply` path; the buttons write the same words into the thread
 * so the 跟進 recap counts them.
 *
 * **食咗 / 未食** is the daily check-in. 食咗 counts one dose down; 未食 quotes the printed clause
 * back and stops. There is no third button, no nudge and no promise of a reminder: the app has no
 * push notifications and must not imply the phone will go off by itself (brief §6).
 */
import ChunkyButton from "@/components/ChunkyButton";
import { useT } from "@/components/LocaleProvider";

export function UnderstandPrompt({
  onUnderstand,
  onRepeat,
}: {
  onUnderstand: () => void;
  onRepeat: () => void;
}) {
  const t = useT();
  return (
    <div className="animate-rise mb-2.5 flex gap-2.5 pl-10">
      <ChunkyButton variant="jade" onClick={onUnderstand} className="flex-1">
        {t("brief.understand")}
      </ChunkyButton>
      <ChunkyButton variant="neutral" onClick={onRepeat} className="flex-1">
        {t("brief.repeat")}
      </ChunkyButton>
    </div>
  );
}

export function CheckinPrompt({
  onTook,
  onNotYet,
}: {
  onTook: () => void;
  onNotYet: () => void;
}) {
  const t = useT();
  return (
    <div className="animate-rise mb-2.5 flex gap-2.5 pl-10">
      <ChunkyButton variant="jade" onClick={onTook} className="flex-1">
        {t("checkin.took")}
      </ChunkyButton>
      <ChunkyButton variant="neutral" onClick={onNotYet} className="flex-1">
        {t("checkin.notYet")}
      </ChunkyButton>
    </div>
  );
}
