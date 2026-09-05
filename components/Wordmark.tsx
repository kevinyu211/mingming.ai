"use client";

/**
 * The wordmark: 明明, bold, with the small grey "AI" beside it the design ends its name with.
 *
 * Text, not an image, so it reads to a screen reader as the name and scales with the phone's own
 * text size. "AI" is a real word here — it is the one honest label the whole product rests on —
 * so it is --muted (5:1), never --faint.
 */
import { useT } from "@/components/LocaleProvider";

export default function Wordmark({ size = 17, className = "" }: { size?: number; className?: string }) {
  const t = useT();
  return (
    <span className={`inline-flex items-baseline gap-1.5 text-ink ${className}`}>
      <span className="font-bold" style={{ fontSize: size, lineHeight: 1 }}>
        {t("mascot.name")}
      </span>
      <span className="text-[12px] leading-none font-normal text-muted">{t("companion.ai")}</span>
    </span>
  );
}
