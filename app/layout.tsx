import type { Metadata, Viewport } from "next";
import ConsentGate from "@/components/ConsentGate";
import Disclaimer from "@/components/Disclaimer";
import { LocaleProvider } from "@/components/LocaleProvider";
import "./globals.css";

// Fonts are system stacks defined in globals.css (--font-noto-tc / --font-noto-sc / --font-inter
// resolve to PingFang, Hiragino, Noto Sans CJK or Microsoft YaHei depending on the phone).
// No Google Fonts fetch: it fails on mainland networks at build time, costs megabytes per CJK
// weight on the venue Wi-Fi, and every target phone already ships a good CJK face.

export const metadata: Metadata = {
  title: "聽得明",
  description:
    "Photograph a hospital discharge sheet and hear it explained in Cantonese or Mandarin, warning signs first.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "聽得明",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0F6E68",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-HK" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-ground text-ink">
        <LocaleProvider>
          <ConsentGate>{children}</ConsentGate>
          {/* Outside the gate on purpose: the disclaimer shows on the consent screen too. */}
          <Disclaimer />
        </LocaleProvider>
      </body>
    </html>
  );
}
