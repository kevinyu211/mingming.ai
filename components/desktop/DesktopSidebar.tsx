"use client";

/**
 * The desktop rail. Phone navigation stays the 96 px tab bar; this is `display: none` below
 * 1024 px so a phone never sees two ways to the same three screens.
 *
 * 明明 sits at the top in the animal's own plate, so picking 貓仔 is visible from across a desk
 * the same way it is from across a ward table. The active sheet, if there is one, is a quiet
 * fact at the bottom — a name, not a second list of sheets.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useT } from "@/components/LocaleProvider";
import Mascot from "@/components/Mascot";
import { homeUnread } from "@/components/home/conversation";
import { useSheets } from "@/components/home/useSheets";
import type { UiKey } from "@/lib/i18n/ui";

type NavId = "record" | "chat" | "track" | "settings";

const NAV: { id: Exclude<NavId, "settings">; href: string; label: UiKey }[] = [
  { id: "record", href: "/", label: "tab.record" },
  { id: "chat", href: "/chat", label: "tab.chat" },
  { id: "track", href: "/track", label: "tab.track" },
];

function navIdFor(pathname: string): NavId {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  if (pathname === "/chat" || pathname.startsWith("/chat/") || pathname === "/ask" || pathname === "/read") {
    return "chat";
  }
  if (pathname === "/track" || pathname.startsWith("/track/") || pathname === "/plan") return "track";
  return "record";
}

export default function DesktopSidebar() {
  const t = useT();
  const pathname = usePathname() ?? "/";
  const current = navIdFor(pathname);
  const { active } = useSheets();
  const pending = active != null && homeUnread(active);

  return (
    <aside
      className="desktop-sidebar hidden h-full min-h-0 w-[var(--sidebar-width)] shrink-0 flex-col border-r border-hairline lg:flex"
      aria-label={t("tab.navLabel")}
    >
      <div className="flex min-h-0 flex-1 flex-col px-3.5 pt-5 pb-4">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-[18px] px-2 py-1.5 no-underline outline-offset-4"
        >
          <span className="companion-plate grid h-14 w-14 shrink-0 place-items-center rounded-full">
            <Mascot size={44} state="idle" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[18px] leading-tight font-bold text-ink">
              {t("mascot.name")}
            </span>
            <span className="mt-0.5 block text-[12px] leading-tight font-medium tracking-[0.04em] text-muted">
              Ming Ming
            </span>
          </span>
        </Link>

        <nav className="mt-7 flex flex-col gap-1" aria-label={t("tab.navLabel")}>
          {NAV.map((item) => (
            <NavLink
              key={item.id}
              href={item.href}
              label={t(item.label)}
              active={current === item.id}
              pending={item.id === "chat" && pending}
              pendingLabel={t("tab.chatPending")}
              icon={<NavIcon id={item.id} />}
            />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 pt-6">
          {active ? (
            <Link
              href="/chat"
              className="surface block rounded-[16px] px-3.5 py-3 no-underline outline-offset-4"
            >
              <span className="block text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
                {t("home.nowTalking")}
              </span>
              <span className="mt-1 block truncate text-[14px] leading-snug font-semibold text-ink">
                {active.title}
              </span>
            </Link>
          ) : null}

          <NavLink
            href="/settings"
            label={t("settings.title")}
            active={current === "settings"}
            icon={<GearGlyph />}
          />
        </div>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  active,
  icon,
  pending = false,
  pendingLabel,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
  pending?: boolean;
  pendingLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-11 items-center gap-3 rounded-[14px] px-3 text-[15px] no-underline outline-offset-4 transition-colors duration-150 ${
        active
          ? "bg-card font-semibold text-ink shadow-card"
          : "font-medium text-muted hover:bg-card/70 hover:text-ink"
      }`}
    >
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
          active ? "companion-plate companion-ink" : ""
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {pending ? (
        <>
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-warn-dot" />
          {pendingLabel ? <span className="sr-only">{pendingLabel}</span> : null}
        </>
      ) : null}
    </Link>
  );
}

function NavIcon({ id }: { id: Exclude<NavId, "settings"> }) {
  const common = {
    width: 18,
    height: 18,
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true,
    focusable: false as const,
  };

  if (id === "record") {
    return (
      <svg viewBox="0 0 20 21" {...common}>
        <rect x="3" y="1.6" width="14" height="17.8" rx="3" />
        <path d="M6.6 6.4h6.8M6.6 10.4h6.8M6.6 14.4h4" strokeLinecap="round" />
      </svg>
    );
  }

  if (id === "chat") {
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

function GearGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a1.9 1.9 0 1 1 0-3.8h.3a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 2.8-1.1v-.2a1.9 1.9 0 1 1 3.8 0v.3a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1.1Z" />
    </svg>
  );
}
