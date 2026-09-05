"use client";

/**
 * 拍張紙 / 上載相片 — the two ways in (Companion D, "Three Things").
 *
 * `lg` is the start screen: two big rows, the charcoal one to take a photo and the white one to
 * upload a photo someone sent you, each with a line saying what it is for. `sm` is the same pair
 * as two pills, for a 記錄 that already has a sheet on it.
 *
 * Both are `<Link>`s to `/capture`, because a navigation must be a real anchor: long-press,
 * middle-click and "open in new tab" all keep working, and `?pick=1` is the only thing that tells
 * the capture screen to open the photo picker on arrival. Nothing here knows whether this device
 * has a camera — `/capture` detects that and says so honestly one tap in.
 */
import Link from "next/link";
import { useT } from "@/components/LocaleProvider";

export type CaptureButtonsSize = "lg" | "sm";

export default function CaptureButtons({ size = "lg" }: { size?: CaptureButtonsSize }) {
  const t = useT();

  if (size === "lg") {
    return (
      <div className="flex flex-col gap-2.5">
        <Link
          href="/capture"
          className="chunky flex min-h-12 items-center gap-4 rounded-[20px] bg-ink p-5 text-white no-underline"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-charcoal-elevated">
            <CameraGlyph stroke="#ffffff" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[19px] leading-[1.25] font-bold">{t("capture.photo")}</span>
            <span className="mt-0.5 block text-[14px] leading-[1.35] text-on-dark-muted">
              {t("companion.takePhotoSub")}
            </span>
          </span>
          <span aria-hidden="true" className="text-[20px] leading-none text-on-dark-muted">
            ›
          </span>
        </Link>

        <Link
          href="/capture?pick=1"
          className="chunky flex min-h-12 items-center gap-4 rounded-[20px] border border-hairline bg-card p-5 text-ink no-underline"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ground">
            <UploadGlyph />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[19px] leading-[1.25] font-bold">{t("capture.upload")}</span>
            <span className="mt-0.5 block text-[14px] leading-[1.35] text-muted">
              {t("companion.uploadSub")}
            </span>
          </span>
          <span aria-hidden="true" className="text-[20px] leading-none text-faint">
            ›
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <Link
        href="/capture"
        className="chunky flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-ink px-4 text-[15px] font-semibold text-white no-underline"
      >
        <CameraGlyph stroke="#ffffff" size={18} />
        {t("capture.photo")}
      </Link>
      <Link
        href="/capture?pick=1"
        className="chunky flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-hairline bg-card px-4 text-[15px] font-semibold text-ink no-underline"
      >
        <UploadGlyph />
        {t("capture.upload")}
      </Link>
    </div>
  );
}

function CameraGlyph({ stroke, size = 24 }: { stroke: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M9 6l1.4-2h3.2L15 6" />
    </svg>
  );
}

function UploadGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 16V5M8 9l4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
