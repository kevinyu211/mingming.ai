"use client";

/**
 * Desktop chrome around the existing screens.
 *
 * Below 1024 px this is a passthrough: the sidebar is `display: none`, the main column is an
 * ordinary flex child, and every phone layout (tab bar, max-w-md, hold-to-talk) is untouched.
 * From 1024 px the rail appears, the column fills the height above the disclaimer, and pages
 * opt into their desktop layout with `lg:` utilities of their own.
 */
import type { ReactNode } from "react";
import { useT } from "@/components/LocaleProvider";
import DesktopSidebar from "@/components/desktop/DesktopSidebar";

export default function DesktopShell({ children }: { children: ReactNode }) {
  const t = useT();

  return (
    <>
      <a href="#app-main" className="skip-link">
        {t("a11y.skip")}
      </a>
      <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100dvh-var(--disclaimer-height))] lg:flex-row lg:overflow-hidden">
        <DesktopSidebar />
        <div
          id="app-main"
          tabIndex={-1}
          className="flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto"
        >
          {children}
        </div>
      </div>
    </>
  );
}
