"use client";

/**
 * The two launch demo paths on empty 記錄: English and Traditional Chinese.
 *
 * Photographing a real sheet is the product. These links exist so Kevin (or a judge with no
 * camera and no live model) can still finish the happy path in under three minutes. Both sheets
 * are synthetic fixtures; `sample: true` keeps the banner on.
 */
import Link from "next/link";
import { useT } from "@/components/LocaleProvider";
import { LAUNCH_SAMPLES } from "@/lib/client/sample";

const HREF: Record<(typeof LAUNCH_SAMPLES)[number], string> = {
  demo_en: "/chat?sample=demo_en",
  demo_zh_hant: "/chat?sample=demo_zh_hant",
};

const LABEL: Record<(typeof LAUNCH_SAMPLES)[number], "home.demoEn" | "home.demoZh"> = {
  demo_en: "home.demoEn",
  demo_zh_hant: "home.demoZh",
};

export default function DemoPaths() {
  const t = useT();

  return (
    <div className="mt-5">
      <p className="mb-2 px-0.5 text-[13px] font-semibold text-muted">{t("home.demoLead")}</p>
      <div className="flex flex-col gap-2">
        {LAUNCH_SAMPLES.map((id) => (
          <Link
            key={id}
            href={HREF[id]}
            className="chunky flex min-h-12 items-center justify-between rounded-[16px] border border-hairline bg-card px-4 text-[15px] font-semibold text-ink no-underline"
          >
            <span>{t(LABEL[id])}</span>
            <span aria-hidden="true" className="text-[18px] leading-none text-faint">
              ›
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
