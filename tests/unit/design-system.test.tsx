/**
 * The two pieces of the v2 design system that carry a rule rather than a look.
 *
 * Rendered with `react-dom/server` rather than a DOM harness: this repo's vitest runs in `node`
 * with no jsdom, and everything asserted here is in the markup either way.
 *
 * `Mascot` and `ChunkyButton` are the two that need no locale context. `TabBar` still needs Next's
 * router, so its frost class is asserted from the source contract in ChatHeader instead, which
 * only needs `LocaleProvider`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import ChatHeader from "@/components/chat/ChatHeader";
import ChunkyButton from "@/components/ChunkyButton";
import { LocaleProvider } from "@/components/LocaleProvider";
import Mascot, {
  MASCOT,
  MascotDrawing,
  type MascotSize,
  type MascotState,
} from "@/components/Mascot";
import TabBar from "@/components/TabBar";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    className?: string;
    [key: string]: unknown;
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const SIZES: MascotSize[] = [30, 44, 64, 92];
const STATES: MascotState[] = ["idle", "speaking", "listening", "greeting"];
const ANIMALS = ["cat", "panda", "puppy", "rabbit"];

describe("明明 is decoration, and says so", () => {
  it("is aria-hidden at every size and state", () => {
    for (const size of SIZES) {
      for (const state of STATES) {
        const html = renderToStaticMarkup(<Mascot size={size} state={state} />);
        expect(html, `size ${size} / ${state}`).toContain('aria-hidden="true"');
      }
    }
  });

  it("never labels the picture", () => {
    // He always appears next to his name as real text (`mascot.name`). A label on the picture as
    // well would make a screen reader say 明明 twice, and an alt text would make it say it wrong —
    // so the alt is empty, which is what marks an image as decoration rather than content.
    for (const size of SIZES) {
      const html = renderToStaticMarkup(<Mascot size={size} />);
      expect(html).not.toMatch(/aria-label|role="img"|title=/);
      expect(html).toContain('alt=""');
      expect(html.match(/alt="[^"]/)).toBeNull();
    }
  });

  it("renders at the canvas's four sizes and nothing is zero-width", () => {
    for (const size of SIZES) {
      const html = renderToStaticMarkup(<Mascot size={size} />);
      expect(html, `size ${size}`).toContain(`width:${size}px`);
      expect(html).not.toContain("width:0px");
      // Explicit width and height on the image itself, so a slow mascot never reflows the thread.
      expect(html, `size ${size}`).toContain(`width="${size}"`);
      expect(html, `size ${size}`).toContain(`height="${size}"`);
    }
  });
});

describe("明明's art is shipped, and every state points at a file that exists", () => {
  it("asks for the chosen animal's file for the state it is in, and asks for it directly", () => {
    for (const state of STATES) {
      const html = renderToStaticMarkup(<Mascot size={44} state={state} />);
      expect(html, state).toContain(`src="/mascot/${MASCOT}/${state}.webp"`);
      expect(html, state).toContain("/mascot/panda/");
      // Straight at the file: /_next/image would re-encode an already-sized WebP, cap the srcset
      // at 2× on a 3× phone, and hand a non-WebP client a black JPEG square.
      expect(html, state).not.toContain("_next/image");
    }
  });

  it("renders a preview animal when the animal prop is set", () => {
    const html = renderToStaticMarkup(<Mascot size={44} animal="cat" />);
    expect(html).toContain('src="/mascot/cat/idle.webp"');
    expect(html).not.toContain("/mascot/panda/");
  });

  it("ships all four animals, so switching MASCOT is a one-word change", () => {
    for (const animal of ANIMALS) {
      for (const state of STATES) {
        const file = fileURLToPath(
          new URL(`../../public/mascot/${animal}/${state}.webp`, import.meta.url),
        );
        expect(existsSync(file), `${animal}/${state}`).toBe(true);
      }
    }
  });

  it("preloads the two above-the-fold placements and never the repeating avatar", () => {
    // 64 is the home conversation row, 92 the empty-home / consent plate — one of each per page.
    // 30 is the thread avatar: twenty identical preload tags for one small file would be twenty
    // mistakes.
    expect(renderToStaticMarkup(<Mascot size={64} />)).toContain("preload");
    expect(renderToStaticMarkup(<Mascot size={92} />)).toContain("preload");
    expect(renderToStaticMarkup(<Mascot size={30} />)).not.toContain("preload");
    expect(renderToStaticMarkup(<Mascot size={44} />)).not.toContain("preload");
  });

  it("breathes, and never bounces", () => {
    const idle = renderToStaticMarkup(<Mascot size={92} state="idle" />);
    expect(idle).toContain("animate-breathe");
    expect(idle).not.toContain("animate-edge");
    const speaking = renderToStaticMarkup(<Mascot size={92} state="speaking" />);
    expect(speaking).toContain("animate-breathe");
    expect(speaking).not.toContain("animate-bob");
    const greeting = renderToStaticMarkup(<Mascot size={92} state="greeting" />);
    expect(greeting).toContain("animate-breathe");
    expect(greeting).not.toContain("animate-attention");
    const listening = renderToStaticMarkup(<Mascot size={92} state="listening" />);
    expect(listening).toContain("animate-breathe");
    expect(listening).toContain("animate-edge");
  });

  it("sits still when motion is off", () => {
    const html = renderToStaticMarkup(<Mascot size={64} state="greeting" motion={false} />);
    expect(html).not.toContain("animate-attention");
    expect(html).not.toContain("animate-breathe");
    expect(html).not.toContain("animate-bob");
  });
});

describe("明明 still has a drawing to fall back on", () => {
  // The art can 404 or the network can give up, and a broken-image icon on the demo phone is worse
  // than anything a few divs cost. `Mascot` swaps to this on the image's own error event.
  it("drops the mouth at 30 and the eye glints below 92, as the canvas does", () => {
    // Small sizes lose detail instead of shrinking it into mud.
    const at30 = renderToStaticMarkup(<MascotDrawing size={30} state="speaking" />);
    const at92 = renderToStaticMarkup(<MascotDrawing size={92} state="speaking" />);
    const at44 = renderToStaticMarkup(<MascotDrawing size={44} state="idle" />);

    expect(at30).not.toContain("animate-wv"); // no mouth at 30, so nothing to pulse
    expect(at92).toContain("animate-wv");
    // The glint is the only part painted in the face colour rather than the ink.
    expect(at92.match(/background:#fff|background:var\(--mascot-face/g)?.length).toBeGreaterThan(1);
    expect(at44).not.toContain("top:41px");
  });

  it("needs no image and no network", () => {
    for (const size of SIZES) {
      const html = renderToStaticMarkup(<MascotDrawing size={size} state="idle" />);
      expect(html, `size ${size}`).not.toMatch(/<img|<image|url\(|\.webp|\.png|\.svg/);
    }
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

function chatHeader(mascotState?: MascotState): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <ChatHeader
        title="出院紙"
        capturedAt="2026-09-01T00:00:00.000Z"
        speakerOn
        onToggleSpeaker={() => {}}
        onBack={() => {}}
        langOpen={false}
        onOpenLang={() => {}}
        onCloseLang={() => {}}
        mascotState={mascotState}
      />
    </LocaleProvider>,
  );
}

describe("ChatHeader frosts the chrome and keeps 明明 in it", () => {
  it("uses the same frost as the tab bar", () => {
    const html = chatHeader();
    expect(html).toContain("bg-ground/80");
    expect(html).toContain("backdrop-blur-xl");
  });

  it("sits 明明 between the back button and the title", () => {
    const html = chatHeader();
    const back = html.indexOf("‹");
    const mascot = html.indexOf("/mascot/panda/idle.webp");
    const title = html.indexOf("出院紙");
    expect(back).toBeGreaterThan(-1);
    expect(mascot).toBeGreaterThan(back);
    expect(title).toBeGreaterThan(mascot);
  });

  it("defaults to idle and follows listening and speaking", () => {
    expect(chatHeader()).toContain("/mascot/panda/idle.webp");
    expect(chatHeader("listening")).toContain("/mascot/panda/listening.webp");
    expect(chatHeader("speaking")).toContain("/mascot/panda/speaking.webp");
  });

  it("does not plant a 92px companion over the medical text", () => {
    expect(chatHeader("speaking")).not.toContain("width:92px");
    expect(chatHeader("speaking")).toContain("width:44px");
  });
});

describe("the tab bar frosts without covering the disclaimer", () => {
  it("keeps the hairline and sits above the footer", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <TabBar active="record" />
      </LocaleProvider>,
    );
    expect(html).toContain("bg-ground/80");
    expect(html).toContain("backdrop-blur-xl");
    expect(html).toContain("border-hairline");
    expect(html).toContain("bottom-[var(--disclaimer-height)]");
  });

  it("puts the active tab on the companion plate", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <TabBar active="record" />
      </LocaleProvider>,
    );
    expect(html).toContain("companion-plate");
    expect(html).toContain("rounded-full");
    expect(html).toContain("var(--companion-ink)");
  });
});

describe("consent opens with 明明 waving", () => {
  it("replaced the app mark and still unlocks audio on the same tap", () => {
    const src = readFileSync(new URL("../../components/ConsentGate.tsx", import.meta.url), "utf8");
    expect(src).toContain('<Mascot size={92} state="greeting" />');
    expect(src).not.toContain("function AppMark");
    expect(src).toContain("unlockAudio()");
    expect(src).toContain('t("consent.button")');
  });

  it("sits him on the companion plate, not floating on cream", () => {
    const src = readFileSync(new URL("../../components/ConsentGate.tsx", import.meta.url), "utf8");
    expect(src).toContain("companion-plate");
    expect(src).toContain("rounded-full");
  });
});

describe("記錄 puts 明明 where a bystander can see him", () => {
  it("opens empty with the 92px greeting above the camera, not a 64px footnote under it", () => {
    const src = readFileSync(
      new URL("../../components/home/HomeScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toContain('<Mascot size={92} state="greeting" />');
    expect(src).not.toContain("<Mascot size={64} state=\"greeting\" />");
    const plate = src.indexOf('<Mascot size={92} state="greeting" />');
    const cameras = src.indexOf("<CaptureButtons size=\"lg\" />");
    expect(plate).toBeGreaterThan(-1);
    expect(cameras).toBeGreaterThan(plate);
  });

  it("draws the conversation row at 64px, never the 30px thread avatar", () => {
    const src = readFileSync(
      new URL("../../components/home/CheckinNotice.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toContain("<Mascot size={64}");
    expect(src).not.toContain("<Mascot size={30}");
    expect(src).toContain('t("tab.chat")');
    expect(src).toContain("companion-plate");
    expect(src).not.toContain("bg-jade");
  });
});

describe("each animal wears a colour of its own", () => {
  it("gives four different plates, and never uses jade as a cat or rabbit fill", async () => {
    const { ANIMAL_THEME } = await import("@/lib/mascot-theme");
    const plates = Object.values(ANIMAL_THEME).map((theme) => theme.plate);
    expect(new Set(plates).size).toBe(4);
    expect(ANIMAL_THEME.cat.plate).not.toBe(ANIMAL_THEME.panda.plate);
    expect(ANIMAL_THEME.rabbit.ink).not.toBe(ANIMAL_THEME.panda.ink);
    // Companion D: the default companion sits in the assistant's lilac, not the v2 jade tint.
    expect(ANIMAL_THEME.panda.plate).toBe("#A08AAF");
  });
});
