"use client";

/**
 * 拍張紙 / 上載相片 — the pair at the top of 記錄, in the canvas's two sizes.
 *
 * Split in two equal halves on purpose (canvas note 5): the adult child photographing the sheet at
 * the ward window is at least as likely as the parent shooting it herself, so the photo library is
 * an equal way in rather than a fallback hidden behind an overflow menu.
 *
 * Both are links into `/capture`, which owns the camera, the picker and the six-page ceiling.
 * `?pick=1` is the only difference: it opens the photo picker on arrival. Nothing here knows
 * whether this device has a camera — `/capture` detects that and says so honestly one tap in,
 * which is the same answer the v1 screen gave and the only place the truth is knowable.
 *
 * They are `<Link>`s wearing `.chunky` rather than `ChunkyButton`s, because a navigation must be a
 * real anchor: long-press, middle-click and "open in new tab" all have to keep working, and a
 * button that calls `router.push` breaks every one of them.
 */
import Link from "next/link";
import { useT } from "@/components/LocaleProvider";

export type CaptureButtonsSize = "lg" | "sm";

const SIZE = {
  lg: { padding: "28px 16px", radius: 22, gap: 14, icon: 46, label: 23, sub: true },
  sm: { padding: "20px 14px", radius: 20, gap: 10, icon: 34, label: 21, sub: false },
} as const;

export default function CaptureButtons({ size = "lg" }: { size?: CaptureButtonsSize }) {
  const t = useT();
  const s = SIZE[size];

  return (
    <div className="flex gap-3">
      <Tile
        href="/capture"
        variant="jade"
        size={size}
        label={t("capture.photo")}
        sub={s.sub ? t("capture.photoSub") : null}
        icon={<CameraGlyph width={s.icon} />}
      />
      <Tile
        href="/capture?pick=1"
        variant="tinted"
        size={size}
        label={t("capture.upload")}
        sub={s.sub ? t("capture.uploadSub") : null}
        icon={<PhotosGlyph width={s.icon} />}
      />
    </div>
  );
}

function Tile({
  href,
  variant,
  size,
  label,
  sub,
  icon,
}: {
  href: string;
  variant: "jade" | "tinted";
  size: CaptureButtonsSize;
  label: string;
  sub: string | null;
  icon: React.ReactNode;
}) {
  const s = SIZE[size];
  const jade = variant === "jade";

  return (
    <Link
      href={href}
      className="chunky flex min-h-12 flex-1 flex-col items-center no-underline"
      style={{
        // `.chunky` reads this for the 4px hard edge it sinks into on press.
        ["--chunky-edge" as string]: jade ? "var(--jade-shadow)" : "var(--jade-edge)",
        background: jade ? "var(--jade)" : "var(--jade-tint)",
        color: jade ? "#ffffff" : "var(--jade-ink)",
        borderRadius: s.radius,
        padding: s.padding,
        gap: s.gap,
      }}
    >
      {icon}
      <span className="text-center">
        <span className="block font-bold" style={{ fontSize: s.label, lineHeight: 1.25 }}>
          {label}
        </span>
        {sub ? (
          /*
           * The canvas prints this gloss at rgba(255,255,255,.74) on jade and rgba(20,112,90,.68)
           * on the tint — 3.2:1 and 2.9:1, both under AA for a 13.5px line that is real text a
           * bystander is expected to read. It is solid here instead: white is 5.05:1 on --jade and
           * --jade-ink is 5.34:1 on --jade-tint. Weight, not opacity, keeps it secondary.
           */
          <span className="mt-[3px] block font-normal opacity-100" style={{ fontSize: 13.5, lineHeight: 1.35 }}>
            {sub}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function CameraGlyph({ width }: { width: number }) {
  return (
    <svg
      width={width}
      height={Math.round((width * 41) / 46)}
      viewBox="0 0 27 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.4" y="5.4" width="24.2" height="17.2" rx="4" />
      <path d="M9 5.2 10.5 1.4h5.9L18 5.2" strokeLinejoin="round" />
      <circle cx="13.5" cy="13.8" r="4.7" />
    </svg>
  );
}

function PhotosGlyph({ width }: { width: number }) {
  return (
    <svg
      width={width}
      height={Math.round((width * 41) / 46)}
      viewBox="0 0 27 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.4" y="3.4" width="24.2" height="19.2" rx="4" />
      <path d="M1.6 17.4l6.6-5.6 5.4 4.6 3.6-3 8.2 6.8" strokeLinejoin="round" />
      <circle cx="8.4" cy="8.6" r="2.3" />
    </svg>
  );
}
