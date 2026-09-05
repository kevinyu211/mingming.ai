"use client";

/**
 * `/capture` — getting the pages in (brief §7).
 *
 * ## Why six pages, and why the ceiling shouts
 *
 * A Hong Kong patient does not leave with *a* discharge sheet. The Hospital Authority's own
 * discharge checklist (docs/real-sheet-evidence.md) tells them to walk out holding 出院紙, 覆診紙,
 * 抽血紙 and 治療處方 — and the follow-up date is printed on a different piece of paper from the
 * medicines. A tool that reads one page reads a third of the discharge.
 *
 * So multi-page is the product, and the ceiling is the dangerous part: a medical document that is
 * quietly truncated is a missing medicine. Six is stated in all three places it can bite, exactly
 * as the design canvas has it:
 *
 *   1. **the picker subtitle** — 「最多 6 張」, which flips to 「揀夠 6 張喇」 in warning colours
 *      with `role="status"` the moment the sixth page is in;
 *   2. **dimmed thumbnails once you reach it** — the 加一頁 tile in the review grid and the empty
 *      slots in the picker go dim, inert, and relabelled with the ceiling;
 *   3. **the camera hint** 「夠 6 頁喇，按「完成」」 over a spent shutter that no longer fires.
 *
 * On top of the canvas, choosing more photos than there is room for says so in words rather than
 * dropping the overflow behind the reader's back.
 *
 * ## What this component does not do
 *
 * It does not read the sheet. 講俾我聽 stashes the downscaled pages and navigates to `/chat`,
 * which owns the reading stream, the 讀住你張紙… state, its failure paths, and the `startSheet()`
 * call that only happens once a read has actually succeeded. Splitting it there means a sheet can
 * never become "the active sheet" on the strength of a photograph nobody could read.
 *
 * ## Privacy
 *
 * The photographed bytes are downscaled here (`lib/image/downscale.ts`, which re-encodes through a
 * canvas and so drops EXIF, GPS and every maker note) and leave this component only through
 * `sessionStorage[PENDING_IMAGES_KEY]`, which the reading screen clears the instant it has them.
 * No image is ever written to localStorage (FR-018, constitution V).
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import BottomSheet from "@/components/BottomSheet";
import ChunkyButton from "@/components/ChunkyButton";
import { useLocale } from "@/components/LocaleProvider";
import { downscale, type DownscaledImage } from "@/lib/image/downscale";
import { unlockAudio } from "@/lib/speech/tts";
import type { UiLocale } from "@/lib/i18n/ui";

/** The one transient home for image bytes; see the comment in the reading screen. */
export const PENDING_IMAGES_KEY = "fitornot.pending-images";

/**
 * The ceiling. Six is the whole discharge stack with room to spare, and it is a refusal rather
 * than a truncation everywhere it is reached.
 */
export const MAX_PAGES = 6;

/**
 * How many of a selection fit, and how many have to be turned away — the single most important
 * rule on this screen, pulled out as a pure function so it can be asserted without a browser.
 *
 * It never returns a negative count and never lets `accepted` exceed the room available, so no
 * arithmetic mistake upstream can turn into a page that was dropped without being reported. When
 * `turnedAway` is greater than zero the caller MUST say so in words: a medical document that is
 * silently truncated is a missing medicine (docs/real-sheet-evidence.md §1).
 */
export function admitPages(
  currentCount: number,
  chosenCount: number,
): { accepted: number; turnedAway: number } {
  const held = Math.max(0, Math.trunc(currentCount));
  const chosen = Math.max(0, Math.trunc(chosenCount));
  const accepted = Math.min(chosen, Math.max(0, MAX_PAGES - held));
  return { accepted, turnedAway: chosen - accepted };
}

type Copy = Record<UiLocale, string>;

/** Copy with no key in `lib/i18n/ui.ts`; written to the same banned-term rule as everything there. */
const PHOTO_FAILED: Copy = {
  hant: "呢張相讀唔到，再影一次。",
  hans: "这张照片读不到，再拍一次。",
  en: "That photo didn't come through. Try again.",
};
const PAGE_LABEL: Copy = {
  hant: "第 {n} 頁",
  hans: "第 {n} 页",
  en: "Page {n}",
};
const REMOVE_PAGE: Copy = {
  hant: "刪走第 {n} 頁",
  hans: "删掉第 {n} 页",
  en: "Remove page {n}",
};
/** The overflow refusal. Nothing is dropped without the reader being told how many and why. */
const TURNED_AWAY: Copy = {
  hant: "有 {n} 張加唔到，最多得 6 張。",
  hans: "有 {n} 张加不了，最多只能 6 张。",
  en: "{n} were not added — six pages is the maximum.",
};

/**
 * Whether this browser can ask for the camera directly. Constant per environment, so no
 * subscription and a cached answer; `true` on the server so the viewfinder does not flicker.
 */
let captureSupported: boolean | null = null;
function readCapture(): boolean {
  // `"capture" in input` is not a camera check: the IDL property exists on some builds and not
  // others while the content attribute works everywhere, and desktop Chrome answers false. The
  // honest question is "is this a phone or tablet", where `capture="environment"` opens the
  // camera; on a laptop the library picker is the right primary anyway.
  captureSupported ??=
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
  return captureSupported;
}

type View = "camera" | "review";

export default function Capture() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useLocale();

  // 上載相片 on 記錄 arrives with ?pick=1 and opens straight into the photo picker.
  const wantsPick = searchParams.get("pick") === "1";

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [pages, setPages] = useState<DownscaledImage[]>([]);
  const [view, setView] = useState<View>(wantsPick ? "review" : "camera");
  const [pickOpen, setPickOpen] = useState(wantsPick);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** How many photos the last selection had to turn away at the ceiling. 0 when none were. */
  const [turnedAway, setTurnedAway] = useState(0);

  /**
   * A laptop browser has no camera to open, so the picker becomes the only way in and the screen
   * says why (FR-024, S10). Server-render with the camera (no flicker on phones, which are the
   * target), then settle on the real answer after mount.
   */
  const [cameraUsable, setCameraUsable] = useState(true);
  useEffect(() => {
    const usable = readCapture();
    // Environment detection after mount is the one legitimate reason to set state in an effect:
    // the server cannot know the device, and a store with no subscription never re-reads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCameraUsable(usable);
    // With no camera there is no viewfinder to show, so the picker and the review grid ARE the
    // screen — the honest fallback rather than a dark panel pretending to be a lens.
    if (!usable) setView("review");
  }, []);

  const full = pages.length >= MAX_PAGES;
  const label = (copy: Copy, n: number) => copy[locale].replace("{n}", String(n));

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setBusy(true);
      setFailed(false);
      try {
        // The ceiling is applied to the reader's OWN selection, before any work is done, so the
        // number reported back is the number of photos they actually chose and could not have —
        // not whatever happened to survive a downscale.
        const chosen = Array.from(files);
        const room = admitPages(pages.length, chosen.length);
        setTurnedAway(room.turnedAway);
        if (room.accepted === 0) return;
        const shrunk = await Promise.all(
          chosen.slice(0, room.accepted).map((file) => downscale(file)),
        );
        setPages((current) => [...current, ...shrunk].slice(0, MAX_PAGES));
      } catch {
        // Never log the file: it is a photograph of someone's discharge sheet.
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [pages.length],
  );

  const onPicked = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      void addFiles(input.files).finally(() => {
        // Clearing lets the same file be chosen twice, and drops the browser's own reference.
        input.value = "";
      });
    },
    [addFiles],
  );

  /** Opens the phone's camera, or the photo library when there is none. Inert at the ceiling. */
  const shoot = useCallback(() => {
    if (pages.length >= MAX_PAGES) return;
    (cameraUsable ? cameraRef : libraryRef).current?.click();
  }, [cameraUsable, pages.length]);

  const openPicker = useCallback(() => {
    setTurnedAway(0);
    setPickOpen(true);
  }, []);

  /** 加一頁: back to the camera on a phone, into the picker on anything else. */
  const addPage = useCallback(() => {
    if (pages.length >= MAX_PAGES) return;
    if (cameraUsable) {
      setView("camera");
      return;
    }
    openPicker();
  }, [cameraUsable, openPicker, pages.length]);

  /** 再拍: drop that page and go straight back to taking one. */
  const retake = useCallback(
    (index: number) => {
      setPages((current) => current.filter((_, i) => i !== index));
      setTurnedAway(0);
      // Back to the shutter, not straight through it: opening the camera without a tap of its own
      // is a gesture the browser may refuse, and a silent no-op here would look like a dead button.
      if (cameraUsable) {
        setView("camera");
        return;
      }
      openPicker();
    },
    [cameraUsable, openPicker],
  );

  const removePage = useCallback((index: number) => {
    setPages((current) => current.filter((_, i) => i !== index));
    setTurnedAway(0);
  }, []);

  /**
   * 講俾我聽. The pages go into sessionStorage and the conversation takes over: `/chat` runs the
   * read, shows 讀住你張紙…, and only calls `startSheet()` once the reading has actually landed.
   */
  const startReading = useCallback(() => {
    if (pages.length === 0) return;
    // 講俾我聽 is the gesture immediately before a reading, so unlock here too. Costs nothing when
    // the consent tap already did it, and covers a second sheet read in the same session.
    unlockAudio();
    try {
      window.sessionStorage.setItem(
        PENDING_IMAGES_KEY,
        JSON.stringify(pages.map((p) => ({ mediaType: p.mediaType, base64: p.base64 }))),
      );
    } catch {
      setFailed(true);
      return;
    }
    router.push("/chat");
  }, [pages, router]);

  const leave = useCallback(() => {
    if (view === "camera" && pages.length > 0) {
      setView("review");
      return;
    }
    router.push("/");
  }, [pages.length, router, view]);

  const inputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPicked}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onPicked}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );

  return (
    <>
      {inputs}

      {view === "camera" ? (
        <CameraChrome
          pages={pages.length}
          busy={busy}
          onClose={leave}
          onShutter={shoot}
          onPick={() => libraryRef.current?.click()}
          onDone={() => setView("review")}
        />
      ) : (
        <ReviewGrid
          pages={pages}
          busy={busy}
          failed={failed}
          turnedAway={turnedAway}
          cameraUsable={cameraUsable}
          onBack={leave}
          onAddPage={addPage}
          onRetake={retake}
          onStart={startReading}
          pageLabel={(n) => label(PAGE_LABEL, n)}
          failedText={PHOTO_FAILED[locale]}
          turnedAwayText={(n) => label(TURNED_AWAY, n)}
        />
      )}

      <BottomSheet
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title={t("pick.title")}
        subtitle={full ? undefined : t("pick.subtitle")}
      >
        <PickerBody
          pages={pages}
          busy={busy}
          turnedAway={turnedAway}
          onAdd={() => libraryRef.current?.click()}
          onRemove={removePage}
          onDone={() => setPickOpen(false)}
          pageLabel={(n) => label(PAGE_LABEL, n)}
          removeLabel={(n) => label(REMOVE_PAGE, n)}
          turnedAwayText={(n) => label(TURNED_AWAY, n)}
        />
      </BottomSheet>
    </>
  );
}

/* ------------------------------------------------------------------ the camera */

/**
 * The scan screen from the design: a light page with a dark rounded card in the middle where the
 * photograph goes, a close pill and the page count above it, the shutter and an upload pill below.
 *
 * The design draws a 「對正咗 · 揸穩部機」 chip and a 「講住指示」 pill with a live blinking dot.
 * Both assert something that is not happening: this build hands the shutter to the phone's own
 * camera app rather than running a live viewfinder, so nothing here is detecting an edge and
 * nobody is narrating. What survives is what is true — a frame to line the page up inside, a count
 * of what has been taken, and the promise that the photograph stays on this phone.
 */
function CameraChrome({
  pages,
  busy,
  onClose,
  onShutter,
  onPick,
  onDone,
}: {
  pages: number;
  busy: boolean;
  onClose: () => void;
  onShutter: () => void;
  onPick: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const full = pages >= MAX_PAGES;

  const hint = full
    ? t("camera.hintFull")
    : pages === 0
      ? t("camera.hintFirst")
      : t("camera.hintNext");
  const hintSub = full
    ? t("camera.hintFullSub")
    : pages === 0
      ? t("camera.hintFirstSub")
      : t("camera.hintNextSub");

  return (
    // Stops above the fixed disclaimer rather than running to the bottom edge: the disclaimer has
    // to stay visible on every screen (rules.md §16), the camera included.
    <div className="fixed inset-x-0 top-0 bottom-[var(--disclaimer-height)] z-30 flex flex-col overflow-hidden bg-ground lg:left-[var(--sidebar-width)]">
      <div className="flex items-center justify-between px-4 pt-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("camera.close")}
          className="pill h-11 w-11 !px-0"
        >
          <span aria-hidden="true">
            <svg width="10" height="16" viewBox="0 0 12 20" fill="none">
              <path d="M10 2L2 10l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <span className="pill min-h-9 px-3.5 text-[13px]">
          {pages}/{MAX_PAGES}
        </span>
      </div>

      <div className="px-6 pt-5 text-center">
        <h1 className="text-[28px] leading-[34px] text-ink">{t("companion.scanTitle")}</h1>
        <p className="mt-2 text-[15px] leading-[22px] text-muted">{t("companion.scanSub")}</p>
      </div>

      {/* The dark card: the frame to line the page up inside, and the scan line that says "ready". */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pt-4">
        <div
          aria-hidden="true"
          className="relative w-full max-w-[320px] overflow-hidden rounded-[24px] bg-ink"
          style={{ aspectRatio: "0.8", maxHeight: "100%" }}
        >
          <div className="absolute inset-[18px] rounded-[14px] border-[1.5px] border-white/35" />
          <div
            className="animate-scanline absolute right-[18px] left-[18px] h-[2px]"
            style={{ background: "linear-gradient(90deg, transparent, #ffffff, transparent)" }}
          />
          {/* The pages taken so far, stacked in the corner of the card. */}
          {pages > 0 ? (
            <div className="absolute bottom-6 left-6 flex items-center">
              {Array.from({ length: Math.min(pages, MAX_PAGES) }, (_, i) => (
                <span
                  key={i}
                  className="grid h-[44px] w-[34px] place-items-center rounded-md bg-paper text-[13px] font-semibold text-ink"
                  style={{ border: "2px solid rgba(255,255,255,.75)", marginLeft: i === 0 ? 0 : -12 }}
                >
                  {i + 1}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* The hint. At the ceiling it stops being advice and becomes a refusal, so it moves onto the
          warning palette and announces itself. */}
      <div className="px-7 pt-4 text-center" role="status">
        {full ? (
          <p
            className="mx-auto inline-block rounded-2xl px-4 py-2.5 text-[17px] leading-[1.4] font-bold"
            style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}
          >
            {hint}
          </p>
        ) : (
          <p className="text-[17px] leading-[1.4] font-semibold text-ink">{hint}</p>
        )}
        <p className="mt-1 text-[13px] leading-[1.4] text-muted">{hintSub}</p>
      </div>

      <div className="flex flex-col items-center gap-3 px-5 pt-4 pb-5">
        <div className="flex w-full items-center justify-between">
          <span className="w-24" />
          <button
            type="button"
            onClick={onShutter}
            disabled={full || busy}
            aria-label={t("camera.shutter")}
            className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full bg-ink transition-opacity"
            style={{
              // A spent shutter: it keeps its footprint, loses its light, and does not fire.
              opacity: full ? 0.35 : 1,
              boxShadow: full ? "none" : "0 8px 24px rgba(0,0,0,.12)",
              cursor: full ? "default" : "pointer",
            }}
          >
            <span aria-hidden="true" className="block h-[62px] w-[62px] rounded-full border-2 border-white" />
          </button>
          <div className="flex w-24 justify-end">
            {pages > 0 ? (
              <ChunkyButton variant="jade" size="md" onClick={onDone}>
                {t("camera.done")}
              </ChunkyButton>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onPick}
          disabled={full || busy}
          className="pill min-h-11 gap-2 px-5 text-[15px]"
        >
          <UploadGlyph />
          {t("capture.upload")}
        </button>

        {/* The one promise worth making at the moment a camera is pointed at a medical document. */}
        <span className="inline-flex items-center gap-2 text-center text-[13px] leading-[1.4] text-muted">
          <LockGlyph />
          {t("review.onDevice")}
        </span>
      </div>
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 16V5M8 9l4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="1.3" width="11" height="14.4" rx="2.4" />
      <path d="M6 5.4h5M6 8.5h5M6 11.6h3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ the review grid */

function ReviewGrid({
  pages,
  busy,
  failed,
  turnedAway,
  cameraUsable,
  onBack,
  onAddPage,
  onRetake,
  onStart,
  pageLabel,
  failedText,
  turnedAwayText,
}: {
  pages: DownscaledImage[];
  busy: boolean;
  failed: boolean;
  turnedAway: number;
  cameraUsable: boolean;
  onBack: () => void;
  onAddPage: () => void;
  onRetake: (index: number) => void;
  onStart: () => void;
  pageLabel: (n: number) => string;
  failedText: string;
  turnedAwayText: (n: number) => string;
}) {
  const { t } = useLocale();
  const full = pages.length >= MAX_PAGES;
  const empty = pages.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-3.5 pb-8 lg:max-w-3xl lg:px-10 lg:pt-8">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("chat.back")}
        className="tap -ml-3 self-start rounded-full text-[26px] leading-none text-muted"
      >
        <span aria-hidden="true">‹</span>
      </button>

      <h1 className="mt-1 text-[28px] leading-[1.3] text-ink">
        {empty ? t("capture.title") : t("review.title")}
      </h1>
      {/*
        With no camera, the subtitle is the honest reason the viewfinder is not on offer — the one
        line FR-024 exists for. With a camera, this screen has only been reached through the picker,
        which states the ceiling in its own subtitle; repeating it behind the sheet would say the
        same thing twice and leave two copies to keep in step.
      */}
      {empty && cameraUsable ? (
        <div className="mb-[22px]" />
      ) : (
        <p className="mt-1 mb-[22px] text-[17px] leading-[1.5] text-muted">
          {empty ? t("fallback.cameraDenied") : t("review.subtitle")}
        </p>
      )}

      <ul className="grid list-none grid-cols-2 gap-3.5 p-0 lg:grid-cols-3">
        {pages.map((page, index) => (
          <li
            key={`${index}-${page.base64.length}`}
            className="relative h-[190px] overflow-hidden rounded-[14px] bg-paper"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL that never goes
                near the image optimiser; these bytes stay on the phone. */}
            <img
              src={`data:${page.mediaType};base64,${page.base64}`}
              alt={pageLabel(index + 1)}
              className="h-full w-full object-cover"
            />
            <span
              aria-hidden="true"
              className="absolute bottom-2 left-2 rounded-[14px] bg-ink px-2.5 py-1 text-[13px] font-semibold text-white"
            >
              {index + 1}
            </span>
            <button
              type="button"
              onClick={() => onRetake(index)}
              className="absolute right-2 bottom-2 rounded-[14px] px-3 py-2 text-[14px] font-medium text-white"
              // The canvas scrims this at 72% ink. Solid --ink instead: white on it is 14.9:1
              // whatever photograph happens to be underneath.
              style={{ background: "var(--ink)" }}
            >
              {t("review.retake")}
            </button>
          </li>
        ))}

        <li className="list-none">
          <button
            type="button"
            onClick={onAddPage}
            disabled={full || busy}
            className="grid h-[190px] w-full place-items-center rounded-[14px]"
            style={{
              border: "1.5px dashed color-mix(in srgb, var(--ink) 22%, transparent)",
              background: "transparent",
              cursor: full ? "default" : "pointer",
              /*
               * Dimmed at the ceiling — but only to 70%, not to the 40% a disabled control usually
               * gets. The label here IS the refusal, one of the three places the six-page limit has
               * to say itself, and a refusal nobody can read is a truncation. --ink at 70% over the
               * ground is 5.4:1; --muted at 40% would be 2.3:1.
               */
              opacity: full ? 0.7 : busy ? 0.6 : 1,
            }}
          >
            <span className="text-center">
              {!full ? (
                <span aria-hidden="true" className="block text-[30px] leading-none text-muted">
                  +
                </span>
              ) : null}
              <span
                className="mt-[7px] block px-3 text-[15px] leading-[1.4] font-medium"
                style={{ color: full ? "var(--ink)" : "var(--muted)" }}
              >
                {/* At the ceiling the tile stops offering and starts stating the limit. */}
                {full ? t("pick.subtitleFull") : t("review.addPage")}
              </span>
            </span>
          </button>
        </li>
      </ul>

      <div className="flex-1" />

      {busy ? (
        <p role="status" className="mt-4 text-center text-[15px] text-muted">
          {t("progress.step1")}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-4 text-center text-[15px] text-warn-ink">
          {failedText}
        </p>
      ) : null}
      {turnedAway > 0 ? (
        <p
          role="status"
          className="mt-4 rounded-2xl px-4 py-3 text-center text-[16px] leading-[1.45] font-medium"
          style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}
        >
          {turnedAwayText(turnedAway)}
        </p>
      ) : null}

      <div className="mt-3.5 mb-3.5 flex items-center gap-2.5 rounded-[20px] border border-hairline bg-card px-4 py-3.5">
        <span className="text-muted">
          <LockGlyph />
        </span>
        <span className="text-[15px] leading-[1.45] text-muted">{t("review.onDevice")}</span>
      </div>

      <ChunkyButton variant="jade" size="lg" fullWidth disabled={empty || busy} onClick={onStart}>
        {t("review.start")}
      </ChunkyButton>
    </main>
  );
}

/* ------------------------------------------------------------------ the photo picker */

/**
 * The picker is six slots, not a fake photo library.
 *
 * The canvas can draw a grid of the phone's own photos; a browser cannot read one without asking
 * for every picture the person owns. So the OS picker does the choosing and this shows the result:
 * one slot per page, the empty ones tappable, and — the part that matters — a subtitle that states
 * the ceiling and empty slots that vanish once it is reached.
 */
function PickerBody({
  pages,
  busy,
  turnedAway,
  onAdd,
  onRemove,
  onDone,
  pageLabel,
  removeLabel,
  turnedAwayText,
}: {
  pages: DownscaledImage[];
  busy: boolean;
  turnedAway: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onDone: () => void;
  pageLabel: (n: number) => string;
  removeLabel: (n: number) => string;
  turnedAwayText: (n: number) => string;
}) {
  const { t } = useLocale();
  const full = pages.length >= MAX_PAGES;
  const slots = Array.from({ length: MAX_PAGES }, (_, i) => i);

  return (
    <>
      {full ? (
        <p
          role="status"
          className="mb-4 rounded-2xl px-4 py-3 text-[17px] leading-[1.45] font-medium"
          style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}
        >
          {t("pick.subtitleFull")}
        </p>
      ) : null}

      <ul className="grid list-none grid-cols-3 gap-2.5 p-0 lg:grid-cols-6">
        {slots.map((index) => {
          const page = pages[index];
          if (page) {
            return (
              <li key={index} className="relative h-[104px] overflow-hidden rounded-[14px] bg-paper">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, stays on the phone. */}
                <img
                  src={`data:${page.mediaType};base64,${page.base64}`}
                  alt={pageLabel(index + 1)}
                  className="h-full w-full object-cover"
                />
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 left-1.5 rounded-[12px] bg-ink px-2 py-0.5 text-[12px] font-semibold text-white"
                >
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={removeLabel(index + 1)}
                  className="absolute top-1.5 right-1.5 grid h-[26px] w-[26px] place-items-center rounded-full text-[15px] leading-none text-white"
                  style={{ background: "var(--ink)" }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          }
          return (
            <li key={index}>
              <button
                type="button"
                onClick={onAdd}
                disabled={busy}
                aria-label={t("review.addPage")}
                className="grid h-[104px] w-full place-items-center rounded-[14px] text-[24px] leading-none text-muted disabled:opacity-40"
                style={{
                  border: "1.5px dashed color-mix(in srgb, var(--ink) 22%, transparent)",
                  background: "transparent",
                }}
              >
                <span aria-hidden="true">+</span>
              </button>
            </li>
          );
        })}
      </ul>

      {turnedAway > 0 ? (
        <p
          role="status"
          className="mt-4 rounded-2xl px-4 py-3 text-[16px] leading-[1.45] font-medium"
          style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}
        >
          {turnedAwayText(turnedAway)}
        </p>
      ) : null}

      <ChunkyButton
        variant="jade"
        size="lg"
        fullWidth
        className="mt-5"
        disabled={pages.length === 0 || busy}
        onClick={onDone}
      >
        {pages.length === 0
          ? t("pick.useNone")
          : t("pick.use").replace("{n}", String(pages.length))}
      </ChunkyButton>
    </>
  );
}
