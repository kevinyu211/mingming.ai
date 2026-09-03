import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  SheetReadingSchema,
  SpeakableSchema,
  sheetReadingJsonSchema,
  askResultJsonSchema,
  AskResultSchema,
} from "@/lib/domain/schemas";
import { checkText } from "@/lib/rules/banned-terms";

const fixtureDir = path.resolve(__dirname, "../../fixtures/sheets");
const fixtures = ["hk_en", "cn_zh", "cn_zh_photo"] as const;

/**
 * Every `Speakable` in a JSON tree, with the path that leads to it. Recognising one by its keys is
 * the point: if a `Speakable` ever loses a field, this stops finding it, and the count assertion
 * below is what catches that.
 */
function speakables(node: unknown, at = "$"): [string, Record<string, unknown>][] {
  if (Array.isArray(node)) return node.flatMap((v, i) => speakables(v, `${at}[${i}]`));
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  if (SpeakableSchema.safeParse(record).success) return [[at, record]];
  return Object.entries(record).flatMap(([k, v]) => speakables(v, `${at}.${k}`));
}

describe("SheetReading schema", () => {
  for (const name of fixtures) {
    const file = path.join(fixtureDir, `${name}.expected.json`);
    it(`validates fixtures/sheets/${name}.expected.json`, () => {
      expect(existsSync(file), `${file} missing (task T006)`).toBe(true);
      const json = JSON.parse(readFileSync(file, "utf8"));
      const result = SheetReadingSchema.safeParse(json);
      if (!result.success) {
        throw new Error(JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.data.medicines.length).toBe(3);
      expect(result.data.warningSigns.length).toBe(3);
      for (const m of result.data.medicines) {
        expect(m.spoken.yue).toContain(m.name);
        expect(m.spoken.cmn).toContain(m.name);
        // A drug name is never translated or transliterated, so it survives into English too.
        expect(m.spoken.en).toContain(m.name);
      }
    });
  }

  /**
   * The trilingual guarantee for the bundled sample sheets. These are what `lib/client/sample.ts`
   * loads when the model is unreachable, so a missing `en` here is a demo that cannot speak
   * English at exactly the moment the live path is already down.
   */
  for (const name of fixtures) {
    const file = path.join(fixtureDir, `${name}.expected.json`);
    it(`every Speakable in ${name}.expected.json has a clean, non-empty en`, () => {
      const json = JSON.parse(readFileSync(file, "utf8"));
      const found = speakables(json);

      expect(found.length, `${name} has no Speakable objects at all`).toBeGreaterThanOrEqual(12);

      for (const [at, spoken] of found) {
        const en = spoken.en;
        expect(typeof en, `${name} ${at}.en is not a string`).toBe("string");
        expect(String(en).trim().length, `${name} ${at}.en is empty`).toBeGreaterThan(0);

        const result = checkText(String(en));
        expect(
          result.ok,
          `${name} ${at}.en hits the banned-term filter with ${JSON.stringify(result.matches)}: ${String(en)}`,
        ).toBe(true);

        // English, not a copy of one of the Chinese lines.
        expect(en, `${name} ${at}.en repeats the yue line`).not.toBe(spoken.yue);
        expect(en, `${name} ${at}.en repeats the cmn line`).not.toBe(spoken.cmn);
        expect(String(en), `${name} ${at}.en has no English words in it`).toMatch(/[A-Za-z]{3,}/);
      }
    });
  }

  it("rejects unknown keys and missing required fields", () => {
    const bad = {
      sheetType: "hk_en",
      warningSigns: [],
      medicines: [{ name: "X" }],
      followUp: [],
      dietLine: null,
      activityLine: null,
      hospitalContact: null,
      unreadable: [],
      extra: true,
    };
    expect(SheetReadingSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a diagnosis-shaped field (there is nowhere to put one)", () => {
    const reading = {
      sheetType: "unknown",
      warningSigns: [],
      medicines: [],
      followUp: [],
      dietLine: null,
      activityLine: null,
      hospitalContact: null,
      unreadable: [],
      diagnoses: ["anything"],
    };
    expect(SheetReadingSchema.safeParse(reading).success).toBe(false);
  });
});

describe("JSON schema export for structured outputs", () => {
  it("is strict everywhere and lists every field as required", () => {
    const schema = sheetReadingJsonSchema() as {
      type: string;
      additionalProperties?: boolean;
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(schema.properties)));
    const text = JSON.stringify(schema);
    expect(text).not.toContain("diagnos");
  });

  it("declares all three spoken forms of Speakable as required, everywhere it is inlined", () => {
    // Zod inlines Speakable at each use site rather than emitting a $ref, so every copy is checked.
    type Node = {
      properties?: Record<string, Node>;
      required?: string[];
      additionalProperties?: boolean;
      items?: Node;
      anyOf?: Node[];
    };

    function speakableNodes(node: Node | undefined): Node[] {
      if (node === null || typeof node !== "object") return [];
      if (node.properties && "yue" in node.properties) return [node];
      return [
        ...Object.values(node.properties ?? {}).flatMap(speakableNodes),
        ...speakableNodes(node.items),
        ...(node.anyOf ?? []).flatMap(speakableNodes),
      ];
    }

    const found = speakableNodes(sheetReadingJsonSchema() as Node);
    expect(found.length, "no Speakable object in the exported JSON schema").toBeGreaterThan(0);
    for (const node of found) {
      expect(node.required?.slice().sort()).toEqual(["cmn", "en", "yue"]);
      expect(Object.keys(node.properties ?? {}).sort()).toEqual(["cmn", "en", "yue"]);
      expect(node.additionalProperties).toBe(false);
    }
  });

  it("the checked-in contract matches the exported schema on Speakable", () => {
    const contract = JSON.parse(
      readFileSync(
        path.resolve(__dirname, "../../specs/001-discharge-sheet-agent/contracts/sheet-reading.schema.json"),
        "utf8",
      ),
    ) as { $defs: { Speakable: { required: string[]; properties: Record<string, unknown> } } };

    expect(contract.$defs.Speakable.required.slice().sort()).toEqual(["cmn", "en", "yue"]);
    expect(Object.keys(contract.$defs.Speakable.properties).sort()).toEqual(["cmn", "en", "yue"]);
  });

  it("AskResult requires grounded, citedCardId and answer", () => {
    const schema = askResultJsonSchema() as { required?: string[] };
    expect(schema.required?.sort()).toEqual(["answer", "citedCardId", "grounded"]);
    expect(AskResultSchema.safeParse({ grounded: false, citedCardId: null, answer: null }).success).toBe(true);
  });
});
