import { describe, expect, it } from "vitest";

import { scanEarlyAnswer } from "@/lib/model/early";

const FULL = {
  kind: "sheet",
  citedCardIds: ["warning-0", "medicine-1"],
  answer: {
    yue: "張紙寫住：胸口痛就即刻返急症室。",
    cmn: "纸上写着：胸口痛就马上回急诊室。",
    en: 'The sheet says: chest pain, go straight to A&E ("now").',
  },
};

const TEXT = JSON.stringify(FULL);

/** Every prefix of the full reply, so a scan is asserted against each possible cut point. */
function prefixes(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i <= text.length; i += 1) out.push(text.slice(0, i));
  return out;
}

describe("scanEarlyAnswer", () => {
  it("reports nothing on an empty or unopened text", () => {
    expect(scanEarlyAnswer("", "yue")).toEqual({ kind: null, citedCardIds: null, text: null });
    expect(scanEarlyAnswer("{", "yue")).toEqual({ kind: null, citedCardIds: null, text: null });
  });

  it("reports each field only once its closing mark has arrived, and never a truncated one", () => {
    let kindAt = -1;
    let idsAt = -1;
    let textAt = -1;
    prefixes(TEXT).forEach((prefix, n) => {
      const early = scanEarlyAnswer(prefix, "yue");
      if (early.kind !== null) {
        expect(early.kind).toBe("sheet");
        if (kindAt < 0) kindAt = n;
      }
      if (early.citedCardIds !== null) {
        expect(early.citedCardIds).toEqual(FULL.citedCardIds);
        if (idsAt < 0) idsAt = n;
      }
      if (early.text !== null) {
        expect(early.text).toBe(FULL.answer.yue);
        if (textAt < 0) textAt = n;
      }
    });
    expect(kindAt).toBeGreaterThan(0);
    expect(idsAt).toBeGreaterThan(kindAt);
    expect(textAt).toBeGreaterThan(idsAt);
    // The Cantonese sentence is known well before the English one has been written.
    expect(textAt).toBeLessThan(TEXT.indexOf('"en"'));
  });

  it("reads the requested language, including one with escaped quotes", () => {
    expect(scanEarlyAnswer(TEXT, "cmn").text).toBe(FULL.answer.cmn);
    expect(scanEarlyAnswer(TEXT, "en").text).toBe(FULL.answer.en);
  });

  it("does not mistake a value that mentions a key for the key itself", () => {
    const tricky = JSON.stringify({
      kind: "general",
      citedCardIds: [],
      answer: { yue: '"answer": {"yue": "not this"}', cmn: "x", en: "y" },
    });
    const early = scanEarlyAnswer(tricky, "yue");
    expect(early.kind).toBe("general");
    expect(early.citedCardIds).toEqual([]);
    expect(early.text).toBe('"answer": {"yue": "not this"}');
  });

  it("reports no text when the answer is null", () => {
    const none = JSON.stringify({ kind: "none", citedCardIds: [], answer: null });
    expect(scanEarlyAnswer(none, "yue")).toEqual({ kind: "none", citedCardIds: [], text: null });
  });

  it("keeps only string ids", () => {
    const odd = '{"kind":"sheet","citedCardIds":["a",1,null,"b"],"answer":{"yue":"好"';
    expect(scanEarlyAnswer(odd, "yue")).toEqual({ kind: "sheet", citedCardIds: ["a", "b"], text: "好" });
  });

  it("tolerates whitespace and a pretty-printed reply", () => {
    const pretty = JSON.stringify(FULL, null, 2);
    expect(scanEarlyAnswer(pretty, "yue")).toEqual({
      kind: "sheet",
      citedCardIds: FULL.citedCardIds,
      text: FULL.answer.yue,
    });
  });
});
