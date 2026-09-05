import { beforeEach, describe, expect, it } from "vitest";
import { buildCards } from "@/lib/rules/card-order";
import { getSheetCards, loadSheets, startSheet } from "@/lib/sheets";
import { legacySheetCards, validateReadingCards } from "@/lib/sheets/cards";
import type { Card, Medicine, StoredReading } from "@/lib/domain/schemas";
import type { Sheet } from "@/lib/sheets/types";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
const SOURCE = { section: "Medication", lineIndex: 0, quote: "Metoprolol 25mg BD" };
const SPOKEN = { yue: "食藥", cmn: "吃药", en: "Take the medicine." };

function medicine(overrides: Partial<Medicine> = {}): Medicine {
  return {
    name: "Metoprolol",
    strength: "25mg",
    amount: "1 粒",
    frequency: "每日兩次",
    duration: null,
    status: "current",
    spoken: SPOKEN,
    source: SOURCE,
    ...overrides,
  };
}

function reading(overrides: Partial<StoredReading> = {}): StoredReading {
  return {
    sheetType: "hk_en",
    warningSigns: [],
    medicines: [medicine()],
    followUp: [],
    dietLine: null,
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
    readAt: "2026-09-05T11:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  storage.removeItem("fitornot.v1");
  (globalThis as { window?: unknown }).window = {
    localStorage: storage as unknown as Storage,
    addEventListener() {},
    removeEventListener() {},
  };
});

describe("canonical sheet cards", () => {
  it("persists filtered wording and authoritative flags through reload", () => {
    const r = reading();
    const cards = buildCards(r);
    const medicineCard = cards.find((card) => card.id === "medicine-0") as Card;
    const canonical = cards.map((card) =>
      card.id === medicineCard.id
        ? {
            ...card,
            body: {
              yue: "張紙寫住呢隻藥。",
              cmn: "纸上写着这个药。",
              en: "The sheet lists this medicine.",
            },
            aiGenerated: false,
            unverified: true,
          }
        : card,
    );

    startSheet(r, 1, canonical);
    const reloaded = loadSheets().active as Sheet;
    expect(reloaded.validatedCards).toEqual(canonical);
    expect(getSheetCards(reloaded)).toEqual(canonical);
    expect(reloaded.reading.medicines[0].status).toBe("current");
  });

  it("rejects an incomplete, reordered, or cross-reading card set", () => {
    const r = reading();
    const cards = buildCards(r);
    expect(() => startSheet(r, 1, [])).toThrow(/cards/i);

    const other = reading({ medicines: [medicine({ name: "Atenolol", strength: "50mg", source: { ...SOURCE, quote: "Atenolol 50mg OD" } })] });
    expect(() => startSheet(r, 1, buildCards(other))).toThrow(/cards/i);

    const wrongType = [{ ...cards[0], type: "medicine" as const }];
    expect(() => startSheet(r, 1, wrongType)).toThrow(/cards/i);
  });

  it("marks a legacy medicine whose typed identity disagrees with its quote", () => {
    const r = reading({ medicines: [medicine({ source: { ...SOURCE, quote: "Different medicine 25mg" } })] });
    const cards = legacySheetCards(r);
    expect(cards.find((card) => card.id === "medicine-0")?.unverified).toBe(true);
  });

  it("adds the unverified marker when canonical input omits it for a mismatched medicine", () => {
    const r = reading({ medicines: [medicine({ source: { ...SOURCE, quote: "Different medicine 25mg" } })] });
    const supplied = buildCards(r).map((card) => ({ ...card, unverified: false }));
    const validated = validateReadingCards(r, supplied);
    expect(validated?.find((card) => card.id === "medicine-0")?.unverified).toBe(true);
  });

  it("uses a checked template when legacy wording trips the safety filter", () => {
    const r = reading({
      medicines: [
        medicine({
          spoken: { yue: "你應該食呢隻藥。", cmn: "你应该吃这个药。", en: "You should take this medicine." },
        }),
      ],
    });
    const card = legacySheetCards(r).find((candidate) => candidate.id === "medicine-0") as Card;
    expect(card.aiGenerated).toBe(false);
    expect(card.body.en).not.toContain("You should");
    expect(card.body.en).toContain("Metoprolol");
  });
});
