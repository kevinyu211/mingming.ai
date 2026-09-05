"use client";

/**
 * 分享俾屋企人 — opens the discharge card (Companion D) in a sheet: the PNG to share, and the
 * plain-text version one tap behind it. The text is built on the device from the filtered cards
 * (`lib/share/text.ts`) and the image from the same facts (`lib/share/card.ts`); nothing is sent
 * anywhere by this app.
 */
import { useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import { useLocale } from "@/components/LocaleProvider";
import ShareCard from "@/components/share/ShareCard";
import type { Sheet } from "@/lib/sheets/types";

export default function ShareButton({ sheet }: { sheet: Sheet }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap chunky inline-flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-full border border-hairline bg-card px-5 text-[15px] font-semibold text-ink"
      >
        <ShareMark />
        {t("share.button")}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("share.button")}>
        <ShareCard sheet={sheet} compact />
      </BottomSheet>
    </>
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
