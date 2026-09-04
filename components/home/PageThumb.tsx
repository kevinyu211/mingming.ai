/**
 * The little ruled page that stands for a sheet in a list (the canvas draws it on the 傾緊呢張
 * card, on every 以前嘅 row, and on 跟進's 跟緊呢張紙 strip).
 *
 * It is a DRAWING, not the photograph. The photograph of a discharge sheet never reaches
 * localStorage (constitution V) and is gone within a navigation of being read, so there is no
 * thumbnail to show and inventing one would be a lie about what the app kept. A generic page is
 * the honest picture of "a sheet", and it costs no bytes and cannot 404 on the demo phone.
 *
 * `aria-hidden`: every place it appears, the sheet's real title sits beside it as text.
 */
export type ThumbSize = "lg" | "sm" | "xs";

const GEOMETRY: Record<ThumbSize, { w: number; h: number; pad: number; gap: number; rule: number; lines: number[] }> = {
  // The canvas's 52x66 card thumbnail: six rules, the first one jade.
  lg: { w: 52, h: 66, pad: 8, gap: 4, rule: 3, lines: [100, 80, 100, 62, 100, 74] },
  // 跟進's 30x38 strip thumbnail: four rules.
  xs: { w: 30, h: 38, pad: 4, gap: 3, rule: 2, lines: [100, 72, 100, 56] },
  // The archive row's 40x52: no rules at all, exactly as the canvas draws it — a read-only sheet
  // is a closed page, and the quiet row is the point.
  sm: { w: 40, h: 52, pad: 0, gap: 0, rule: 0, lines: [] },
};

export default function PageThumb({ size = "lg" }: { size?: ThumbSize }) {
  const g = GEOMETRY[size];

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 flex-col bg-paper"
      style={{
        width: g.w,
        height: g.h,
        borderRadius: size === "lg" ? 6 : size === "sm" ? 5 : 4,
        padding: g.pad ? `${g.pad + 1}px ${g.pad}px` : 0,
        gap: g.gap,
        boxSizing: "border-box",
      }}
    >
      {g.lines.map((width, index) => (
        <span
          key={index}
          style={{
            height: g.rule,
            width: `${width}%`,
            borderRadius: 2,
            // The top rule is the heading of the page, in jade; the rest are body text. Both are
            // decoration and carry no words, which is the only reason a low-contrast fill is right.
            background:
              index === 0 ? "var(--jade)" : "color-mix(in srgb, var(--ink) 22%, var(--paper))",
          }}
        />
      ))}
    </span>
  );
}
