"use client";

/**
 * 危險訊號 — the warning signs, and the one card on 跟進 that is never allowed to be missing.
 *
 * Constitution II: if the sheet printed warning signs they are extracted and shown; if it printed
 * none, the app SAYS so and shows the hospital's own contact line instead. The red-flag slot is
 * never empty and never silently absent — so this component always renders something, and the
 * "no warning signs" state is a designed state rather than a gap.
 *
 * 叫明仔講一次 hands the job back to the conversation: `/chat?say=warnings` re-speaks the block in
 * the thread, where the voice, the waveform and the source links already live. Reading it aloud
 * from here would be a second speaking surface with its own bugs.
 */
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { fill } from "@/components/home/format";
import type { StoredReading } from "@/lib/domain/schemas";
import { scriptForDialect, toScript } from "@/lib/i18n/script";

export default function WarningSigns({ reading }: { reading: StoredReading }) {
  const { dialect, script, t } = useLocale();
  const [open, setOpen] = useState(false);

  const signs = reading.warningSigns ?? [];

  // Same rule as `components/Card.tsx`: the text shown is the text that will be SPOKEN to the
  // parent, converted between the two Chinese scripts only when the reader has flipped it.
  const show = (value: string) =>
    script === scriptForDialect(dialect) ? value : toScript(value, script);

  if (signs.length === 0) {
    const contact = reading.hospitalContact?.text?.trim() ?? "";
    return (
      <section className="mt-5 rounded-[20px] bg-warn-bg p-5">
        <h2 className="flex items-center gap-3 text-[20px] leading-[1.35] font-bold text-warn-ink">
          <AlertGlyph />
          {t("card.noWarnings")}
        </h2>
        <p className="mt-3 text-[18px] leading-[1.55] text-warn-ink">{t("card.noWarningsBody")}</p>
        {contact ? (
          <p className="mt-3 text-[19px] leading-[1.5] font-medium text-warn-ink">{contact}</p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-3.5 rounded-[20px] bg-warn-bg p-5 text-left"
      >
        <AlertGlyph />
        <span className="flex-1 text-[20px] font-bold text-warn-ink">
          {fill(t("track.warnings"), { n: signs.length })}
        </span>
        {/* Decoration: --warn-stroke is 4.98:1 on --warn-bg, and this glyph carries no word. */}
        <span aria-hidden="true" className="text-[20px] leading-none text-warn-stroke">
          {open ? "⌃" : "⌄"}
        </span>
      </button>

      {open ? (
        <div className="animate-rise -mt-2 rounded-[20px] bg-warn-bg px-5 pt-4 pb-[22px]">
          <ul className="flex list-none flex-col gap-3.5 p-0">
            {signs.map((sign, index) => (
              <li key={index} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-[9px] h-2 w-2 shrink-0 rounded-full bg-warn-dot"
                />
                <span className="text-[22px] leading-[1.45] font-medium text-warn-ink">
                  {show(sign.symptom[dialect])}
                </span>
              </li>
            ))}
          </ul>

          <Link
            href="/chat?say=warnings"
            /*
             * --warn-stroke on --warn-btn is 4.42:1 and this is a label somebody reads. --warn-ink
             * is 6.37:1 on the same fill (globals.css).
             */
            className="mt-[18px] flex min-h-12 w-full items-center justify-center rounded-2xl bg-warn-btn p-4 text-[17px] font-medium text-warn-ink no-underline"
          >
            {t("track.saySigns")}
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** Colour is never the only signal (design.md §7): the amber block also carries a glyph. */
function AlertGlyph() {
  return (
    <svg
      width="24"
      height="22"
      viewBox="0 0 21 19"
      fill="none"
      stroke="var(--warn-stroke)"
      strokeWidth="2.1"
      className="shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10.5 1.6 19.6 17H1.4L10.5 1.6Z" strokeLinejoin="round" />
      <path d="M10.5 7.2v4M10.5 13.9v.2" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}
