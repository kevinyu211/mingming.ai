"use client";

/**
 * 記錄 / 傾偈 / 跟進 — the three tabs, 96px tall, from the design canvas.
 *
 * It is told what is active and whether a check-in is waiting; it reads no storage and owns no
 * state. That is deliberate: the pending flag comes from the ONE active sheet (`checkin ===
 * "pending"`), and a tab bar that went and looked for itself could disagree with the screen it is
 * sitting under.
 *
 * `/chat` and `/capture` are full-screen and hide the bar entirely (brief section 1) — that is the
 * caller's decision, made by not rendering this.
 */
import Link from "next/link";
import { useT } from "@/components/LocaleProvider";

export type TabKey = "record" | "chat" | "track";

export interface TabBarProps {
  active: TabKey;
  /**
   * A check-in is waiting in the thread. Draws the amber unread dot over 傾偈 and adds a
   * visually-hidden line so a screen reader hears it too — a dot alone says nothing out loud.
   */
  pending?: boolean;
  className?: string;
}

/** The bar's own height. Screens reserve this much bottom padding so nothing hides under it. */
export const TAB_BAR_HEIGHT = 96;

const TABS: { key: TabKey; href: string; labelKey: "tab.record" | "tab.chat" | "tab.track" }[] = [
  { key: "record", href: "/", labelKey: "tab.record" },
  { key: "chat", href: "/chat", labelKey: "tab.chat" },
  { key: "track", href: "/track", labelKey: "tab.track" },
];

export default function TabBar({ active, pending = false, className = "" }: TabBarProps) {
  const t = useT();

  return (
    <nav
      aria-label={t("tab.navLabel")}
      className={`fixed inset-x-0 bottom-[var(--disclaimer-height)] z-30 flex border-t border-hairline bg-ground px-1.5 pt-2.5 ${className}`}
      style={{ height: TAB_BAR_HEIGHT }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        // --jade-ink 5.67:1 on the ground; --muted 5.03:1. Both readable, which is the point:
        // an inactive tab is still a label someone has to be able to read.
        const colour = isActive ? "var(--jade-ink)" : "var(--muted)";
        const showDot = tab.key === "chat" && pending;

        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className="relative flex min-h-12 flex-1 flex-col items-center justify-start gap-[5px] py-2"
            style={{ color: colour }}
          >
            <TabIcon tab={tab.key} />
            {showDot && (
              <>
                <span
                  aria-hidden="true"
                  className="absolute top-1 h-[11px] w-[11px] rounded-full border-2 border-ground bg-warn-dot"
                  style={{ left: "calc(50% + 9px)" }}
                />
                <span className="sr-only">{t("tab.chatPending")}</span>
              </>
            )}
            <span className="text-[14px] font-medium">{t(tab.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** The canvas's own three icons, stroked in `currentColor` so the active state is one variable. */
function TabIcon({ tab }: { tab: TabKey }) {
  const common = {
    width: 26,
    height: 26,
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true,
    focusable: false as const,
  };

  if (tab === "record") {
    return (
      <svg viewBox="0 0 20 21" {...common}>
        <rect x="3" y="1.6" width="14" height="17.8" rx="3" />
        <path d="M6.6 6.4h6.8M6.6 10.4h6.8M6.6 14.4h4" strokeLinecap="round" />
      </svg>
    );
  }

  if (tab === "chat") {
    return (
      <svg viewBox="0 0 21 21" {...common}>
        <path
          d="M10.5 2.2c4.6 0 8.3 3 8.3 6.8s-3.7 6.8-8.3 6.8c-1 0-2-.1-2.9-.4L3.4 17.6l1-3.3A6.6 6.6 0 0 1 2.2 9c0-3.8 3.7-6.8 8.3-6.8Z"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 21 21" {...common}>
      <rect x="2.2" y="3.4" width="16.6" height="15.4" rx="3" />
      <path d="M6.4 1.8v3.2M14.6 1.8v3.2M2.2 8.4h16.6" strokeLinecap="round" />
    </svg>
  );
}
