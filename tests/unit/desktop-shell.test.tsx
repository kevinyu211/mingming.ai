/**
 * Desktop chrome must exist in the markup and stay dark on a phone.
 *
 * The product is still a phone app at every viewport Playwright uses (390×844, 360×800). The
 * rail, the skip link and the ChatGPT-shaped composer are `lg:` / `hidden lg:` so they cannot
 * steal a tap target or a landmark from the tab bar, the hold-to-talk bar, or the 92 px greeting.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import TabBar from "@/components/TabBar";
import { LocaleProvider } from "@/components/LocaleProvider";
import DesktopSidebar from "@/components/desktop/DesktopSidebar";
import DesktopShell from "@/components/desktop/DesktopShell";
import DesktopComposer from "@/components/desktop/DesktopComposer";
import ChatBar from "@/components/chat/ChatBar";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    className?: string;
    [key: string]: unknown;
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

function wrap(node: ReactNode): string {
  return renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
}

describe("the desktop rail is dark on a phone", () => {
  it("is hidden below the lg breakpoint, and a flex column from there", () => {
    const html = wrap(<DesktopSidebar />);
    expect(html).toContain("hidden");
    expect(html).toContain("lg:flex");
    expect(html).toContain("desktop-sidebar");
  });

  it("keeps 明明 and the three tabs, plus Settings", () => {
    const html = wrap(<DesktopSidebar />);
    expect(html).toContain("/mascot/panda/idle.webp");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/chat"');
    expect(html).toContain('href="/track"');
    expect(html).toContain('href="/settings"');
  });
});

describe("the phone tab bar is the only navigation under 1024 px", () => {
  it("hides itself on desktop rather than sitting under the rail", () => {
    const html = wrap(<TabBar active="record" />);
    expect(html).toContain("lg:hidden");
    expect(html).toContain("bottom-[var(--disclaimer-height)]");
  });
});

describe("the desktop shell skips the rail for keyboard users", () => {
  it("offers a skip link at the document start", () => {
    const html = wrap(<DesktopShell>child</DesktopShell>);
    expect(html).toContain('href="#app-main"');
    expect(html).toContain("skip-link");
    expect(html).toContain('id="app-main"');
    expect(html).toContain("child");
  });
});

describe("the ChatGPT-shaped composer does not land on a phone", () => {
  it("is hidden below lg, so the hold-to-talk bar stays the only control", () => {
    const composer = wrap(
      <DesktopComposer language="yue" locale="hant" busy={false} onSend={() => {}} />,
    );
    expect(composer).toContain("hidden");
    expect(composer).toContain("lg:block");

    const bar = wrap(<ChatBar language="yue" locale="hant" busy={false} onSend={() => {}} />);
    const buttons = bar.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
  });
});

describe("home still greets with the 92 px companion on an empty phone", () => {
  it("did not reorder the greeting above the camera pair", () => {
    const src = readFileSync(new URL("../../components/home/HomeScreen.tsx", import.meta.url), "utf8");
    expect(src).toContain('<Mascot size={92} state="greeting" />');
    const plate = src.indexOf('<Mascot size={92} state="greeting" />');
    const cameras = src.indexOf("<CaptureButtons size=\"lg\" />");
    expect(plate).toBeGreaterThan(-1);
    expect(cameras).toBeGreaterThan(plate);
  });
});
