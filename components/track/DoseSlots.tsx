"use client";

/**
 * The slot chips under a medicine: one per time the page says to take it today.
 *
 * Shared by the checklist widget in the thread and the dose cards on 今日, so a slot ticked in one
 * place is ticked in the other — both read the same `DoseState` off the active sheet. Only the
 * NEXT empty slot is live; a dose is taken in order, and `takeDose` clamps at the printed total.
 *
 * What the chips say is a count, never a clock time (brief §2 rule 7): 「第 2 次」, not 「14:00」.
 * A stopped medicine shows the page's own verdict and nothing tappable; an as-needed one shows
 * 唔痛就唔使食 and nothing to count; a clause the rules could not read shows nothing here at all,
 * and the card above it carries the printed words.
 *
 * The accessible name is the medicine plus the slot, and deliberately never contains 食咗: that
 * word is the name of the 跟進 tab's own button, and the browser suite counts those.
 */
import { useT } from "@/components/LocaleProvider";
import { fill } from "@/components/home/format";
import { remaining, type DoseTarget } from "@/lib/rules/doses";
import type { DoseState } from "@/lib/sheets/types";

export default function DoseSlots({
  target,
  state,
  today,
  onTake,
  size = "sm",
}: {
  target: DoseTarget;
  state: DoseState | undefined;
  today: Date;
  onTake: (key: string) => void;
  /** `sm` inside the thread (40 px look, 48 px target), `md` on 今日 (44 px look). */
  size?: "sm" | "md";
}) {
  const t = useT();

  if (target.stopped) {
    return (
      <span className="inline-flex min-h-10 items-center rounded-full bg-neutral px-3 text-[13px] font-medium text-ink">
        {t("dose.stopped")}
      </span>
    );
  }
  if (target.asNeeded) {
    return (
      <span className="inline-flex min-h-10 items-center rounded-full border border-hairline bg-card px-3 text-[13px] font-medium text-ink">
        {t("dose.asNeeded")}
      </span>
    );
  }
  if (target.total <= 0) return null;

  const taken = target.total - remaining(target, state, today);
  const text = size === "md" ? "text-[15px]" : "text-[14px]";
  const pad = size === "md" ? "px-4" : "px-3.5";

  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: target.total }, (_, slot) => {
        const done = slot < taken;
        const next = slot === taken;
        const label = fill(t(done ? "companion.slotDone" : "companion.slot"), { n: slot + 1 });
        return (
          <button
            key={slot}
            type="button"
            disabled={!next}
            aria-pressed={done}
            aria-label={`${target.name} · ${label}`}
            onClick={() => onTake(target.key)}
            className={`chunky inline-flex min-h-12 items-center rounded-full border font-semibold transition-colors disabled:cursor-default ${text} ${pad} ${
              done ? "border-ink bg-ink text-white" : "border-hairline bg-card text-ink"
            } ${!done && !next ? "border-dashed text-muted" : ""}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
