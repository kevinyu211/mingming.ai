"use client";

/**
 * Client-side downscaling of a photographed sheet, before anything leaves the phone.
 *
 * Two reasons this happens here and not on the server:
 *
 *   1. Bandwidth. A modern phone camera writes an 8–12 MB JPEG; the read route's body limit is
 *      8 MB for two pages. 2400 px on the long edge at quality 0.85 lands at roughly 400–900 KB;
 *      1600 px kept 9 pt print legible, 2400 px keeps small Chinese print exact (see MAX_LONG_EDGE).
 *   2. Privacy. Re-encoding through a canvas keeps ONLY the pixels: EXIF, GPS coordinates, the
 *      camera serial, the capture timestamp and every other maker note are dropped, because a
 *      canvas has no metadata to carry them (constitution principle V). The orientation flag is
 *      the one piece of EXIF that must survive, so it is baked into the pixels first via
 *      `createImageBitmap(file, { imageOrientation: "from-image" })`.
 *
 * The base64 produced here lives in memory and, for exactly one navigation, in sessionStorage
 * (see `app/read/page.tsx`). It is never written to localStorage and never logged.
 */

/** What `/api/read` accepts for one page. */
export interface DownscaledImage {
  mediaType: "image/jpeg";
  base64: string;
  width: number;
  height: number;
}

/** Long-edge cap, from the read contract. */
/**
 * 2400 rather than the original 1600: on 5 September a dense bilingual sheet read at 1240 px
 * turned 「早晨服」 (morning) into 「早餐前服」 (before breakfast) on three runs out of three, and
 * the same sheet at 2480 px read it right three times out of three. Claude accepts up to 2576 px
 * on the long edge, so 2400 is inside the tier where every pixel still counts. A page lands at
 * roughly 400–900 KB; the 413 retry below the route's body cap drops back to 1600.
 */
export const MAX_LONG_EDGE = 2400;

/** JPEG quality, from the read contract. */
export const JPEG_QUALITY = 0.85;

export interface Size {
  width: number;
  height: number;
}

/**
 * The size to draw at: the long edge capped at `maxLongEdge`, aspect ratio kept, never upscaled.
 * Pure — this is the half of the module that unit tests can reach without a DOM.
 */
export function targetSize(
  width: number,
  height: number,
  maxLongEdge: number = MAX_LONG_EDGE,
): Size {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const longEdge = Math.max(w, h);
  if (longEdge <= maxLongEdge) return { width: w, height: h };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * The payload half of a `data:` URL. Returns "" for anything that is not one, so a caller can
 * fail loudly rather than posting a string with a `data:image/jpeg;base64,` prefix in it.
 */
export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return "";
  return dataUrl.slice(comma + 1);
}

/** Roughly how many bytes a base64 string decodes to; used to keep two pages under the limit. */
export function approximateBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export class DownscaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownscaleError";
  }
}

type Drawable = CanvasImageSource & Size;

/**
 * Decode the file with the EXIF orientation already applied. Safari 15 and older Firefox do not
 * accept the `imageOrientation` option, and some browsers have no `createImageBitmap` for files
 * at all, so there are two fallbacks. The `<img>` fallback applies orientation itself (browsers
 * honour EXIF for images by default since `image-orientation: from-image` became the initial
 * value), so all three paths agree.
 */
async function decode(file: Blob): Promise<{ source: Drawable; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    for (const options of [{ imageOrientation: "from-image" } as const, undefined]) {
      try {
        const bitmap = options
          ? await createImageBitmap(file, options)
          : await createImageBitmap(file);
        return { source: bitmap, release: () => bitmap.close() };
      } catch {
        // Try the next strategy.
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new DownscaleError("The phone could not decode this image."));
      el.src = url;
    });
    return {
      source: Object.assign(image, {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      }),
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * One photographed page → the JPEG the read route accepts. Nothing but pixels survives.
 */
export async function downscale(
  file: Blob,
  maxLongEdge: number = MAX_LONG_EDGE,
): Promise<DownscaledImage> {
  if (typeof document === "undefined") {
    throw new DownscaleError("downscale() needs a browser.");
  }

  const { source, release } = await decode(file);
  try {
    const size = targetSize(source.width, source.height, maxLongEdge);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    const context = canvas.getContext("2d");
    if (!context) throw new DownscaleError("This browser has no 2D canvas.");
    // A white ground: a JPEG has no alpha, and an unpainted canvas would come out black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(source, 0, 0, size.width, size.height);

    const base64 = base64FromDataUrl(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    if (!base64) throw new DownscaleError("The phone could not encode this image.");

    // Drop the pixels as soon as the bytes are out, so the original never lingers.
    canvas.width = 0;
    canvas.height = 0;

    return { mediaType: "image/jpeg", base64, width: size.width, height: size.height };
  } finally {
    release();
  }
}
