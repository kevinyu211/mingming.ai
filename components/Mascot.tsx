/**
 * 明仔 — the companion, drawn in CSS.
 *
 * Two ear circles, a round white face, two eyes, a mouth. No image asset, on purpose: the mascot
 * art does not exist yet, and a 404'd PNG on the demo phone would be worse than anything this
 * costs. Everything here is a positioned div, so he renders offline, at any pixel ratio, in the
 * palette's own tokens.
 *
 * ACCESSIBILITY. He is decoration. Every place he appears, his NAME appears next to him as real
 * text (「明仔」, from `mascot.name`), so labelling the drawing as well would make a screen reader
 * say his name twice. The root is `aria-hidden`; there is no `role`, no `aria-label`, no `title`.
 * If you are tempted to add one, add the name as visible text instead — that helps everyone.
 *
 * Geometry is the design canvas's, size by size, not a scale of one master: the small sizes
 * deliberately drop detail (no eye glints under 92, no mouth at 30) rather than shrink it into mud.
 */
import type { CSSProperties } from "react";

/** The four sizes the canvas draws. Nothing else is designed, so nothing else is offered. */
export type MascotSize = 30 | 44 | 64 | 92;

/**
 * `speaking` pulses the mouth while 明仔 types himself out; `listening` breathes a ring around
 * him while the microphone is open. Both are status, never a control — the same rule as the 讀住
 * waveform (brief section 6). Reduced motion stops them (globals.css).
 */
export type MascotState = "idle" | "speaking" | "listening";

export interface MascotProps {
  /** 30 notification avatar · 44 thread avatar · 64 empty state · 92 the reading screen. */
  size?: MascotSize;
  state?: MascotState;
  /** Extra classes for the wrapper — opacity, margins. The drawing itself is fixed. */
  className?: string;
  style?: CSSProperties;
}

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

export default function Mascot({ size = 44, state = "idle", className = "", style }: MascotProps) {
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
    <span
      aria-hidden="true"
      className={`relative block shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
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
    </span>
  );
}
