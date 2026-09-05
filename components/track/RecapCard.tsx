"use client";

/**
 * 我哋講咗嘅 — what the reader did in the conversation, as a card on 跟進.
 *
 * Teach-back was invisible once the chat scrolled away. This makes it a thing the reader (or the
 * daughter looking over their shoulder) can see: how far the briefing got, how many times they
 * said 明白, how many times they asked for a section again, how many questions of their own they
 * put. Counted live from the thread by `components/track/followup.ts`; nothing new is stored.
 * When the briefing is unfinished the card says so and offers the way back into it.
 */
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import { fill } from "@/components/home/format";
import type { Recap } from "@/components/track/followup";

export default function RecapCard({ recap }: { recap: Recap }) {
  const { t } = useLocale();
  const status = recap.done
    ? t("track.recapDone")
    : fill(t("track.recapProgress"), { n: recap.sections });
  const counts = fill(t("track.recapCounts"), {
    understood: recap.understood,
    repeated: recap.repeated,
    asked: recap.asked,
  });
  return (
    <section className="surface mt-3 p-4" data-testid="recap-card">
      <h2 className="text-[17px] font-bold text-ink">{t("track.recapTitle")}</h2>
      <p className="mt-1.5 text-[15px] leading-[22px] text-ink">{status}</p>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{counts}</p>
      {!recap.done ? (
        <Link href="/chat" className="mt-3 inline-flex min-h-9 items-center text-fine font-semibold text-jade-ink">
          {t("track.recapContinue")}
        </Link>
      ) : null}
    </section>
  );
}
