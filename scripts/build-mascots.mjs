/**
 * Turn the raw mascot renders into the four transparent squares the app actually ships.
 *
 * Run: `node scripts/build-mascots.mjs [path-to-mascots-v5]`
 * Source: `mascots-v5-natural.zip` in the repo root (not committed — it is 20 MB of 1536×1024
 * PNGs). Unzip it anywhere and pass the `mascots-v5` directory, or leave the zip in place and
 * this script will unzip it to a temp directory itself.
 * Output: `public/mascot/<animal>/<state>.webp`, 192×192, real alpha, a few KB each.
 *
 * ── Why this is not a one-line `sharp().resize()` ───────────────────────────────────────────────
 *
 * The renders are flat studio art sitting on a near-uniform 253–255 white with NO alpha channel,
 * and the app's ground is #FBF8F3 — worse, `CheckinNotice` sets 明仔 inside a filled jade disc, so
 * any leftover white shows up as a bright ring around him at 30 px.
 *
 * A luminance threshold ("anything brighter than X is background") is the obvious fix and it is
 * wrong twice over. First, the panda's face and belly and the rabbit's chest are themselves white,
 * so a threshold punches holes straight through the character — what separates background from
 * subject is not brightness, it is *connectivity to the frame edge*. Second, each character sits
 * on a soft contact shadow that fades from ~190 back up to white over about ten pixels; a
 * threshold keeps that as opaque grey, which is a shadow on cream but a halo on jade.
 *
 * So the background is found in two passes, then unpremultiplied:
 *
 *   1. LEVEL FILL from the frame edge. Anything ≥ LEVEL that is connected to the border is plain
 *      backdrop. Connectivity is what protects the panda; LEVEL is safe because no silhouette in
 *      this art starts brighter than 246 (the palest edge in the set, the panda's cheek, steps
 *      249 → 225 in a single pixel). This pass alone gives clean edges and leaves the shadow.
 *   2. GRADIENT WALK, for the shadow only. From pass 1's frontier, step at most MAX_STEP per pixel
 *      in either direction, never below HARD_FLOOR, only through neighbourhoods flatter than
 *      SMOOTH, and no further than DEPTH into the frame. All four limits earn their place — see
 *      the comment on the pass itself.
 *   3. INK OVER WHITE. Everything the fill reached is white with something dark laid over it, so
 *      its opacity is simply how far from white it got: alpha = 255 − darkest channel. Pure
 *      backdrop lands on 0–2 and the shadow on 50–65, which is what a soft shadow should be.
 *   4. UNPREMULTIPLY. This is the step that kills the halo. A 25 %-opaque shadow pixel still
 *      *stores* a near-white RGB; over jade that is a bright smear. Solving C = a·F + (1−a)·255
 *      for F recovers what was actually laid over the white, so the shadow reads as a shadow on
 *      any ground and the rim reads as fur.
 *
 * ── Why one shared crop per animal ──────────────────────────────────────────────────────────────
 *
 * The four states are the same character in the same frame, so their subject boxes agree to
 * within a percent — except `listening`, where the ears go up. Cropping each state to its own box
 * would rescale the character every time the state changed and he would twitch in place. Every
 * state is therefore cropped to the *union* box, in frame-normalised coordinates, so the art is
 * pixel-stable when idle → speaking swaps mid-thread.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const ANIMALS = ["cat", "panda", "puppy", "rabbit"];
const STATES = ["idle", "speaking", "listening", "greeting"];

/** 192 px covers every size the app draws: it is 92 × 2 with room to spare, and 64 × 3 exactly. */
const OUT = 192;
/** Breathing room so an ear tip never dies against a rounded container. */
const PAD = 2;

const LEVEL = 246; // pass 1: plain backdrop is 246 and up, and no character edge starts that light
const MAX_STEP = 12; // pass 2 may step this far per pixel, either way; real edges jump 24–110
const HARD_FLOOR = 150; // pass 2 never goes below this, whatever the gradient says
const DEPTH = 0.012; // pass 2 reaches this fraction of the frame width in — ~18 px, a shadow's width
const SMOOTH = 10; // pass 2 only crosses pixels whose 3×3 range is this flat; fur and grain are not
const NOISE_FLOOR = 7; // the renders carry lone 251-value speckles; below this it is not a shadow
const MARGIN = 3; // px of slack around the union box, so the soft rim is never clipped

/** RGB-on-white → straight alpha. Returns RGBA raw pixels. */
async function cutout(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;

  // The darkest channel, so a coloured pixel (a pink ear, a jade collar) is never "white".
  const lum = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    lum[p] = Math.min(data[i], data[i + 1], data[i + 2]);
  }

  // PASS 1 — the plain backdrop. A flat level test, flooded from the frame edge. It cannot leak
  // into the panda because the fill is *connected*, and it cannot leak past the character because
  // no silhouette in this art starts brighter than 246 (the panda's cheek, the palest edge in the
  // set, steps 249 → 225 in one pixel).
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const seed = (p) => {
    if (!bg[p] && lum[p] >= LEVEL) {
      bg[p] = 1;
      stack[top++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (top > 0) {
    const p = stack[--top];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }

  // PASS 2 — the contact shadow the character sits on, which pass 1 leaves behind as opaque grey
  // (a shadow on cream, a bright smear on the jade disc in CheckinNotice). It fades from ~190 back
  // to white over about ten pixels, so it is walked by gradient rather than by level: step at most
  // MAX_STEP either way, never below HARD_FLOOR.
  //
  // Three limits, and none of them is redundant. A one-sided step test lets the fill drop into the
  // shadow at 190 and climb straight back up into the panda's 230-ish belly; a symmetric one still
  // finds a gentle way in around a soft-shaded white head. The depth cap bounds the damage when it
  // does — background bleed is a thin band, so 18 px into a 1536 px frame cannot eat a face. And
  // the smoothness gate is what saves the fur: a cast shadow is a flat wash, while the rabbit's ear
  // and the panda's crown are grainy, so a 3×3 range ceiling stops the walk dead at the character
  // even where the gradient alone would have let it nibble.
  const rough = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let lo = 255;
      let hi = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = lum[(y + dy) * w + x + dx];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      rough[y * w + x] = Math.min(255, hi - lo);
    }
  }

  const maxDepth = Math.round(w * DEPTH);
  const seen = new Uint8Array(n);
  let frontier = [];
  for (let p = 0; p < n; p++) {
    if (!bg[p]) continue;
    const x = p % w;
    const near =
      (x > 0 && !bg[p - 1]) ||
      (x < w - 1 && !bg[p + 1]) ||
      (p >= w && !bg[p - w]) ||
      (p < n - w && !bg[p + w]);
    if (near) frontier.push(p);
  }
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = [];
    for (const p of frontier) {
      const from = lum[p];
      const x = p % w;
      const step = (q) => {
        if (bg[q] || seen[q]) return;
        const l = lum[q];
        if (l < HARD_FLOOR || Math.abs(l - from) > MAX_STEP || rough[q] > SMOOTH) return;
        seen[q] = 1;
        next.push(q);
      };
      if (x > 0) step(p - 1);
      if (x < w - 1) step(p + 1);
      if (p >= w) step(p - w);
      if (p < n - w) step(p + w);
    }
    for (const p of next) bg[p] = 1;
    frontier = next;
  }

  const out = Buffer.alloc(n * 4);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    let a = 255;
    if (bg[p]) {
      // Ink over white: how far from white it got is how opaque it is. Backdrop lands on 0–2, the
      // shadow on 50–65, a hard edge's single anti-aliased pixel somewhere between.
      a = 255 - lum[p];
      if (a < NOISE_FLOOR) a = 0;
    }
    if (a === 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    } else if (a === 255) {
      out.set(data.subarray(i, i + 3), i);
      out[i + 3] = 255;
    } else {
      const f = a / 255;
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - (1 - f) * 255) / f)));
      }
      out[i + 3] = a;
    }
  }
  return { raw: out, width: w, height: h };
}

/** Subject box, in 0–1 frame coordinates so boxes from differently sized frames can be unioned. */
function normalisedBox(raw, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (raw[(y * w + x) * 4 + 3] >= 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
}

/** Returns the art directory, plus the temp directory to delete afterwards if we made one. */
function resolveSource(arg) {
  if (arg) return { dir: arg, temp: null };
  const zip = path.join(process.cwd(), "mascots-v5-natural.zip");
  if (!statSync(zip, { throwIfNoEntry: false })) {
    throw new Error(
      "No source art. Pass the unzipped `mascots-v5` directory, or put mascots-v5-natural.zip in the repo root.",
    );
  }
  const temp = mkdtempSync(path.join(tmpdir(), "mascots-"));
  execFileSync("unzip", ["-q", zip, "-d", temp]);
  return { dir: path.join(temp, "mascots-v5"), temp };
}

const { dir: src, temp } = resolveSource(process.argv[2]);
const dest = path.join(process.cwd(), "public", "mascot");
let total = 0;

for (const animal of ANIMALS) {
  const cuts = {};
  let box = null;
  for (const state of STATES) {
    const cut = await cutout(path.join(src, animal, `${state}.png`));
    cuts[state] = cut;
    const b = normalisedBox(cut.raw, cut.width, cut.height);
    box = box
      ? {
          x0: Math.min(box.x0, b.x0),
          y0: Math.min(box.y0, b.y0),
          x1: Math.max(box.x1, b.x1),
          y1: Math.max(box.y1, b.y1),
        }
      : b;
  }

  mkdirSync(path.join(dest, animal), { recursive: true });
  for (const state of STATES) {
    const { raw, width: w, height: h } = cuts[state];
    const left = Math.max(0, Math.round(box.x0 * w) - MARGIN);
    const topPx = Math.max(0, Math.round(box.y0 * h) - MARGIN);
    const right = Math.min(w, Math.round(box.x1 * w) + MARGIN);
    const bottom = Math.min(h, Math.round(box.y1 * h) + MARGIN);

    const file = path.join(dest, animal, `${state}.webp`);
    await sharp(raw, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left, top: topPx, width: right - left, height: bottom - topPx })
      .resize(OUT - PAD * 2, OUT - PAD * 2, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: "lanczos3",
      })
      .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 82, alphaQuality: 100, effort: 6 })
      .toFile(file);

    const bytes = statSync(file).size;
    total += bytes;
    console.log(`${animal}/${state}.webp`.padEnd(26), `${(bytes / 1024).toFixed(1)} KB`);
  }
}
console.log(`\n${ANIMALS.length * STATES.length} files, ${(total / 1024).toFixed(1)} KB total`);
if (temp) rmSync(temp, { recursive: true, force: true });
