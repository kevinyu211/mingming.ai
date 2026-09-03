"use client";

/**
 * S4 — the reading.
 *
 * Three ways to arrive, in the order they are tried:
 *   `?sample=hk_en`   a bundled sheet (FR-023), banner and all;
 *   pending images    the pages `components/Capture.tsx` just downscaled;
 *   stored reading    what is already on the phone, so coming back from /ask keeps the stack.
 *
 * **The one transient use of image bytes.** `sessionStorage["fitornot.pending-images"]` exists
 * only to carry the downscaled pages across a single client navigation, because a route change
 * cannot take a File in its URL. It is read once and removed in a `finally` before the request
 * even resolves, so the bytes live in this tab for a few milliseconds and nowhere else. Images
 * are never written to localStorage, never included in a stored reading, and never logged
 * (FR-018, constitution principle V).
 *
 * Every path that stores a reading also records it in on-device memory (`lib/memory/`), so the
 * agent is still continuous tomorrow. The call is idempotent — entries key on `readAt` — so
 * coming back from /ask updates the entry rather than adding a second one.
 *
 * Nothing speaks on its own: iOS needs a user gesture before audio, and the play cue in
 * `CardStack` is that gesture. Audio for every card is warmed as soon as the reading lands, so
 * the tap is answered immediately rather than after a fetch.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import AgentLimits from "@/components/AgentLimits";
import CardStack from "@/components/CardStack";
import DeclineState, { type DeclineVariant } from "@/components/DeclineState";
import { useLocale } from "@/components/LocaleProvider";
import ProgressLine, { type ProgressStep } from "@/components/ProgressLine";
import SampleBanner from "@/components/SampleBanner";
import UiLanguageToggle from "@/components/UiLanguageToggle";
import { PENDING_IMAGES_KEY } from "@/components/Capture";
import { DEFAULT_SAMPLE, filterCards, isSampleId, loadSampleReading } from "@/lib/client/sample";
import { readSheet, type ImageInput } from "@/lib/client/read-stream";
import { downscale } from "@/lib/image/downscale";
import type { Card } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";
import { rememberReading } from "@/lib/memory";
import { buildCards } from "@/lib/rules/card-order";
import { CAUTION_SUFFIX } from "@/lib/rules/template-fallback";
import { prefetch } from "@/lib/speech/tts";
import { loadState, saveReading, subscribe } from "@/lib/storage/local";

/** Copy with no key in `lib/i18n/ui.ts`. `plan.title` is the screen's own, longer heading. */
const LOCAL: Record<"plan", Record<UiLocale, string>> = {
  plan: { hant: "計劃", hans: "计划", en: "Plan" },
};

export default function ReadPage() {
  // useSearchParams needs a boundary; the fallback is the same first step the reading starts on.
  return (
    <Suspense fallback={<Booting />}>
      <ReadScreen />
    </Suspense>
  );
}

function Booting() {
  return <div className="mx-auto w-full max-w-md flex-1 px-5 pt-4" aria-hidden="true" />;
}

/** Long edge for the one retry after a 413 (contracts/api-read.md). 1200 px keeps 9 pt print legible. */
const RETRY_LONG_EDGE = 1200;

/**
 * Re-encodes already-downscaled pages at a smaller long edge, in memory only. Returns null when
 * the browser cannot decode them, in which case the caller shows the honest decline instead.
 */
async function shrinkImages(images: ImageInput[], maxLongEdge: number): Promise<ImageInput[] | null> {
  try {
    const smaller: ImageInput[] = [];
    for (const image of images) {
      const blob = await (await fetch(`data:${image.mediaType};base64,${image.base64}`)).blob();
      const { mediaType, base64 } = await downscale(blob, maxLongEdge);
      smaller.push({ mediaType, base64 });
    }
    return smaller;
  } catch {
    return null;
  }
}

type Status = "loading" | "cards" | "declined";

function ReadScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dialect, locale, t } = useLocale();

  const [status, setStatus] = useState<Status>("loading");
  const [step, setStep] = useState<ProgressStep>(1);
  /** True while the audio for the arrived cards is being warmed — the third progress step. */
  const [preparing, setPreparing] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [sample, setSample] = useState(false);
  const [variant, setVariant] = useState<DeclineVariant>("notASheet");
  const started = useRef(false);

  const profileLabel = useProfileLabel();

  /** Warm the audio for every card, in the dialect on screen, caution sentence included. */
  const warm = useCallback(
    async (list: Card[]) => {
      setStep(3);
      setPreparing(true);
      try {
        await prefetch(
          list.map((card) => ({
            text: `${card.body[dialect]} ${CAUTION_SUFFIX[dialect]}`,
            dialect,
          })),
        );
      } finally {
        setPreparing(false);
      }
    },
    [dialect],
  );

  const showSample = useCallback(async () => {
    setStatus("loading");
    setStep(1);
    const { reading, cards: sampleCards } = await loadSampleReading(DEFAULT_SAMPLE);
    saveReading(reading);
    rememberReading(reading, dialect);
    setCards(sampleCards);
    setSample(true);
    setStatus("cards");
    await warm(sampleCards);
  }, [dialect, warm]);

  const decline = useCallback((next: DeclineVariant) => {
    setVariant(next);
    setStatus("declined");
  }, []);

  const begin = useCallback(async () => {
    const requested = searchParams.get("sample");
    if (isSampleId(requested)) {
      const { reading, cards: sampleCards } = await loadSampleReading(requested);
      saveReading(reading);
      rememberReading(reading, dialect);
      setCards(sampleCards);
      setSample(true);
      setStatus("cards");
      await warm(sampleCards);
      return;
    }

    const images = takePendingImages();
    if (images) {
      const arriving: Card[] = [];
      const handlers = {
        onStatus: () => setStep(1),
        onCard: (card: Card) => {
          arriving.push(card);
          setCards([...arriving]);
          setStep(2);
          setStatus("cards");
        },
      };
      let outcome = await readSheet(images, handlers);

      // contracts/api-read.md: on 413 the client re-downscales and retries once. The pages are
      // shrunk further in memory (never stored) and sent again; a second 413 falls through to the
      // honest decline below.
      if (outcome.kind === "too_large") {
        const smaller = await shrinkImages(images, RETRY_LONG_EDGE);
        if (smaller) outcome = await readSheet(smaller, handlers);
      }

      switch (outcome.kind) {
        case "reading":
          saveReading(outcome.reading);
          rememberReading(outcome.reading, dialect);
          setCards(outcome.cards);
          setSample(false);
          setStatus("cards");
          await warm(outcome.cards);
          return;
        case "unknown":
          setCards([]);
          decline("notASheet");
          return;
        case "invalid_reading":
        case "bad_request":
        case "too_large":
          setCards([]);
          decline("invalidReading");
          return;
        case "model_unavailable":
          setCards([]);
          decline("modelUnavailable");
          return;
      }
    }

    // Nothing new to read: show what is already on the phone (coming back from /ask).
    const stored = loadState().reading;
    if (stored) {
      // Rebuilt cards have not been through the route's filter, so run the gate again here.
      const rebuilt = filterCards(buildCards(stored));
      setCards(rebuilt);
      setSample(stored.sample === true);
      setStatus("cards");
      await warm(rebuilt);
      return;
    }

    router.replace("/");
  }, [decline, dialect, router, searchParams, warm]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  const busy = status === "loading" || preparing;

  return (
    // pb-28 leaves room for CardStack's sticky bar, which sits above the fixed disclaimer.
    <main className="mx-auto w-full max-w-md flex-1 px-5 pt-[22px] pb-28">
      {/* The iOS large title: the sheet, then in one quiet line who it is being read to. */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-display font-bold text-ink">{t("cards.header")}</h1>
          {profileLabel ? (
            <p className="mt-0.5 text-meta text-muted">
              {t("cards.forLabel").replace("{label}", profileLabel)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* S8 is reached from here: the plan is only offered once a sheet has been read. */}
          <Link
            href="/plan"
            className="tap rounded-full px-1 text-meta font-semibold text-accent underline underline-offset-4"
          >
            {LOCAL.plan[locale]}
          </Link>
          <UiLanguageToggle />
        </div>
      </header>

      {status === "declined" ? (
        <div className="mt-4">
          <DeclineState
            variant={variant}
            onRetake={() => router.push("/")}
            onSample={() => void showSample()}
          />
          <AgentLimits className="mt-6" />
        </div>
      ) : (
        <div className="mt-4">
          {busy ? <ProgressLine step={step} className="mb-2" /> : null}
          <CardStack cards={cards} showPlayCue={!busy} address={profileLabel}>
            {sample ? <SampleBanner /> : null}
          </CardStack>
          <AgentLimits className="mt-6" />
        </div>
      )}
    </main>
  );
}

/**
 * Reads the pages Capture left behind and deletes them in the same breath. Returns null when
 * there is nothing pending or the payload is not what Capture writes.
 */
function takePendingImages(): ImageInput[] | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_IMAGES_KEY);
    if (raw === null) return null;
  } catch {
    return null;
  } finally {
    // Always, even if the parse below throws: the bytes do not get a second chance to linger.
    try {
      window.sessionStorage.removeItem(PENDING_IMAGES_KEY);
    } catch {
      // Private mode. Nothing was written, so nothing is left.
    }
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const images: ImageInput[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) return null;
      const { mediaType, base64 } = entry as { mediaType?: unknown; base64?: unknown };
      if (mediaType !== "image/jpeg" || typeof base64 !== "string" || base64.length === 0) {
        return null;
      }
      images.push({ mediaType, base64 });
    }
    return images;
  } catch {
    return null;
  }
}

/**
 * The relationship label, if there is a profile. The snapshot is a primitive on purpose:
 * `loadState()` parses a fresh object every call, which `useSyncExternalStore` would loop on.
 */
function readProfileLabel(): string {
  return loadState().profile?.label ?? "";
}
function serverProfileLabel(): string {
  return "";
}
function useProfileLabel(): string {
  return useSyncExternalStore(subscribe, readProfileLabel, serverProfileLabel);
}
