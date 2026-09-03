/**
 * Constitution VI / FR-027: the product's own interface copy obeys the same banned-term list as
 * generated text. Fails loudly rather than quietly, because a banned word in a fixed string is a
 * compliance failure that no prompt change can fix.
 *
 * The single exemption is `disclaimer`, which is the rulebook's own required wording
 * (rules.md section 16) and therefore must contain 診斷/治療.
 */
import { describe, expect, it } from "vitest";
import { checkText } from "@/lib/rules/banned-terms";
import { dataStatement, dataStatementLines, DATA_STATEMENT_PROVIDERS } from "@/lib/i18n/data-statement";
import { scriptForDialect, toScript } from "@/lib/i18n/script";
import { DISCLAIMER_KEY, UI, UI_KEYS, UI_LOCALES, t, type UiKey } from "@/lib/i18n/ui";

describe("the dictionary is complete", () => {
  it("has the same keys in every locale, with no blanks", () => {
    const reference = [...UI_KEYS].sort();
    expect(reference.length).toBeGreaterThan(80);
    for (const locale of UI_LOCALES) {
      expect(Object.keys(UI[locale]).sort()).toEqual(reference);
      for (const key of UI_KEYS) {
        expect(UI[locale][key], `${locale}.${key} is blank`).toMatch(/\S/);
      }
    }
  });

  it("t() reads the same value as the table", () => {
    for (const locale of UI_LOCALES) {
      for (const key of UI_KEYS) expect(t(locale, key)).toBe(UI[locale][key]);
    }
  });
});

describe("every UI string passes the banned-term filter", () => {
  const checked: UiKey[] = UI_KEYS.filter((key) => key !== DISCLAIMER_KEY);

  for (const locale of UI_LOCALES) {
    it(`${locale}: no banned term in any key except the disclaimer`, () => {
      const failures = checked
        .map((key) => ({ key, result: checkText(UI[locale][key]) }))
        .filter(({ result }) => !result.ok)
        .map(({ key, result }) => `${locale}.${key} → ${result.matches.join(", ")}`);
      expect(failures).toEqual([]);
    });
  }

  it("checks every key, so nothing can be added without being checked", () => {
    expect(checked.length).toBe(UI_KEYS.length - 1);
  });
});

describe("the disclaimer is the one exemption", () => {
  it("carries the rulebook's mandated wording, banned words and all", () => {
    // rules.md section 16 requires 诊断 / 治疗 (and "diagnosis or treatment") verbatim.
    expect(UI.hant.disclaimer).toContain("診斷");
    expect(UI.hant.disclaimer).toContain("治療");
    expect(UI.hans.disclaimer).toContain("诊断");
    expect(UI.hans.disclaimer).toContain("治疗");
    expect(UI.en.disclaimer).toContain("diagnosis or treatment");
  });

  it("would fail the filter, which is exactly why the exemption is written down", () => {
    for (const locale of UI_LOCALES) {
      const result = checkText(UI[locale].disclaimer);
      expect(result.ok, `${locale} disclaimer unexpectedly passed the filter`).toBe(false);
    }
  });

  it("exempts nothing else: no other key is allowed to contain those words", () => {
    for (const locale of UI_LOCALES) {
      for (const key of UI_KEYS) {
        if (key === DISCLAIMER_KEY) continue;
        expect(UI[locale][key], `${locale}.${key}`).not.toMatch(/診斷|诊断|治療|治疗/);
      }
    }
  });

  it("ends with the AI-inaccuracy caution the rules require", () => {
    expect(UI.hant.disclaimer).toContain("AI");
    expect(UI.hans.disclaimer).toContain("AI");
    expect(UI.en.disclaimer).toContain("AI-generated content may be inaccurate.");
  });
});

describe("the data statement", () => {
  it("passes the banned-term filter in every locale", () => {
    for (const locale of UI_LOCALES) {
      for (const [index, line] of dataStatementLines(locale).entries()) {
        const result = checkText(line);
        expect(result.matches, `${locale} data statement line ${index}`).toEqual([]);
      }
    }
  });

  it("names every provider and says the data crosses a border (research.md R13)", () => {
    for (const locale of UI_LOCALES) {
      const statement = dataStatement(locale);
      expect(statement).toContain(DATA_STATEMENT_PROVIDERS.model);
      expect(statement).toContain(DATA_STATEMENT_PROVIDERS.voice);
      expect(statement).toContain(DATA_STATEMENT_PROVIDERS.transcription);
      expect(statement).not.toContain("{model}");
      expect(statement).not.toContain("{voice}");
      expect(statement).not.toContain("{transcription}");
    }
    expect(dataStatement("en")).toContain("outside Hong Kong");
    expect(dataStatement("hant")).toContain("香港以外");
    expect(dataStatement("hans")).toContain("香港以外");
  });

  it("interpolates whichever providers it is given", () => {
    const statement = dataStatement("en", {
      model: "Model X",
      voice: "Voice Y",
      transcription: "Ears Z",
    });
    expect(statement).toContain("model Model X; voice Voice Y; transcription Ears Z.");
  });
});

describe("script conversion", () => {
  const pairs: Array<[string, string]> = [
    ["藥", "药"],
    ["醫生", "医生"],
    ["警號", "警号"],
    ["出院紙", "出院纸"],
    ["藥劑師", "药剂师"],
    ["刪除所有資料", "删除所有资料"],
    ["阿媽聽咩話？", "阿妈听咩话？"],
  ];

  it("converts in both directions and round trips", () => {
    for (const [hant, hans] of pairs) {
      expect(toScript(hant, "hans")).toBe(hans);
      expect(toScript(hans, "hant")).toBe(hant);
      expect(toScript(toScript(hant, "hans"), "hant")).toBe(hant);
    }
  });

  it("leaves text that is already in the target script alone", () => {
    for (const [hant, hans] of pairs) {
      expect(toScript(hant, "hant")).toBe(hant);
      expect(toScript(hans, "hans")).toBe(hans);
    }
  });

  it("leaves Latin text, numbers and dosing untouched (English stays English)", () => {
    for (const text of ["Amlodipine 5 mg", "1 tab daily", "SOPD 2/52", ""]) {
      expect(toScript(text, "hans")).toBe(text);
      expect(toScript(text, "hant")).toBe(text);
    }
  });

  it("maps the dialect to its written form", () => {
    expect(scriptForDialect("yue")).toBe("hant");
    expect(scriptForDialect("cmn")).toBe("hans");
  });

  it("converts the hant dictionary into readable hans without losing the AI caution", () => {
    expect(toScript(UI.hant.aiChip, "hans")).toContain("AI");
    expect(toScript(UI.hant["cards.playAll"], "hans")).toBe("全部读出");
  });
});
