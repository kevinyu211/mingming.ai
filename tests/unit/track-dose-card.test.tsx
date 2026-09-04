/**
 * 跟進's dose cards — the four things a card is allowed to say, and the three it is not.
 *
 * Rendered with `react-dom/server` rather than a DOM harness: this repo's vitest runs in `node`
 * with no jsdom, and everything asserted here is in the markup either way. `LocaleProvider` works
 * under a static render because its defaults (traditional Chinese, Cantonese) are the ones it
 * starts on, and the effect that reads stored preferences never runs.
 *
 * The targets come from `doseTargets()` on a real reading rather than from hand-written objects,
 * so what is asserted is the whole chain the screen actually uses: printed clause → `timesPerDay`
 * → what the card is allowed to put on screen.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/components/LocaleProvider";
import DoseCard from "@/components/track/DoseCard";
import type { Medicine, Speakable, StoredReading } from "@/lib/domain/schemas";
import { UI } from "@/lib/i18n/ui";
import { doseTargets } from "@/lib/rules/doses";
import type { DoseState } from "@/lib/sheets";

const SPOKEN: Speakable = { yue: "yue", cmn: "cmn", en: "en" };
const SOURCE = { section: "Medications", lineIndex: 0, quote: "quoted line" };

/** Midday in Hong Kong, so the local calendar day is unambiguous (TZ is pinned in the config). */
const TODAY = new Date("2026-09-03T04:00:00.000Z");

function medicine(overrides: Partial<Medicine> = {}): Medicine {
  return {
    name: "Metoprolol",
    strength: "25mg",
    amount: "1 粒",
    frequency: "每日兩次，隨餐",
    duration: null,
    status: "current",
    spoken: SPOKEN,
    source: SOURCE,
    ...overrides,
  };
}

function reading(medicines: Medicine[]): StoredReading {
  return {
    sheetType: "hk_en",
    warningSigns: [],
    medicines,
    followUp: [],
    dietLine: null,
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
    readAt: "2026-09-01T02:00:00.000Z",
  };
}

/** Renders the card for one medicine, exactly as 跟進 builds it. */
function card(overrides: Partial<Medicine>, state?: DoseState): string {
  const [target] = doseTargets(reading([medicine(overrides)]));
  return renderToStaticMarkup(
    <LocaleProvider>
      <DoseCard target={target} state={state} today={TODAY} onTake={() => {}} />
    </LocaleProvider>,
  );
}

const TAKE = UI.hant["dose.take"];

describe("what a dose card quotes", () => {
  it("quotes the printed frequency verbatim, behind 「張紙寫：」", () => {
    const html = card({ frequency: "每日兩次，隨餐" });
    expect(html).toContain("張紙寫：每日兩次，隨餐");
  });

  it("says the usage was not printed rather than leaving the line blank", () => {
    const html = card({ frequency: null });
    expect(html).toContain(UI.hant["card.missingFrequency"]);
    expect(html).not.toContain("張紙寫：");
  });

  it("puts the name and the strength together, as the page prints them", () => {
    expect(card({})).toContain("Metoprolol 25mg");
  });
});

describe("a counter counts times, never a clock", () => {
  it("counts down the times the page printed", () => {
    expect(card({ frequency: "每日兩次，隨餐" })).toContain("今日仲有 2 次");
    expect(card({ frequency: "每日兩次，隨餐" }, { key: "m0", taken: 1, day: "2026-09-03" })).toContain(
      "今日仲有 1 次",
    );
  });

  it("says 今日食晒 once the day's times are done, and the button stops responding", () => {
    const html = card({ frequency: "每日兩次，隨餐" }, { key: "m0", taken: 2, day: "2026-09-03" });
    expect(html).toContain(UI.hant["dose.done"]);
    expect(html).toContain("disabled");
  });

  it("starts again at the full count on a new local calendar day", () => {
    // Yesterday's count belongs to yesterday. Nothing has to fire overnight for this to be true.
    const html = card({ frequency: "每日兩次，隨餐" }, { key: "m0", taken: 2, day: "2026-09-02" });
    expect(html).toContain("今日仲有 2 次");
  });

  it("never prints a time of day beside a medicine", () => {
    for (const frequency of ["每日兩次，隨餐", "每四小時一次", "BD with meals", "痛先食", null]) {
      const html = card({ frequency });
      // A frequency clause is quoted verbatim, so the assertion has to be about what the card
      // ADDS: no hour:minute anywhere outside the quote, and none of these clauses contain one.
      expect(html, String(frequency)).not.toMatch(/\d{1,2}:\d{2}/);
      expect(html, String(frequency)).not.toMatch(/\b\d{1,2}\s?(am|pm|AM|PM)\b/);
    }
  });
});

describe("a clause the rules could not read gets no number at all", () => {
  it("「每四小時一次」 shows the printed clause and NOTHING countable", () => {
    // Perfectly readable to a person, and deliberately not countable: an interval is not a number
    // of times a day, and six doses inferred from "every four hours" would be the app scheduling
    // what the page timed. Contrast 「每朝一次」, which states one dose a day and IS counted — the
    // line is whether a count was printed, not whether the clock is mentioned.
    const html = card({ frequency: "每四小時一次" });
    expect(html).toContain("張紙寫：每四小時一次");
    expect(html).not.toContain("今日仲有");
    expect(html).not.toContain(UI.hant["dose.done"]);
    expect(html).not.toContain(TAKE);
  });

  it("an as-needed medicine is never counted down and gets no button", () => {
    const html = card({ frequency: "痛嘅時候食，一日最多四次" });
    expect(html).toContain(UI.hant["dose.asNeeded"]);
    expect(html).not.toContain("今日仲有");
    expect(html).not.toContain(TAKE);
  });
});

describe("a stopped medicine is never a dose", () => {
  it("still appears — the family needs to know the page names it", () => {
    const html = card({ status: "stopped", name: "Warfarin", frequency: "每日一次" });
    expect(html).toContain("Warfarin");
    expect(html).toContain("張紙寫：每日一次");
  });

  it("has no counter and no 食咗 button, whatever its line printed", () => {
    for (const status of ["stopped", "changed"] as const) {
      const html = card({ status, frequency: "每日兩次，隨餐" });
      expect(html, status).toContain(UI.hant["dose.stopped"]);
      expect(html, status).not.toContain("今日仲有");
      expect(html, status).not.toContain(UI.hant["dose.done"]);
      expect(html, status).not.toContain(TAKE);
    }
  });
});

describe("contrast rules the palette calls out by name", () => {
  it("never puts --muted on --paper, and never --warn-stroke on --warn-btn", () => {
    const html = card({ frequency: "每日兩次，隨餐" });
    expect(html).not.toMatch(/bg-paper[^"]*text-muted|text-muted[^"]*bg-paper/);
    expect(html).not.toMatch(/bg-warn-btn[^"]*text-warn-stroke|text-warn-stroke[^"]*bg-warn-btn/);
  });
});
