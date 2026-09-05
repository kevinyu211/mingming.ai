/**
 * The discharge card says only what the page says, and the share intent is a rule.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SheetReading, StoredReading } from "@/lib/domain/schemas";
import { UI } from "@/lib/i18n/ui";
import { checkText } from "@/lib/rules/banned-terms";
import { buildCards } from "@/lib/rules/card-order";
import { applyDietRules } from "@/lib/rules/diet-line";
import { draftPlan } from "@/lib/rules/plan-from-reading";
import { buildShareCard, detectShareIntent, MAX_MEDICINES } from "@/lib/share/card";

function reading(): StoredReading {
  const raw = JSON.parse(
    readFileSync(new URL("../../fixtures/sheets/hk_en.expected.json", import.meta.url), "utf8"),
  ) as SheetReading;
  return { ...raw, dietLine: applyDietRules(raw), readAt: "2026-09-05T01:00:00.000Z" };
}

const strings = {
  eyebrow: UI.hant["share.cardEyebrow"],
  warnings: UI.hant["share.warnings"],
  medicines: UI.hant["share.cardMeds"],
  visit: UI.hant["track.nextVisit"],
  printed: UI.hant["card.printed"],
  missingFrequency: UI.hant["card.missingFrequency"],
  more: UI.hant["share.more"],
  aiLine: UI.hant["aiChip"],
  footer: UI.hant["share.footer"],
  disclaimer: UI.hant["disclaimer"],
};

describe("the discharge card", () => {
  const r = reading();
  const card = buildShareCard({
    reading: r,
    plan: draftPlan(r),
    cards: buildCards(r),
    dialect: "yue",
    title: "SOPD",
    dateLabel: "9月5日",
    visitDate: "",
    strings,
  });

  it("quotes every medicine verbatim with the printed clause, never a clock time", () => {
    expect(card.medicines.length).toBe(Math.min(r.medicines.length, MAX_MEDICINES));
    for (const [i, medicine] of card.medicines.entries()) {
      expect(medicine.name).toContain(r.medicines[i].name);
      expect(medicine.printed).toContain(r.medicines[i].frequency ?? "");
      expect(medicine.printed).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });

  it("puts the warning signs first and carries the AI line and the disclaimer", () => {
    expect(card.warnings.length).toBe(r.warningSigns.length);
    expect(card.aiLine).toBe(UI.hant["aiChip"]);
    expect(card.disclaimer).toBe(UI.hant["disclaimer"]);
  });

  it("passes the banned-term filter on every line but the mandated disclaimer", () => {
    const lines = [
      card.eyebrow, card.title, card.meta, card.warningsTitle, ...card.warnings,
      card.medicinesTitle, ...card.medicines.flatMap((m) => [m.name, m.printed]),
      card.visitTitle, card.visit ?? "", card.aiLine, card.footer,
    ];
    for (const line of lines) expect(checkText(line).ok, line).toBe(true);
  });
});

describe("asking for the card is recognised without a model", () => {
  it("hears the three languages' ways of asking to send it on", () => {
    for (const line of ["發畀我個女", "发给我女儿", "傳俾屋企人", "分享", "Send this to my daughter.", "share it with my son", "出院卡"]) {
      expect(detectShareIntent(line), line).toBe(true);
    }
  });
  it("leaves ordinary questions to the model", () => {
    for (const line of ["幾時覆診？", "What is Metoprolol for?", "我個女話要食多啲菜", "send"]) {
      expect(detectShareIntent(line), line).toBe(false);
    }
  });
});
