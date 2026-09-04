/**
 * The six-page ceiling on `/capture`.
 *
 * This is the single most important rule on that screen, and it is a rule about REFUSING, not
 * about capping: a Hong Kong patient walks out holding 出院紙, 覆診紙, 抽血紙 and 治療處方, with the
 * follow-up date on a different sheet from the medicines (docs/real-sheet-evidence.md §1). A page
 * that is dropped without anybody being told is a missing medicine, so `admitPages` has to report
 * the overflow rather than swallow it.
 */
import { describe, expect, it } from "vitest";
import { MAX_PAGES, PENDING_IMAGES_KEY, admitPages } from "@/components/Capture";

describe("the six-page ceiling", () => {
  it("is six — the whole discharge stack, with room to spare", () => {
    expect(MAX_PAGES).toBe(6);
  });

  it("takes everything while there is room, and turns nothing away", () => {
    expect(admitPages(0, 1)).toEqual({ accepted: 1, turnedAway: 0 });
    expect(admitPages(0, 6)).toEqual({ accepted: 6, turnedAway: 0 });
    expect(admitPages(4, 2)).toEqual({ accepted: 2, turnedAway: 0 });
  });

  it("reports the overflow instead of silently dropping it", () => {
    // Eight photographs of a discharge stack, six slots. The two that do not fit are COUNTED, so
    // the screen can say how many and why rather than quietly keeping the first six.
    expect(admitPages(0, 8)).toEqual({ accepted: 6, turnedAway: 2 });
    expect(admitPages(5, 3)).toEqual({ accepted: 1, turnedAway: 2 });
  });

  it("refuses outright once the ceiling is reached, and still says how many were refused", () => {
    expect(admitPages(6, 1)).toEqual({ accepted: 0, turnedAway: 1 });
    expect(admitPages(6, 4)).toEqual({ accepted: 0, turnedAway: 4 });
  });

  it("never accepts more than the room available, whatever it is handed", () => {
    for (let held = 0; held <= 10; held += 1) {
      for (let chosen = 0; chosen <= 10; chosen += 1) {
        const { accepted, turnedAway } = admitPages(held, chosen);
        expect(accepted).toBeGreaterThanOrEqual(0);
        expect(turnedAway).toBeGreaterThanOrEqual(0);
        // Nothing is invented and nothing vanishes: every chosen file is either in or reported.
        expect(accepted + turnedAway).toBe(chosen);
        expect(Math.min(held, MAX_PAGES) + accepted).toBeLessThanOrEqual(MAX_PAGES);
      }
    }
  });

  it("survives a nonsensical count rather than producing a negative one", () => {
    expect(admitPages(-3, 2)).toEqual({ accepted: 2, turnedAway: 0 });
    expect(admitPages(2, -1)).toEqual({ accepted: 0, turnedAway: 0 });
    expect(admitPages(2.7, 3.9)).toEqual({ accepted: 3, turnedAway: 0 });
  });
});

describe("the pages leave this component one way only", () => {
  it("keeps the sessionStorage key the reading screen clears", () => {
    // The reading screen reads this key once and removes it in a `finally`, so the photographed
    // bytes live in one tab for a few milliseconds and nowhere else (FR-018, constitution V).
    // Renaming it here without renaming it there would strand the pages in sessionStorage.
    expect(PENDING_IMAGES_KEY).toBe("fitornot.pending-images");
  });
});
