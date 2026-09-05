"use client";

/**
 * 分享俾屋企人 — hands the reading to whoever the reader lives with.
 *
 * The share sheet on a phone (`navigator.share`) so it lands in WhatsApp or WeChat in one tap; the
 * clipboard where there is no share sheet, with the button itself saying so. The text is built on
 * the device from the filtered cards (`lib/share/text.ts`); nothing is sent anywhere by this app.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { filterCards } from "@/lib/client/sample";
import type { StoredReading } from "@/lib/domain/schemas";
import { toScript } from "@/lib/i18n/script";
import { buildCards } from "@/lib/rules/card-order";
import { buildShareText } from "@/lib/share/text";

const COPIED_MS = 2500;

export default function ShareButton({ reading }: { reading: StoredReading }) {
  const { t, dialect, script } = useLocale();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const share = useCallback(async () => {
    const text = buildShareText(
      filterCards(buildCards(reading)),
      dialect,
      {
        title: t("share.title"),
        warnings: t("share.warnings"),
        medicines: t("share.medicines"),
        followUp: t("share.followUp"),
        other: t("share.other"),
        footer: t("share.footer"),
        disclaimer: t("disclaimer"),
      },
      (line) => toScript(line, script),
    );

    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // The reader closed the share sheet, or the clipboard was refused. Nothing to do.
    }
  }, [dialect, reading, script, t]);

  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-live="polite"
      className="tap chunky inline-flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-full border border-hairline bg-card px-5 text-[15px] font-semibold text-ink"
    >
      <ShareMark />
      {copied ? t("share.copied") : t("share.button")}
    </button>
  );
}

function ShareMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 4l5 4.2-5 4.2V4Z" />
      <path d="M16.5 8.2c-6.7 0-10.8 1.7-13.3 7.5" />
    </svg>
  );
}
