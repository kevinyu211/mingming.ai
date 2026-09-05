"use client";

/**
 * One medicine, as the page prints it (brief §7, constitution VII and VIII), as a row in the
 * design's 今日嘅藥 card.
 *
 * Three rules decide everything on this row, and all three live in `lib/rules/doses.ts` rather
 * than here — this file only renders what that module already decided:
 *
 * **A counter never shows a clock time.** A discharge sheet prints a frequency, not an hour.
 * 「每日兩次，隨餐」 becomes 「今日仲有 2 次」 and two slots to tick — a count of times today —
 * and never "8am / 8pm", which would be the app writing a prescription the page did not.
 *
 * **A clause the rules could not read gets no number at all.** 「每朝一次」 is perfectly readable
 * to a person and is deliberately NOT countable to `timesPerDay`, so its row shows the printed
 * clause and stops there. Fewer counters than the design draws is the correct outcome, not a
 * missing feature: a number the app invented is worse than a number it declined to show.
 *
 * **A stopped medicine is never a dose.** It stays on the screen — the family needs to know the
 * page names the drug and says it has ended — with no counter and no 食咗 button anywhere near it.
 *
 * The slots and the 食咗 button do the same thing (`takeDose`); the button is the big target for a
 * thumb, the slots are the picture of where today stands.
 */
import ChunkyButton from "@/components/ChunkyButton";
import { useLocale } from "@/components/LocaleProvider";
import { fill } from "@/components/home/format";
import DoseSlots from "@/components/track/DoseSlots";
import { remaining, type DoseTarget } from "@/lib/rules/doses";
import type { DoseState } from "@/lib/sheets";

export default function DoseCard({
  target,
  state,
  today,
  onTake,
}: {
  target: DoseTarget;
  state: DoseState | undefined;
  today: Date;
  onTake: (key: string) => void;
}) {
  const { t } = useLocale();

  const countable = !target.stopped && !target.asNeeded && target.total > 0;
  const left = countable ? remaining(target, state, today) : 0;
  const done = countable && left <= 0;

  const status = target.stopped
    ? null // the slot chip says it, once
    : target.asNeeded
      ? null // likewise
      : countable
        ? done
          ? t("dose.done")
          : fill(t("dose.left"), { n: left })
        : null;

  return (
    <li className="list-none border-b border-hairline pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="dose text-[16px] leading-[1.3] font-semibold text-ink">{target.name}</p>
          {target.generic ? (
            <p className="dose mt-0.5 text-[13px] text-muted">{target.generic}</p>
          ) : null}
          {/*
            The page's own words. `card.printed` is the one wrapper for verbatim page text in the
            whole interface, and the clause inside it is never rewritten or script-converted.
          */}
          <p className="mt-1 text-[14px] leading-[1.45] text-muted">
            {target.printed
              ? fill(t("card.printed"), { text: target.printed })
              : t("card.missingFrequency")}
          </p>
        </div>

        {/* Only a countable, current medicine gets a button. Nothing else can be "taken". */}
        {countable ? (
          <ChunkyButton
            variant={done ? "neutral" : "jade"}
            size="md"
            disabled={done}
            onClick={() => onTake(target.key)}
            className="min-h-[48px] shrink-0"
          >
            {t("dose.take")}
          </ChunkyButton>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <DoseSlots target={target} state={state} today={today} onTake={onTake} size="md" />
        {status !== null ? (
          <p className={`text-[15px] font-medium ${done ? "text-muted" : "text-ink"}`}>{status}</p>
        ) : null}
      </div>
    </li>
  );
}
