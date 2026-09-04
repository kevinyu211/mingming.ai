/**
 * The capture screen and the read route must agree on how many pages a discharge is.
 *
 * They disagreed once, and it was the worst kind of disagreement: `components/Capture.tsx` let the
 * user photograph six pages, and `app/api/read/route.ts` validated `max(2)`, so a three-page stack
 * was rejected outright with a 400 after the user had done all the work. Had the client instead
 * been "helpful" and posted only the first two, the app would have read a third of a medical
 * document and said nothing — the silent truncation the brief forbids in as many words.
 *
 * A comment cross-referencing the two numbers is not a guard. This is.
 */
import { describe, expect, it } from "vitest";

import { MAX_PAGES } from "@/components/Capture";

/**
 * Read out of the route's source rather than imported. `app/api/read/route.ts` pulls in the
 * Anthropic SDK at module scope, so importing it here would drag the whole model layer (and its
 * environment requirements) into a unit test that is about one integer.
 */
async function routeMaxPages(): Promise<number> {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../app/api/read/route.ts", import.meta.url),
    "utf8",
  );
  const declaration = source.match(/^const MAX_PAGES = (\d+);$/m);
  if (!declaration) throw new Error("app/api/read/route.ts no longer declares `const MAX_PAGES`");
  return Number(declaration[1]);
}

describe("the page ceiling", () => {
  it("is the same number on the camera and on the route", async () => {
    expect(await routeMaxPages()).toBe(MAX_PAGES);
  });

  /**
   * Six is not arbitrary. The Hospital Authority's own HKWC discharge checklist lists six documents
   * the patient is told to carry out (出院紙, 覆診紙, 繳費單, 病假紙, 抽血紙, 治療處方), and the
   * follow-up date is printed on a different sheet from the medicines — see
   * `docs/real-sheet-evidence.md`. Lowering this silently narrows what the app can read.
   */
  it("is six, the size of a Hong Kong discharge stack", () => {
    expect(MAX_PAGES).toBe(6);
  });

  it("validates the request schema at that ceiling, not below it", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../app/api/read/route.ts", import.meta.url), "utf8"),
    );
    // The schema must be expressed in terms of the constant, so the two cannot drift apart again.
    expect(source).toContain("z.array(ImageSchema).min(1).max(MAX_PAGES)");
  });
});
