import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import CompanionTheme from "@/components/CompanionTheme";
import ConsentGate from "@/components/ConsentGate";
import DesktopShell from "@/components/desktop/DesktopShell";
import Disclaimer from "@/components/Disclaimer";
import Warmer from "@/components/Warmer";
import { LocaleProvider } from "@/components/LocaleProvider";
import "./globals.css";

/**
 * Latin type only.
 *
 * next/font self-hosts this at build time, so the phone never talks to Google: no third-party
 * request from a health app (constitution V), and nothing to fail on venue wifi at run time.
 * `subsets: ["latin"]` keeps it to roughly 30 kB across the four weights, and `display: "swap"`
 * means a slow first paint shows the system face rather than nothing.
 *
 * There is deliberately NO web font for Chinese. A CJK face is several megabytes PER WEIGHT; this
 * gets demoed on conference wifi in Hong Kong and a mother waiting on a 4 MB download to hear her
 * discharge sheet read out is a failed demo. Chinese uses the system HK stack (--font-hk in
 * globals.css): PingFang HK on every iPhone, Noto Sans CJK HK on every Android — which is what the
 * design canvas's Noto Sans HK was standing in for.
 */
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument-sans",
  // If the download is ever unavailable, Latin text still lands in the platform UI face.
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Ming Ming · 明明",
  description:
    "Photograph a hospital discharge sheet and hear it explained plainly, in Cantonese, Mandarin or English — warning signs first.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    // Short on purpose: iOS truncates the home-screen label, so the bilingual form would clip.
    title: "Ming Ming",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  // The ground. The status bar sits on the same light grey as the page.
  themeColor: "#F3F3F5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-HK" className={`${instrumentSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-ground text-ink">
        <LocaleProvider>
          <CompanionTheme />
          <DesktopShell>
            <ConsentGate>{children}</ConsentGate>
          </DesktopShell>
          {/* Outside the gate on purpose: the disclaimer shows on the consent screen too. */}
          <Disclaimer />
          <Warmer />
        </LocaleProvider>
      </body>
    </html>
  );
}
