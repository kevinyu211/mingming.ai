import { describe, expect, it } from "vitest";

import hkEnFixture from "../../fixtures/sheets/hk_en.expected.json";
import { filterCards } from "@/lib/client/sample";
import { UI, UI_LOCALES, type UiLocale } from "@/lib/i18n/ui";
import { checkText } from "@/lib/rules/banned-terms";
import { buildCards } from "@/lib/rules/card-order";
import { AskReadingSchema } from "@/lib/server/ask-pipeline";
import { buildShareText, type ShareStrings } from "@/lib/share/text";

const reading = AskReadingSchema.parse(hkEnFixture);
const cards = filterCards(buildCards(reading));

function strings(locale: UiLocale): ShareStrings {
  const ui = UI[locale];
  return {
    title: ui["share.title"],
    warnings: ui["share.warnings"],
    medicines: ui["share.medicines"],
    followUp: ui["share.followUp"],
    other: ui["share.other"],
    footer: ui["share.footer"],
    disclaimer: ui["disclaimer"],
  };
}

describe("buildShareText", () => {
  it("puts the warning signs first, then medicines, then the visit, and ends on the disclaimer", () => {
    const text = buildShareText(cards, "yue", strings("hant"));
    const s = strings("hant");
    const at = (needle: string) => text.indexOf(needle);
    expect(at(s.title)).toBe(0);
    expect(at(s.warnings)).toBeGreaterThan(0);
    expect(at(s.medicines)).toBeGreaterThan(at(s.warnings));
    expect(at(s.followUp)).toBeGreaterThan(at(s.medicines));
    expect(text.endsWith(s.disclaimer)).toBe(true);
    for (const card of cards.filter((c) => c.type !== "referral")) {
      expect(text).toContain(card.body.yue);
    }
  });

  it("uses the requested language and the display conversion", () => {
    const text = buildShareText(cards, "cmn", strings("hans"), (line) => `«${line}»`);
    expect(text).toContain(`«${cards[0].body.cmn}»`);
    expect(text).not.toContain(cards[0].body.yue);
  });

  it("carries no banned term in any locale, apart from the disclaimer's own wording", () => {
    for (const locale of UI_LOCALES) {
      const dialect = locale === "hant" ? "yue" : locale === "hans" ? "cmn" : "en";
      const s = strings(locale);
      const text = buildShareText(cards, dialect, s).replace(s.disclaimer, "");
      expect(checkText(text).ok, locale).toBe(true);
    }
  });

  it("drops an empty group rather than printing a heading with nothing under it", () => {
    const text = buildShareText(cards.filter((c) => c.type === "medicine"), "en", strings("en"));
    expect(text).not.toContain(strings("en").warnings);
    expect(text).toContain(strings("en").medicines);
  });
});
