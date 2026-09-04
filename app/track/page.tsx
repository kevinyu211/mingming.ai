"use client";

/**
 * 跟進 — the third tab (brief §1, §7). The screen itself is `components/track/TrackScreen.tsx`;
 * this route is the entry point the tab bar links to, and the destination `/plan` now redirects to.
 */
import TrackScreen from "@/components/track/TrackScreen";

export default function TrackPage() {
  return <TrackScreen />;
}
