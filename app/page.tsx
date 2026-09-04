"use client";

/**
 * 記錄 — the way in (brief §1).
 *
 * The consent gate in `app/layout.tsx` has already run. What used to sit here was the v1 camera
 * screen, which redirected a phone with no profile to `/setup` before it would show anything; the
 * three-tab flow makes 記錄 the entry point instead, so there is no redirect.
 *
 * A phone with no profile works, and in v2 that is every phone: nothing links to `/setup` any
 * more, and nothing needs to. The dialect is changed from the language chip in the chat header and
 * the interface language from the gear, and both now persist on their own — `LocaleProvider`
 * writes a profile if there is none, which it did not used to do, so a language chosen on a fresh
 * phone survives a reload. The one thing `/setup` still collects is the relationship label, and
 * no screen in this build displays it.
 */
import HomeScreen from "@/components/home/HomeScreen";

export default function Home() {
  return <HomeScreen />;
}
