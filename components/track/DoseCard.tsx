"use client";

/**
 * One medicine, as the page prints it (brief §7, constitution VII and VIII).
 *
 * Three rules decide everything on this card, and all three live in `lib/rules/doses.ts` rather
 * than here — this file only renders what that module already decided:
 *
 * **A counter never shows a clock time.** A discharge sheet prints a frequency, not an hour.
 * 「每日兩次，隨餐」 becomes 「今日仲有 2 次」 — a count of times remaining today — and never
 * "8am / 8pm", which would be the app writing a prescription the page did not.
 *
 * **A clause the rules could not read gets no number at all.** 「每朝一次」 is perfectly readable
 * to a person and is deliberately NOT countable to `timesPerDay`, so its card shows the printed
 * clause and stops there. Fewer counters than the design canvas draws is the correct outcome, not
 * a missing feature: a number the app invented is worse than a number it declined to show.
 *
 * **A stopped medicine is never a dose.** It stays on the screen — the family needs to know the
 * page names the drug and says it has ended — with no counter and no 食咗 button anywhere near it.
 */
import ChunkyButton from "@/components/ChunkyButton";
import { useLocale } from "@/components/LocaleProvider";
import { fill } from "@/components/home/format";
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
    ? t("dose.stopped")
    : target.asNeeded
      ? t("dose.asNeeded")
      : countable
        ? done
          ? t("dose.done")
          : fill(t("dose.left"), { n: left })
        : null;

  return (
    <li className="surface list-none rounded-[20px] p-5">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="h-[38px] w-[38px] shrink-0 rounded-full"
          style={{ background: target.stopped ? "var(--neutral)" : "var(--jade-tint-2)" }}
        />
        <div className="min-w-0 flex-1">
          <p className="dose text-[22px] leading-[1.3] font-bold text-ink">{target.name}</p>
          {target.generic ? (
            <p className="dose mt-0.5 text-[15px] text-muted">{target.generic}</p>
          ) : null}
        </div>
      </div>

      {/*
        The page's own words. `card.printed` is the one wrapper for verbatim page text in the whole
        interface, and the clause inside it is never rewritten or script-converted.
      */}
      <p className="mt-3.5 rounded-[14px] bg-neutral-2 px-4 py-3.5 text-[18px] leading-[1.55] text-muted">
        {target.printed
          ? fill(t("card.printed"), { text: target.printed })
          : t("card.missingFrequency")}
      </p>

      {status !== null || countable ? (
        <div className="mt-4 flex items-center justify-between gap-3.5">
          {status !== null ? (
            <p
              className="text-[20px] font-medium"
              style={{ color: done || !countable ? "var(--muted)" : "var(--ink)" }}
            >
              {status}
            </p>
          ) : (
            <span />
          )}

          {/* Only a countable, current medicine gets a button. Nothing else can be "taken". */}
          {countable ? (
            <ChunkyButton
              variant="jade"
              size="md"
              disabled={done}
              onClick={() => onTake(target.key)}
              className="shrink-0"
            >
              {t("dose.take")}
            </ChunkyButton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
