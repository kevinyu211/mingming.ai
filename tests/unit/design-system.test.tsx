/**
 * The two pieces of the v2 design system that carry a rule rather than a look.
 *
 * Rendered with `react-dom/server` rather than a DOM harness: this repo's vitest runs in `node`
 * with no jsdom, and everything asserted here is in the markup either way.
 *
 * `Mascot` and `ChunkyButton` are the two that need no locale context. `TabBar` and `BottomSheet`
 * need `LocaleProvider` and Next's router, so their contract lives in the copy test and in the
 * Playwright pass instead.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChunkyButton from "@/components/ChunkyButton";
import Mascot, { type MascotSize, type MascotState } from "@/components/Mascot";

const SIZES: MascotSize[] = [30, 44, 64, 92];
const STATES: MascotState[] = ["idle", "speaking", "listening"];

describe("明仔 is decoration, and says so", () => {
  it("is aria-hidden at every size and state", () => {
    for (const size of SIZES) {
      for (const state of STATES) {
        const html = renderToStaticMarkup(<Mascot size={size} state={state} />);
        expect(html, `size ${size} / ${state}`).toContain('aria-hidden="true"');
      }
    }
  });

  it("never labels the drawing", () => {
    // He always appears next to his name as real text (`mascot.name`). A label on the drawing as
    // well would make a screen reader say 明仔 twice, and an alt text would make it say it wrong.
    for (const size of SIZES) {
      const html = renderToStaticMarkup(<Mascot size={size} />);
      expect(html).not.toMatch(/aria-label|role="img"|title=|alt=/);
    }
  });

  it("is drawn, not fetched — no image asset can 404 at the demo", () => {
    for (const size of SIZES) {
      const html = renderToStaticMarkup(<Mascot size={size} />);
      expect(html).not.toMatch(/<img|<image|url\(|\.png|\.svg/);
    }
  });

  it("renders at the canvas's four sizes and nothing is zero-width", () => {
    for (const size of SIZES) {
      const html = renderToStaticMarkup(<Mascot size={size} />);
      expect(html, `size ${size}`).toContain(`width:${size}px`);
      expect(html).not.toContain("width:0px");
    }
  });

  it("drops the mouth at 30 and the eye glints below 92, as the canvas does", () => {
    // Small sizes lose detail instead of shrinking it into mud.
    const at30 = renderToStaticMarkup(<Mascot size={30} state="speaking" />);
    const at92 = renderToStaticMarkup(<Mascot size={92} state="speaking" />);
    const at44 = renderToStaticMarkup(<Mascot size={44} />);

    expect(at30).not.toContain("animate-wv"); // no mouth at 30, so nothing to pulse
    expect(at92).toContain("animate-wv");
    // The glint is the only part painted in the face colour rather than the ink.
    expect(at92.match(/background:#fff|background:var\(--mascot-face/g)?.length).toBeGreaterThan(1);
    expect(at44).not.toContain("top:41px");
  });

  it("only animates when it has something to say", () => {
    const idle = renderToStaticMarkup(<Mascot size={92} state="idle" />);
    expect(idle).not.toContain("animate-wv");
    expect(idle).not.toContain("animate-edge");
    expect(renderToStaticMarkup(<Mascot size={92} state="listening" />)).toContain("animate-edge");
  });
});

describe("ChunkyButton is a real button", () => {
  it("renders a <button type=\"button\">, never a div", () => {
    const html = renderToStaticMarkup(<ChunkyButton>食咗</ChunkyButton>);
    expect(html.startsWith("<button")).toBe(true);
    expect(html).toContain('type="button"');
    expect(html).toContain("食咗");
  });

  it("keeps the 48px minimum target in both sizes", () => {
    for (const size of ["lg", "md"] as const) {
      expect(renderToStaticMarkup(<ChunkyButton size={size}>去</ChunkyButton>)).toContain(
        "min-height:48px",
      );
    }
  });

  it("carries the 0 4px 0 edge as a custom property the .chunky utility reads", () => {
    const jade = renderToStaticMarkup(<ChunkyButton variant="jade">去</ChunkyButton>);
    const tinted = renderToStaticMarkup(<ChunkyButton variant="tinted">去</ChunkyButton>);
    const neutral = renderToStaticMarkup(<ChunkyButton variant="neutral">去</ChunkyButton>);

    expect(jade).toContain("--chunky-edge:var(--jade-shadow)");
    expect(tinted).toContain("--chunky-edge:var(--jade-edge)");
    expect(neutral).toContain("--chunky-edge:var(--neutral-edge)");
    for (const html of [jade, tinted, neutral]) expect(html).toContain("chunky");
  });

  it("keeps a disabled label readable", () => {
    // 「揀最少一張」 is a disabled button whose label is telling you what to do next, so it stays
    // at --muted (4.56:1 on the fill) rather than the canvas's --faint (1.85:1).
    const html = renderToStaticMarkup(<ChunkyButton disabled>揀最少一張</ChunkyButton>);
    expect(html).toContain("color:var(--muted)");
    expect(html).not.toContain("var(--faint)");
    expect(html).toContain("chunky-flat");
    // And it drops to the neutral fill whatever the variant, so --muted lands on a fill it
    // actually passes on. Grey-on-jade was the first thing this preview caught.
    for (const variant of ["jade", "tinted", "neutral"] as const) {
      const dim = renderToStaticMarkup(
        <ChunkyButton variant={variant} disabled>
          揀最少一張
        </ChunkyButton>,
      );
      expect(dim, variant).toContain("background:var(--neutral)");
    }
  });
});
