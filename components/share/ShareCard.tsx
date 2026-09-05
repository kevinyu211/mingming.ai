"use client";

/**
 * 出院卡 — the artboard's discharge card, as a PNG the reader can hand to WhatsApp or WeChat.
 *
 * The image is drawn on this device (`lib/share/png.ts`) from data built by rule
 * (`lib/share/card.ts`), shown here as a preview, and shared through the phone's own share sheet
 * with the file attached. Where the share sheet cannot take a file, the card is saved instead;
 * the plain-text version (`lib/share/text.ts`) stays one tap away for anyone who prefers words.
 *
 * Nothing is uploaded and no link is minted: the artboard's QR "to the real sheet" would need the
 * page to leave the phone, and it never does (constitution V). The card carries the AI line and
 * the disclaimer on its face, because once it is in someone else's chat the app is not there to
 * say them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { formatMonthDay, formatYmd } from "@/components/home/format";
import { filterCards } from "@/lib/client/sample";
import { scriptForDialect, toScript } from "@/lib/i18n/script";
import { buildCards } from "@/lib/rules/card-order";
import { buildShareCard } from "@/lib/share/card";
import { renderShareCardPng } from "@/lib/share/png";
import { buildShareText } from "@/lib/share/text";
import type { Sheet } from "@/lib/sheets/types";

const FILE_NAME = "discharge-card.png";
const NOTE_MS = 2500;

export default function ShareCard({ sheet, compact = false }: { sheet: Sheet; compact?: boolean }) {
  const { dialect, script, locale, t } = useLocale();
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const display = useCallback(
    (text: string) => (script === scriptForDialect(dialect) ? text : toScript(text, script)),
    [dialect, script],
  );

  // Draw once per sheet and language. The object URL is revoked when the card goes away.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const cards = filterCards(buildCards(sheet.reading));
    const data = buildShareCard({
      reading: sheet.reading,
      plan: sheet.plan,
      cards,
      dialect,
      title: sheet.title,
      dateLabel: formatMonthDay(sheet.reading.readAt, locale),
      visitDate: sheet.plan.followUpDate ? formatYmd(sheet.plan.followUpDate, locale) : "",
      strings: {
        eyebrow: t("share.cardEyebrow"),
        summaryTitle: t("share.summaryTitle"),
        summary: t("share.summary"),
        summaryVisit: t("share.summaryVisit"),
        countWarnings: t("count.warnings"),
        countMedicines: t("count.medicines"),
        countFollowUp: t("count.followUp"),
        countJoin: t("count.join"),
        warnings: t("share.warnings"),
        medicines: t("share.cardMeds"),
        visit: t("track.nextVisit"),
        printed: t("card.printed"),
        missingFrequency: t("card.missingFrequency"),
        more: t("share.more"),
        notes: t("share.notes"),
        stoppedLine: t("share.stoppedLine"),
        contactLine: t("share.contactLine"),
        aiLine: t("aiChip"),
        footer: t("share.footer"),
        disclaimer: t("disclaimer"),
      },
      display,
    });
    renderShareCardPng(data)
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // No canvas (an old WebView, a locked-down browser): the text share below still works.
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [dialect, display, locale, sheet, t]);

  const say = useCallback((text: string) => {
    setNote(text);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), NOTE_MS);
  }, []);

  const shareImage = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    const file = new File([blob], FILE_NAME, { type: "image/png" });
    try {
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch {
      // The reader closed the share sheet, or the sheet refused the file. Fall through to saving.
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    say(t("share.saved"));
  }, [say, t]);

  const shareText = useCallback(async () => {
    const text = buildShareText(
      filterCards(buildCards(sheet.reading)),
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
      display,
    );
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      say(t("share.copied"));
    } catch {
      // Closed, or refused. Nothing to do.
    }
  }, [dialect, display, say, sheet.reading, t]);

  return (
    <div className={compact ? "" : "surface p-4"}>
      <p className="text-[11px] font-medium tracking-[1.3px] text-muted uppercase">
        {t("share.cardEyebrow")}
      </p>
      <div className="mt-2.5 overflow-hidden rounded-[12px] border border-hairline bg-card">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- an object URL drawn on this phone
          <img src={url} alt={t("share.cardEyebrow")} className="block w-full" />
        ) : (
          <div aria-hidden="true" className="aspect-[4/5] w-full bg-neutral-2" />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void shareImage()}
          disabled={!url}
          className="chunky inline-flex min-h-12 items-center gap-2 rounded-full bg-ink px-4 text-[14px] font-semibold text-white disabled:opacity-50"
        >
          <ShareMark />
          {t("share.image")}
        </button>
        <button
          type="button"
          onClick={() => void shareText()}
          className="chunky inline-flex min-h-12 items-center rounded-full border border-hairline bg-card px-4 text-[14px] font-semibold text-ink"
        >
          {t("share.text")}
        </button>
      </div>
      {note ? (
        <p role="status" className="mt-2 text-[13px] text-muted">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function ShareMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
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
