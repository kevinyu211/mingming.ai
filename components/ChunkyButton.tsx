/**
 * The pressable from the design canvas: a flat fill with a hard `0 4px 0` edge under it that the
 * button sinks INTO when pressed (`transform: translateY(4px)`, shadow to zero).
 *
 * Why a fake 3D edge in 2026: the user is seventy-something, holding the phone at arm's length,
 * often without her glasses, and cannot feel a hover state or see a 200ms opacity dip. A 4px
 * physical drop is the one press affordance that survives all of that. The physics live in the
 * `.chunky` utility in globals.css so anything else that needs them (the dose 食咗 button, the
 * camera's 完成) can borrow them without importing this component.
 *
 * Always a real `<button>`: it must be reachable by keyboard, announce itself as a button, and
 * respond to Space and Enter. 48px minimum target, no exceptions (brief section 3).
 */
import type { ButtonHTMLAttributes, CSSProperties } from "react";

/**
 * jade    the one primary action on a screen — filled, white label
 * tinted  the equal-weight second choice (上載相片 next to 拍張紙)
 * neutral the quiet option in a pair (未食 next to 食咗, 再講一次 next to 明白)
 */
export type ChunkyVariant = "jade" | "tinted" | "neutral";

/** `lg` is a screen's main action (講俾我聽); `md` is a pair of buttons inside the thread. */
export type ChunkySize = "lg" | "md";

export interface ChunkyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ChunkyVariant;
  size?: ChunkySize;
  /** Fills its container. The two-button rows use `flex-1` on the parent instead. */
  fullWidth?: boolean;
}

/*
 * Atoms buttons are pills: charcoal for the one primary action, white with a stroke for the
 * second choice, paper-muted for the quiet option. No hard shadow, no border radius under 999.
 * Text on charcoal is white (15.4:1); on the two light fills it is charcoal.
 */
const VARIANT: Record<
  ChunkyVariant,
  { fill: string; ink: string; edge: string; weight: number; border: string }
> = {
  jade: {
    fill: "var(--ink)",
    ink: "#ffffff",
    // `.chunky` no longer draws the edge in the Atoms language; the custom property is still
    // published so anything that reads it keeps working.
    edge: "var(--jade-shadow)",
    weight: 600,
    border: "1px solid var(--ink)",
  },
  tinted: {
    fill: "var(--card)",
    ink: "var(--ink)",
    edge: "var(--jade-edge)",
    weight: 600,
    border: "1px solid var(--hairline)",
  },
  neutral: {
    fill: "var(--neutral)",
    ink: "var(--ink)",
    edge: "var(--neutral-edge)",
    weight: 500,
    border: "1px solid var(--neutral)",
  },
};

const SIZE: Record<ChunkySize, { padding: string; font: number; radius: number; height: number }> = {
  lg: { padding: "0 24px", font: 19, radius: 999, height: 56 },
  md: { padding: "0 20px", font: 17, radius: 999, height: 48 },
};

export default function ChunkyButton({
  variant = "jade",
  size = "md",
  fullWidth = false,
  className = "",
  style,
  type = "button",
  disabled,
  ...rest
}: ChunkyButtonProps) {
  const v = VARIANT[variant];
  const s = SIZE[size];

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      className={`chunky ${disabled ? "chunky-flat" : ""} ${fullWidth ? "w-full" : ""} ${className}`}
      style={
        {
          // `.chunky` reads this; a disabled button keeps the footprint and loses the lift.
          "--chunky-edge": v.edge,
          /*
           * A disabled button drops to the neutral fill whatever its variant, exactly as the
           * canvas draws 「揀最少一張」. Keeping the jade fill and only dimming the label put grey
           * text on a saturated green — the disabled state was the least legible thing on screen.
           */
          background: disabled ? "var(--neutral)" : v.fill,
          border: disabled ? "1px solid var(--neutral)" : v.border,
          /*
           * Its label still has a job — 「揀最少一張」 is telling you what to do next — so it stays
           * at --muted (4.56:1 on that fill), not the canvas's --faint (1.85:1). Disabled controls
           * are exempt from WCAG 1.4.3; a seventy-year-old at a ward window is not.
           */
          color: disabled ? "var(--muted)" : v.ink,
          fontSize: s.font,
          fontWeight: v.weight,
          lineHeight: 1.25,
          padding: s.padding,
          borderRadius: s.radius,
          minHeight: 48,
          height: s.height,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: disabled ? "default" : "pointer",
          ...style,
        } as CSSProperties
      }
    />
  );
}
