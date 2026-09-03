"use client";

/**
 * The crisis referral card (FR-014, User Story 1 scenario 10, rules.md §12).
 *
 * It replaces the answer; it is not one. Nothing here is model-written, nothing is spoken, and
 * the card asks the user nothing back — the app does not offer emotional support and does not
 * invite emotional disclosure (constitution, Hackathon Compliance Constraints). It says it
 * cannot help with this, and it shows real numbers.
 *
 * Calm on purpose: card white, no amber rule, no alarm colour. Amber is the sheet's own "go
 * back to hospital" signal and borrowing it here would dress a hotline list as an emergency
 * verdict. The numbers sit in one card as hairline-separated rows, each with a quiet round call
 * button, the way a phone's own contact list looks — nothing shouts.
 *
 * The organiser row in `REFERRAL_RESOURCES` is still a placeholder until the kickoff briefing
 * publishes the list. It is rendered visibly marked and NOT dialable, so nobody — judge or
 * daughter — can tap a number that does not exist.
 */
import { useId } from "react";
import { useLocale } from "@/components/LocaleProvider";
import type { InputLanguage } from "@/lib/domain/schemas";
import { REFERRAL, REFERRAL_RESOURCES, type ReferralResource } from "@/lib/i18n/referral";
import type { UiLocale } from "@/lib/i18n/ui";

/** Copy with no key in `lib/i18n/ui.ts` yet. Passes the same banned-term rules. */
const LOCAL: Record<"placeholder" | "fixedText", Record<UiLocale, string>> = {
  placeholder: {
    hant: "未填好，等主辦方公布",
    hans: "未填好，等主办方公布",
    en: "Not filled in yet — waiting for the organisers' list",
  },
  fixedText: {
    hant: "呢一頁冇經過 AI，係固定寫好嘅。你頭先打嗰句冇傳出去。",
    hans: "这一页没有经过 AI，是固定写好的。你刚才打的那句没有传出去。",
    en: "This page is fixed text and did not go through AI. What you typed was not sent anywhere.",
  },
};

/** A row is a placeholder while it is the organisers' slot with no number in it. */
function isPlaceholder(resource: ReferralResource): boolean {
  return resource.region === "organiser" || resource.number.trim().toUpperCase() === "TODO";
}

export default function ReferralCard({
  inputLanguage,
  text,
  resources = REFERRAL_RESOURCES,
}: {
  /** The language the question was asked in: this card is for the person holding the phone. */
  inputLanguage: InputLanguage;
  text?: string;
  resources?: readonly ReferralResource[];
}) {
  const { t, locale } = useLocale();
  const titleId = useId();

  return (
    <>
      <section aria-labelledby={titleId} className="surface flex flex-col gap-4 px-[18px] py-5">
        <div className="flex flex-col gap-2">
          <h2 id={titleId} className="text-card-title font-bold text-ink">
            {t("ask.referral")}
          </h2>
          <p className="text-[17px] leading-[1.6] text-muted">
            {text ?? REFERRAL[inputLanguage]}
          </p>
        </div>

        <ul className="flex flex-col">
          {resources.map((resource) => {
            const placeholder = isPlaceholder(resource);
            return (
              <li
                key={`${resource.region}-${resource.number}-${resource.name}`}
                className="hairrow flex items-center justify-between gap-3 py-3.5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={`text-[17px] leading-snug font-semibold break-words ${
                      placeholder ? "text-muted" : "text-ink"
                    }`}
                  >
                    {resource.name}
                  </span>
                  {placeholder ? (
                    <span className="text-meta text-muted">{LOCAL.placeholder[locale]}</span>
                  ) : (
                    <span className="dose text-meta text-muted">{resource.number}</span>
                  )}
                </div>

                {placeholder ? (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-card-border text-faint"
                  >
                    <PhoneGlyph />
                  </span>
                ) : (
                  <a
                    href={`tel:${resource.number.replace(/\s+/g, "")}`}
                    aria-label={`${t("ask.referralCall")} ${resource.number}`}
                    className="tap h-12 w-12 shrink-0 rounded-full bg-chip text-accent"
                  >
                    <PhoneGlyph />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-3 px-1 text-fine leading-[1.5] text-muted">{LOCAL.fixedText[locale]}</p>
    </>
  );
}

function PhoneGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1.1 1A16 16 0 0 1 4 5.1 1 1 0 0 1 5 4z" />
    </svg>
  );
}
