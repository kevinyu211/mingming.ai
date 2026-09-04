"use client";

/**
 * The two places the conversation stops and waits for the reader.
 *
 * **明唔明？** is teach-back, one piece at a time. The Hospital Authority's own implementation
 * study of its post-discharge form records that "teach-back is not required" in the workflow
 * (docs/real-sheet-evidence.md §3) — this loop is the step that is missing from the process, not
 * a UI flourish, which is why it interrupts after every single piece rather than at the end.
 *
 * **食咗 / 未食** is the daily check-in. 食咗 counts one dose down; 未食 quotes the printed clause
 * back and stops. There is no third button, no nudge and no promise of a reminder: the app has no
 * push notifications and must not imply the phone will go off by itself (brief §6).
 */
import ChunkyButton from "@/components/ChunkyButton";
import { useT } from "@/components/LocaleProvider";

export function UnderstandPrompt({
  remaining,
  showRemaining,
  onRepeat,
  onUnderstand,
}: {
  /** Pieces still to come after this one. */
  remaining: number;
  /** Hidden before the first piece: 「仲有 3 段」 under the very first question is a warning label. */
  showRemaining: boolean;
  onRepeat: () => void;
  onUnderstand: () => void;
}) {
  const t = useT();
  return (
    <section
      aria-label={t("brief.understandQuestion")}
      className="surface animate-rise mb-[22px] rounded-[22px] p-[22px_20px]"
    >
      <h2 className="text-center text-[24px] leading-[1.4] font-bold text-ink">
        {t("brief.understandQuestion")}
      </h2>
      <div className="mt-[18px] flex gap-3">
        <ChunkyButton variant="neutral" onClick={onRepeat} className="flex-1">
          {t("brief.repeat")}
        </ChunkyButton>
        <ChunkyButton variant="jade" onClick={onUnderstand} className="flex-1">
          {t("brief.understand")}
        </ChunkyButton>
      </div>
      {showRemaining ? (
        <p className="mt-3.5 text-center text-meta text-muted">
          {t("brief.left").replace("{n}", String(remaining))}
        </p>
      ) : null}
    </section>
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
    <div className="animate-rise mb-[22px] flex gap-3 pl-[55px]">
      <ChunkyButton variant="jade" onClick={onTook} className="flex-1">
        {t("checkin.took")}
      </ChunkyButton>
      <ChunkyButton variant="neutral" onClick={onNotYet} className="flex-1">
        {t("checkin.notYet")}
      </ChunkyButton>
    </div>
  );
}
