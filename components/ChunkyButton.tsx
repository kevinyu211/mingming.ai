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

const VARIANT: Record<ChunkyVariant, { fill: string; ink: string; edge: string; weight: number }> = {
  jade: {
    fill: "var(--jade)",
    ink: "#ffffff", // 5.05:1 on --jade, so it passes AA at any text size
    edge: "var(--jade-shadow)",
    weight: 700,
  },
  tinted: {
    fill: "var(--jade-tint)",
    ink: "var(--jade-ink)", // 5.34:1 on --jade-tint
    edge: "var(--jade-edge)",
    weight: 700,
  },
  neutral: {
    fill: "var(--neutral)",
    /*
     * The canvas uses #5C594F here (6.00:1). That grey did not survive the palette collapse, and
     * --muted, the token that replaced it, is only 4.56:1 on this fill — the floor, not a
     * comfortable reading, for a 19px action label. --ink at 12.72:1 is the honest choice; this
     * button recedes through its fill, which is what makes it the quiet one, not through weak text.
     */
    ink: "var(--ink)",
    edge: "var(--neutral-edge)",
    weight: 500,
  },
};

const SIZE: Record<ChunkySize, { padding: string; font: number; radius: number }> = {
  lg: { padding: "24px 20px", font: 22, radius: 20 },
  md: { padding: "18px 16px", font: 19, radius: 16 },
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
          border: 0,
          minHeight: 48,
          cursor: disabled ? "default" : "pointer",
          ...style,
        } as CSSProperties
      }
    />
  );
}
