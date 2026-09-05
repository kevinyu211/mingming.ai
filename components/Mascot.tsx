"use client";

/**
 * 明明 — the companion.
 *
 * He is a drawing now: four transparent 192 px squares per animal in `public/mascot/`, cut out of
 * the studio renders by `scripts/build-mascots.mjs` (which is also where the story of the white
 * background and the contact shadow lives). `next/image` is given explicit width and height at
 * every call site, so he never reflows the thread as he loads.
 *
 * FALLBACK. The CSS drawing that used to be the whole component is still here, under `MascotDrawing`,
 * and it is what renders if the art 404s or the network gives up. That was the original reason he
 * was drawn rather than fetched — a broken-image icon on the demo phone is worse than anything a
 * few divs cost — and the reason survives even though the art now exists.
 *
 * UNOPTIMIZED, deliberately. The files are already exactly what we want on the wire — 192 px square,
 * WebP, a few KB — so `/_next/image` would only re-encode them, and it would do two things we do not
 * want. It caps a fixed-size image's srcset at 2×, which on a 3× phone hands the 30 px avatar a
 * 64 px file for a 90-device-pixel box; and when a client does not advertise WebP it falls back to
 * JPEG, which has no alpha and flattens 明明 onto a black square. Straight to the file it is: four
 * requests for the whole app, every one of them the full-resolution art.
 *
 * ACCESSIBILITY. He is decoration. Every place he appears, his NAME appears next to him as real
 * text (「明明」, from `mascot.name`), so labelling the picture as well would make a screen reader
 * say his name twice. The root is `aria-hidden`, the image is `alt=""`; there is no `role`, no
 * `aria-label`, no `title`. If you are tempted to add one, add the name as visible text instead —
 * that helps everyone.
 */
import Image from "next/image";
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  DEFAULT_MASCOT,
  loadState,
  readMascotAnimal,
  subscribe,
  type MascotAnimal,
} from "@/lib/storage/local";

export {
  DEFAULT_MASCOT,
  MASCOT_ANIMALS,
  type MascotAnimal,
} from "@/lib/storage/local";

/** Alias of `DEFAULT_MASCOT` so existing tests that import `MASCOT` keep compiling. */
export const MASCOT: MascotAnimal = DEFAULT_MASCOT;

function readStoredAnimal(): MascotAnimal {
  return readMascotAnimal(loadState());
}

/** The four sizes the canvas draws. Nothing else is designed, so nothing else is offered. */
export type MascotSize = 30 | 44 | 64 | 92;

/**
 * `speaking` is 明明 mid-sentence; `listening` is him with the microphone open, and it also breathes
 * a ring around him. Both are status, never a control — the same rule as the 讀住 waveform (brief
 * section 6). `greeting` is the unread / empty-home pose. The wrapper only breathes; it does not
 * hop. Reduced motion stops every motion (globals.css).
 */
export type MascotState = "idle" | "speaking" | "listening" | "greeting";

/** The states that have art. Anything else falls back to `idle` rather than to a 404. */
const ART: readonly MascotState[] = ["idle", "speaking", "listening", "greeting"];

/**
 * Above the fold, and only there. 64 is the home conversation row and 92 is the empty-home /
 * consent plate — one of each, both the first thing on their page, both worth a preload. 30 is
 * the thread avatar, which repeats on every message: preloading that would put twenty identical
 * `<link>` tags in the head for one small file the browser fetches once anyway.
 */
const PRELOAD_FROM: MascotSize = 64;

export interface MascotProps {
  /** 30 notification avatar · 44 thread avatar · 64 empty state · 92 the reading screen. */
  size?: MascotSize;
  state?: MascotState;
  /**
   * Overrides the on-device choice. Settings preview tiles pass this so each tile can show a
   * different animal without writing storage. Everywhere else omits it and follows the picker.
   */
  animal?: MascotAnimal;
  /**
   * A slow idle breathe on the wrapper. No bounce, no hop: the speaking and greeting poses
   * already say what he is doing. Settings tiles pass false so the picker grid does not pulse.
   */
  motion?: boolean;
  /** Extra classes for the wrapper — opacity, margins. The drawing itself is fixed. */
  className?: string;
  style?: CSSProperties;
}

function motionClass(_state: MascotState, motion: boolean): string {
  if (!motion) return "";
  return "animate-breathe";
}

export default function Mascot({
  size = 44,
  state = "idle",
  animal,
  motion = true,
  className = "",
  style,
}: MascotProps) {
  // The one thing that can go wrong with an image: it does not arrive. Then we draw him instead.
  // Remembered per file, not as a flag: a 404 on one file must not freeze every later animal on
  // the CSS blob — that blob is the same panda-shaped face for all four, which is how a switch
  // could look like it did nothing. A different file starts clean without an effect to reset it.
  const [brokenFile, setBrokenFile] = useState<string | null>(null);
  const stored = useSyncExternalStore(subscribe, readStoredAnimal, () => DEFAULT_MASCOT);
  const chosen = animal ?? stored;
  const art = ART.includes(state) ? state : "idle";
  const file = `${chosen}-${art}`;
  const broken = brokenFile === file;

  return (
    <span
      aria-hidden="true"
      className={`relative block shrink-0 ${motionClass(state, motion)} ${className}`.trim()}
      style={{ width: size, height: size, ...style }}
    >
      {broken ? (
        <MascotDrawing size={size} state={state} />
      ) : (
        <Image
          key={file}
          src={`/mascot/${chosen}/${art}.webp`}
          alt=""
          width={size}
          height={size}
          priority={size >= PRELOAD_FROM}
          unoptimized
          onError={() => setBrokenFile(file)}
          className="block h-full w-full object-contain"
        />
      )}

      {/*
        A pulsing ring while the microphone is open. Jade at 18%, not --jade-tint: the tint is
        #E9F4F0 against a #FBF8F3 ground, which is a ring nobody can see. This is the same
        treatment the canvas gives the bar while it is holding.
      */}
      {state === "listening" && (
        <span
          className="animate-edge"
          style={{
            position: "absolute",
            left: -5,
            top: -5,
            width: size + 10,
            height: size + 10,
            borderRadius: "50%",
            boxShadow: "0 0 0 4px color-mix(in srgb, var(--jade) 18%, transparent)",
          }}
        />
      )}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   The fallback: 明明 in CSS, for when the art does not arrive.

   Two ear circles, a round white face, two eyes, a mouth — every part a positioned div, so he
   renders offline, at any pixel ratio, in the palette's own tokens. Geometry is the design
   canvas's, size by size, not a scale of one master: the small sizes deliberately drop detail (no
   eye glints under 92, no mouth at 30) rather than shrink it into mud.

   Exported so the fallback can be asserted on its own; nothing in the app should render it
   directly — `Mascot` decides when it is needed.
   ───────────────────────────────────────────────────────────────────────────────────────────── */

interface Geometry {
  /** Ear circle: diameter, and its inset from the left/right edge. */
  ear: number;
  earInset: number;
  /** Face oval: its top offset and its height. Width is always the full box. */
  faceTop: number;
  faceHeight: number;
  /** Eye ellipse: width, height, inset from the side, top offset. */
  eyeW: number;
  eyeH: number;
  eyeInset: number;
  eyeTop: number;
  /** Eye glint — only drawn at 92, where there is room for it to read as a highlight. */
  glint?: { w: number; h: number; inset: number; top: number };
  /** Mouth — dropped at 30, where it would be two pixels of mush. */
  mouth?: { w: number; h: number; left: number; top: number };
  /**
   * The face fill. At 30 he sits inside a filled jade disc, so his face is the ground colour and
   * a hairline ring would read as a halo. Override with `--mascot-face` if you need something else.
   */
  face: "card" | "ground";
}

const GEOMETRY: Record<MascotSize, Geometry> = {
  30: { ear: 11, earInset: 1, faceTop: 4, faceHeight: 26, eyeW: 7, eyeH: 9, eyeInset: 5, eyeTop: 11, face: "ground" },
  44: {
    ear: 16,
    earInset: 1,
    faceTop: 5,
    faceHeight: 39,
    eyeW: 11,
    eyeH: 13,
    eyeInset: 8,
    eyeTop: 17,
    mouth: { w: 6, h: 4, left: 19, top: 32 },
    face: "card",
  },
  64: {
    ear: 23,
    earInset: 2,
    faceTop: 8,
    faceHeight: 56,
    eyeW: 15,
    eyeH: 19,
    eyeInset: 12,
    eyeTop: 24,
    mouth: { w: 9, h: 6, left: 28, top: 46 },
    face: "card",
  },
  92: {
    ear: 33,
    earInset: 2,
    faceTop: 11,
    faceHeight: 81,
    eyeW: 22,
    eyeH: 27,
    eyeInset: 17,
    eyeTop: 33,
    glint: { w: 8, h: 10, inset: 26, top: 41 },
    mouth: { w: 12, h: 8, left: 40, top: 66 },
    face: "card",
  },
};

export function MascotDrawing({ size, state }: { size: MascotSize; state: MascotState }) {
  const g = GEOMETRY[size];
  const faceFill = `var(--mascot-face, var(--${g.face}))`;

  const ear: CSSProperties = {
    position: "absolute",
    top: 0,
    width: g.ear,
    height: g.ear,
    borderRadius: "50%",
    background: "var(--ink)",
  };
  const eye: CSSProperties = {
    position: "absolute",
    top: g.eyeTop,
    width: g.eyeW,
    height: g.eyeH,
    borderRadius: "50%",
    background: "var(--ink)",
  };
  const glint: CSSProperties | null = g.glint
    ? {
        position: "absolute",
        top: g.glint.top,
        width: g.glint.w,
        height: g.glint.h,
        borderRadius: "50%",
        background: faceFill,
      }
    : null;
  const glintInset = g.glint?.inset ?? 0;

  return (
    <>
      {/* Ears, behind the face so they read as ears and not as antennae. */}
      <span style={{ ...ear, left: g.earInset }} />
      <span style={{ ...ear, right: g.earInset }} />

      {/* Face. The hairline ring is what keeps him from vanishing on a white card. */}
      <span
        style={{
          position: "absolute",
          left: 0,
          top: g.faceTop,
          width: size,
          height: g.faceHeight,
          borderRadius: "50%",
          background: faceFill,
          boxShadow: g.face === "card" ? "inset 0 0 0 1px var(--hairline)" : undefined,
        }}
      />

      <span style={{ ...eye, left: g.eyeInset }} />
      <span style={{ ...eye, right: g.eyeInset }} />
      {glint && <span style={{ ...glint, left: glintInset }} />}
      {glint && <span style={{ ...glint, right: glintInset }} />}

      {g.mouth && (
        <span
          className={state === "speaking" ? "animate-wv" : undefined}
          style={{
            position: "absolute",
            left: g.mouth.left,
            top: g.mouth.top,
            width: g.mouth.w,
            height: g.mouth.h,
            borderRadius: g.mouth.h,
            background: "var(--ink)",
            transformOrigin: "center",
          }}
        />
      )}
    </>
  );
}
