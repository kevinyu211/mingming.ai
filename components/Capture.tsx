"use client";

/**
 * S3 — getting the page in.
 *
 * One big target (影低張出院紙) and three ways out beside it, because every one of them is a
 * failure path that has to work on stage (FR-024): the camera can be denied, the phone can be a
 * laptop, the network can be gone. The order of the fallbacks is the order of the constitution's:
 * camera → photo library → typing → the bundled sample.
 *
 * Typing is the one that is not finished, and it says so: this sprint reads photos, so the button
 * stays where it is, opens a real box, and then tells the truth instead of pretending to read
 * what was pasted. An honest state beats a silent one.
 *
 * The photographed bytes are downscaled here (`lib/image/downscale.ts`) and never leave this
 * component except through `sessionStorage["fitornot.pending-images"]`, which `app/read/page.tsx`
 * clears the instant it has them. No image is ever written to localStorage (FR-018).
 */
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import DeclineState from "@/components/DeclineState";
import { useLocale } from "@/components/LocaleProvider";
import { DEFAULT_SAMPLE } from "@/lib/client/sample";
import { downscale, type DownscaledImage } from "@/lib/image/downscale";
import type { UiLocale } from "@/lib/i18n/ui";

/** The one transient home for image bytes; see the comment in `app/read/page.tsx`. */
export const PENDING_IMAGES_KEY = "fitornot.pending-images";

/** The read contract takes one or two pages. */
const MAX_PAGES = 2;

type Copy = Record<UiLocale, string>;

/** Not in `lib/i18n/ui.ts`; written to the same banned-term rule. */
const PHOTO_FAILED: Copy = {
  hant: "呢張相讀唔到，再影一次。",
  hans: "这张照片读不到，再拍一次。",
  en: "That photo didn't come through. Try again.",
};
const TYPED_PLACEHOLDER: Copy = {
  hant: "將出院紙上面嘅字打或者貼落嚟",
  hans: "把出院纸上面的字打或者贴进来",
  en: "Type or paste what the sheet says",
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

/** Whether this browser can ask for the camera directly. Constant per environment, so no
 *  subscription and a cached answer; `true` on the server so the tile does not flicker. */
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

export default function Capture() {
  const router = useRouter();
  const { locale, t } = useLocale();

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [pages, setPages] = useState<DownscaledImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [typedNotice, setTypedNotice] = useState(false);

  // A laptop browser has no `capture` attribute, so the library picker becomes the primary tile
  // (S10). On a phone whose camera permission is refused the picker simply returns nothing, and
  // the library button in the row below is already the way out.
  // Server-render with the camera tile (no flicker on phones, which are the target), then settle
  // on the real answer after mount. A store with no subscription would never leave the server
  // snapshot, which is how laptops used to miss the honest "no camera" note (FR-024).
  const [cameraUsable, setCameraUsable] = useState(true);
  useEffect(() => {
    // Environment detection after mount is the one legitimate reason to set state in an effect:
    // the server cannot know the device, and a store with no subscription never re-reads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCameraUsable(readCapture());
  }, []);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const chosen = Array.from(files).slice(0, MAX_PAGES);
      const shrunk = await Promise.all(chosen.map((file) => downscale(file)));
      setPages((current) => [...current, ...shrunk].slice(0, MAX_PAGES));
    } catch {
      // Never log the file: it is a photograph of someone's discharge sheet.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

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

  const removePage = useCallback((index: number) => {
    setPages((current) => current.filter((_, i) => i !== index));
  }, []);

  const goSample = useCallback(() => {
    router.push(`/read?sample=${DEFAULT_SAMPLE}`);
  }, [router]);

  const startReading = useCallback(() => {
    if (pages.length === 0) return;
    try {
      window.sessionStorage.setItem(
        PENDING_IMAGES_KEY,
        JSON.stringify(pages.map((p) => ({ mediaType: p.mediaType, base64: p.base64 }))),
      );
    } catch {
      setFailed(true);
      return;
    }
    router.push("/read");
  }, [pages, router]);

  const label = (copy: Copy, n: number) => copy[locale].replace("{n}", String(n));

  return (
    // The viewfinder takes whatever height is left, so the shutter row sits near the thumb.
    <div className="flex flex-1 flex-col gap-4">
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

      {pages.length === 0 ? (
        <ViewFinder />
      ) : (
        <section aria-label={t("cards.header")} className="flex flex-col gap-3">
          <ul className="flex gap-3">
            {pages.map((page, index) => (
              <li key={`${index}-${page.base64.length}`} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL that never
                    goes near the image optimiser; these bytes stay on the phone. */}
                <img
                  src={`data:${page.mediaType};base64,${page.base64}`}
                  alt={label(PAGE_LABEL, index + 1)}
                  className="h-40 w-30 rounded-[14px] object-cover shadow-card"
                />
                <button
                  type="button"
                  onClick={() => removePage(index)}
                  aria-label={label(REMOVE_PAGE, index + 1)}
                  className="tap absolute -top-3 -right-3 rounded-full bg-card text-body font-semibold text-ink shadow-card"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>

          {pages.length < MAX_PAGES ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => (cameraUsable ? cameraRef : libraryRef).current?.click()}
              className="tap h-[52px] w-full rounded-full bg-card px-4 text-body font-semibold text-ink shadow-card disabled:opacity-60"
            >
              {t("capture.addPage")}
            </button>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={startReading}
            className="tap h-[52px] w-full rounded-full bg-accent px-4 text-body font-semibold text-accent-ink shadow-raised disabled:opacity-60"
          >
            {t("capture.start")}
          </button>
        </section>
      )}

      {busy ? (
        <p role="status" className="text-center text-meta text-muted">
          {t("progress.step1")}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-center text-meta text-warning-fg">
          {PHOTO_FAILED[locale]}
        </p>
      ) : null}
      {/* The camera is out: say so where the shutter is, and the library becomes the big target. */}
      {cameraUsable ? null : (
        <p className="text-center text-meta text-muted">{t("fallback.cameraDenied")}</p>
      )}

      {/* Library · shutter · sample. One row, the shutter twice the size of what flanks it. */}
      <div className="flex items-start justify-between gap-2 px-1.5">
        {/* When the camera is out, the shutter IS the library picker, so this would repeat it. */}
        {cameraUsable ? (
          <SideTile onClick={() => libraryRef.current?.click()} label={t("capture.library")}>
            <PhotosGlyph />
          </SideTile>
        ) : (
          <span className="w-20 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => (cameraUsable ? cameraRef : libraryRef).current?.click()}
          // Without this the shutter's accessible name would be the short word under it.
          aria-label={cameraUsable ? t("capture.title") : t("capture.library")}
          className="flex shrink-0 flex-col items-center gap-[7px] disabled:opacity-60"
        >
          <span
            className="flex h-[78px] w-[78px] items-center justify-center rounded-full bg-accent"
            style={{
              boxShadow:
                "0 8px 22px color-mix(in srgb, var(--accent) 30%, transparent), inset 0 0 0 4px var(--ground), 0 0 0 6px var(--accent)",
            }}
          >
            <CameraGlyph />
          </span>
          <span className="text-meta font-semibold text-ink">
            {cameraUsable ? t("capture.camera") : t("capture.library")}
          </span>
        </button>

        <SideTile onClick={goSample} label={t("capture.sample")}>
          <SheetGlyph />
        </SideTile>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setTyping((open) => !open)}
          aria-expanded={typing}
          className="tap rounded-full px-3 text-meta font-semibold text-accent"
        >
          {t("capture.type")}
        </button>
      </div>

      {typing ? (
        <div className="flex flex-col gap-3">
          {typedNotice ? <DeclineState variant="typedText" onSample={goSample} /> : null}
          <label className="text-meta font-semibold text-muted" htmlFor="typed-sheet">
            {t("capture.type")}
          </label>
          <textarea
            id="typed-sheet"
            rows={5}
            value={typedText}
            placeholder={TYPED_PLACEHOLDER[locale]}
            onChange={(event) => setTypedText(event.target.value)}
            className="w-full rounded-[14px] bg-card px-4 py-3 text-body text-ink shadow-card"
          />
          <button
            type="button"
            disabled={typedText.trim().length === 0}
            onClick={() => setTypedNotice(true)}
            className="tap h-[52px] w-full rounded-full bg-card px-4 text-body font-semibold text-ink shadow-card disabled:opacity-50"
          >
            {t("capture.start")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The dark panel the sheet goes into: corner brackets and a ghosted page, so it is obvious what
 * "in frame" means before the camera has even opened. Decoration only — the shutter below it is
 * the control, and this carries no text of its own.
 */
function ViewFinder() {
  return (
    <div
      aria-hidden="true"
      className="relative flex min-h-[260px] flex-1 items-center justify-center overflow-hidden rounded-[22px] bg-ink"
    >
      <span
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 70% at 50% 35%, color-mix(in srgb, var(--ground) 12%, transparent), transparent 62%)",
        }}
      />
      <GhostPage />
      <span className="absolute top-[18px] left-[18px] h-[26px] w-[26px] rounded-tl-lg border-t-[2.5px] border-l-[2.5px] border-ground" />
      <span className="absolute top-[18px] right-[18px] h-[26px] w-[26px] rounded-tr-lg border-t-[2.5px] border-r-[2.5px] border-ground" />
      <span className="absolute bottom-[18px] left-[18px] h-[26px] w-[26px] rounded-bl-lg border-b-[2.5px] border-l-[2.5px] border-ground" />
      <span className="absolute right-[18px] bottom-[18px] h-[26px] w-[26px] rounded-br-lg border-r-[2.5px] border-b-[2.5px] border-ground" />
    </div>
  );
}

/** The sheet as the frame will see it: a page of lines, two of them the warning lines. */
function GhostPage() {
  const warm = "color-mix(in srgb, var(--warning-bg) 55%, var(--warning-fg))";
  return (
    <svg viewBox="0 0 260 350" className="relative h-[276px] w-[205px]" fill="none">
      <g className="text-ground" fill="currentColor">
        <rect x="10" y="10" width="240" height="330" rx="10" opacity=".08" />
        <rect x="40" y="46" width="130" height="9" rx="4.5" opacity=".75" />
        <rect x="40" y="74" width="180" height="7" rx="3.5" opacity=".32" />
        <rect x="40" y="92" width="152" height="7" rx="3.5" opacity=".32" />
        <rect x="40" y="128" width="180" height="7" rx="3.5" opacity=".32" />
        <rect x="40" y="146" width="118" height="7" rx="3.5" opacity=".32" />
        <rect x="40" y="252" width="168" height="7" rx="3.5" opacity=".32" />
        <rect x="40" y="270" width="96" height="7" rx="3.5" opacity=".32" />
      </g>
      <rect x="40" y="190" width="176" height="7" rx="3.5" fill={warm} opacity=".85" />
      <rect x="40" y="208" width="140" height="7" rx="3.5" fill={warm} opacity=".85" />
    </svg>
  );
}

/** One of the two small squares flanking the shutter. */
function SideTile({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-20 shrink-0 flex-col items-center gap-[7px]"
    >
      <span className="flex h-13 w-13 items-center justify-center rounded-[16px] bg-card text-ink shadow-card">
        {children}
      </span>
      <span className="text-fine leading-tight text-muted">{label}</span>
    </button>
  );
}

function CameraGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-8 w-8 text-accent-ink"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

function PhotosGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[23px] w-[23px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 15.5l5-4.5 4 3.5 3-2.5 6 5" />
      <circle cx="15.5" cy="9" r="1.4" />
    </svg>
  );
}

function SheetGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-[23px] w-[23px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h6M10 17h4" />
    </svg>
  );
}
