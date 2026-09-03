"use client";

/**
 * S3 — the way in.
 *
 * The consent gate in the layout has already run. What happens next depends on one thing only:
 * whether this phone has a profile. With one, the camera is the first thing on screen and both
 * of setup's questions are already answered. Without one, this route hands over to `/setup`
 * (T035): the app asks who you cook for and what they listen in *before* it asks for a sheet, so
 * the very first reading is already in the right language and addressed to the right person.
 *
 * The redirect replaces the session-language pick that used to live here. A language tap alone
 * was never a profile — FR-016's profile needs a relationship label the person chose — and
 * asking half the question twice was worse than asking the whole question once.
 */
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Capture from "@/components/Capture";
import { useLocale } from "@/components/LocaleProvider";
import { loadState, subscribe } from "@/lib/storage/local";

/**
 * Primitive snapshots: `loadState()` parses fresh objects, which `useSyncExternalStore` bans.
 * The label is read for the one-line subtitle under the large title; nothing else is read here.
 */
function readHasProfile(): string {
  return loadState().profile ? "1" : "0";
}
function serverHasProfile(): string {
  return "0";
}
function readProfileLabel(): string {
  return loadState().profile?.label ?? "";
}
function readProfileDialect(): string {
  return loadState().profile?.dialect ?? "";
}
function serverEmpty(): string {
  return "";
}

export default function Home() {
  const router = useRouter();
  const { hydrated, t } = useLocale();
  const hasProfile = useSyncExternalStore(subscribe, readHasProfile, serverHasProfile) === "1";
  const label = useSyncExternalStore(subscribe, readProfileLabel, serverEmpty);
  const dialect = useSyncExternalStore(subscribe, readProfileDialect, serverEmpty);

  useEffect(() => {
    // `hydrated` guards the first client render, when the stored profile has not been read yet.
    if (hydrated && !hasProfile) router.replace("/setup");
  }, [hasProfile, hydrated, router]);

  // 阿媽 · 廣東話: who the reading is for, and what they will hear it in.
  const subtitle = [label, dialect === "cmn" ? t("language.cmn") : dialect ? t("language.yue") : ""]
    .filter((part) => part.length > 0)
    .join(" · ");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-[22px] pb-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The large title carries the line 影低張出院紙 (design.md S3); the shutter below
              says only 影相, and keeps this as its accessible name. */}
          <h1 id="capture-heading" className="text-display font-bold text-ink">
            {t("capture.title")}
          </h1>
          {hydrated && subtitle ? (
            <p className="mt-0.5 text-meta text-muted">{subtitle}</p>
          ) : null}
        </div>
        <Link
          href="/settings"
          aria-label={t("settings.title")}
          className="tap shrink-0 rounded-full bg-card text-muted shadow-card"
        >
          <GearGlyph />
        </Link>
      </header>

      {hydrated && hasProfile ? (
        <section aria-labelledby="capture-heading" className="mt-[18px] flex flex-1 flex-col">
          <Capture />
        </section>
      ) : (
        // Either the profile has not been read yet or setup is one tick away. Neither is a
        // moment to flash a camera tile at someone.
        <div className="mt-10 h-40" aria-hidden="true" />
      )}
    </main>
  );
}

function GearGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5"
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
