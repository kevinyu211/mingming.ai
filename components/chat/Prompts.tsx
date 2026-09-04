"use client";

/**
 * The one place the conversation stops and waits for the reader.
 *
 * **食咗 / 未食** is the daily check-in. 食咗 counts one dose down; 未食 quotes the printed clause
 * back and stops. There is no third button, no nudge and no promise of a reminder: the app has no
 * push notifications and must not imply the phone will go off by itself (brief §6).
 *
 * ── What used to be here ─────────────────────────────────────────────────────────────────────
 *
 * `UnderstandPrompt` — 明唔明？ with a 明白 button and a 再講一次 button — stopped the briefing
 * after every single card. Teach-back is still the step this product exists to add (the Hospital
 * Authority's own implementation study records that "teach-back is not required" in the workflow,
 * docs/real-sheet-evidence.md §3), but a button pressed to make a screen continue is not
 * teach-back: nobody presses 明白 to mean anything, and after the third one it reads as being
 * quizzed. The question is now asked ONCE, in words, in the thread (`brief.checkUnderstand`), and
 * the reader answers it the way they answer everything else here — by holding the bar and talking
 * back. `app/chat/page.tsx` plays the rest of the script by itself.
 */
import ChunkyButton from "@/components/ChunkyButton";
import { useT } from "@/components/LocaleProvider";

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
