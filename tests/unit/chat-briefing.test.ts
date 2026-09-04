/**
 * The rules behind the 傾偈 conversation (v2 build brief §6).
 *
 * Everything asserted here is pure — no React, no clock, no storage — because the parts of this
 * screen that can hurt someone are the parts that decide *order* and *numbers*, and both of those
 * are plain functions. The rest of the screen is timers and markup, and it is checked in the
 * browser instead.
 *
 * Four of these tests exist because the design canvas gets them wrong, and the prototype is
 * seductive: it is a working thing you can click. `docs/v2-build-brief.md` §2 rules 7 and 8 say
 * why the app must not follow it here.
 */
import { describe, expect, it } from "vitest";
import {
  CLAUSE_MARKS,
  checkinTarget,
  chunks,
  countableTargets,
  fill,
  hasCountableDose,
  phaseAfterPiece,
  pieceSpeech,
  splitCards,
  trackLinkIndex,
  warningSpeech,
} from "@/components/chat/briefing";
import type { Card, Medicine, StoredReading, WarningSign } from "@/lib/domain/schemas";
import { buildCards } from "@/lib/rules/card-order";
import { CAUTION_SUFFIX } from "@/lib/rules/template-fallback";

const SOURCE = { section: "Medications", lineIndex: 0, quote: "Metoprolol 25mg BD" };
const SPOKEN = { yue: "心臟藥", cmn: "心脏药", en: "Heart medicine" };

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

function warning(symptom: string): WarningSign {
  return {
    symptom: { yue: symptom, cmn: symptom, en: symptom },
    action: { yue: "即刻返醫院", cmn: "马上回医院", en: "go back to hospital" },
    source: { section: "Warning signs", lineIndex: 3, quote: symptom },
  };
}

function reading(overrides: Partial<StoredReading> = {}): StoredReading {
  return {
    sheetType: "hk_en",
    warningSigns: [],
    medicines: [],
    followUp: [],
    dietLine: null,
    activityLine: null,
    hospitalContact: null,
    unreadable: [],
    readAt: "2026-09-01T02:00:00.000Z",
    ...overrides,
  };
}

/* -------------------------------------------------------------------- typing */

describe("chunks: how a sentence is revealed", () => {
  it("breaks after every clause mark the canvas uses", () => {
    expect(chunks("我睇完你張紙。最緊要嘅先講。")).toEqual(["我睇完你張紙。", "最緊要嘅先講。"]);
    // 「好，」 is two characters, so it rides along with the clause after it (see MIN_CLAUSE).
    expect(chunks("好，我幫你記低咗。今日仲有 1 次。")).toEqual([
      "好，我幫你記低咗。",
      "今日仲有 1 次。",
    ]);
  });

  it("never drops, reorders or rewrites a character", () => {
    // The text on screen has to be the text that passed the banned-term filter, character for
    // character — so this property is the whole safety argument for the typewriter.
    const samples = [
      "我睇完你張紙。最緊要嘅先講。",
      "張紙寫：每日兩次，隨餐。",
      "Take 1 tablet twice daily, with food.",
      "冇標點嘅一句嘢",
      "",
    ];
    for (const sample of samples) {
      expect(chunks(sample).join("")).toBe(sample);
    }
  });

  it("glues a clause shorter than three characters onto the next one", () => {
    // Otherwise 「好，」 flashes as a two-character bubble, which reads as a glitch, not as speech.
    expect(chunks("好。得。明白晒喇。")).toEqual(["好。得。", "明白晒喇。"]);
  });

  it("keeps a tail with no punctuation at all", () => {
    expect(chunks("多謝晒")).toEqual(["多謝晒"]);
    expect(chunks("第一句。第二句無句號")).toEqual(["第一句。", "第二句無句號"]);
  });

  it("splits on each of the marks the canvas lists and on nothing else", () => {
    for (const mark of CLAUSE_MARKS) {
      expect(chunks(`一二三${mark}四五六`)).toEqual([`一二三${mark}`, "四五六"]);
    }
    // A full stop in a Latin sentence is not one of them: "25mg." must not become its own clause.
    expect(chunks("Metoprolol 25mg bd")).toEqual(["Metoprolol 25mg bd"]);
  });
});

describe("fill: a fixed template with the page's own words in the slot", () => {
  it("replaces every slot, including one used twice", () => {
    expect(fill("今日食咗{name}未？張紙寫{printed}。", { name: "藥", printed: "每日兩次" })).toBe(
      "今日食咗藥未？張紙寫每日兩次。",
    );
    expect(fill("{n} / {n}", { n: 2 })).toBe("2 / 2");
  });

  it("leaves a slot it was given no value for alone rather than emptying it", () => {
    expect(fill("今日仲有 {n} 次", {})).toBe("今日仲有 {n} 次");
  });

  it("puts a printed clause in verbatim, punctuation and all", () => {
    // The clause is quoted off the paper. Nothing here may tidy it.
    expect(fill("張紙寫：{printed}", { printed: "每日兩次，隨餐" })).toBe("張紙寫：每日兩次，隨餐");
  });
});

/* ------------------------------------------------------------------- ordering */

describe("the briefing order is the card order, and red flags are never a piece", () => {
  const cards = buildCards(
    reading({
      warningSigns: [warning("發燒到 38 度以上"), warning("氣促")],
      medicines: [medicine(), medicine({ name: "Amlodipine", frequency: "每四小時一次" })],
      followUp: [
        {
          clinic: "心內科",
          when: "9月24日 10:15",
          tests: null,
          spoken: SPOKEN,
          source: { section: "Follow up", lineIndex: 9, quote: "Cardiology 24 Sep" },
        },
      ],
    }),
  );

  it("puts both warnings in the amber slot and nothing else", () => {
    const { warnings, pieces, empty } = splitCards(cards);
    expect(warnings.map((c) => c.type)).toEqual(["warning", "warning"]);
    expect(empty).toBe(false);
    expect(pieces.map((c) => c.type)).toEqual(["medicine", "medicine", "followUp"]);
  });

  it("keeps the pieces in CARD_ORDER, so no model turn can promote one", () => {
    const { pieces } = splitCards(cards);
    const order = ["medicine", "followUp", "diet", "activity", "unreadable"];
    const positions = pieces.map((c) => order.indexOf(c.type));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("hands the amber slot to the noWarnings card when the page printed none", () => {
    const { warnings, pieces, empty } = splitCards(buildCards(reading({ medicines: [medicine()] })));
    expect(warnings.map((c) => c.type)).toEqual(["noWarnings"]);
    expect(empty).toBe(true);
    expect(pieces.map((c) => c.type)).toEqual(["medicine"]);
  });

  it("puts the 睇「跟進」 link under the LAST medicine, once", () => {
    const { pieces } = splitCards(cards);
    expect(trackLinkIndex(pieces)).toBe(1);
    expect(pieces[1].type).toBe("medicine");
  });

  it("offers no track link at all when the page listed no medicines", () => {
    const { pieces } = splitCards(buildCards(reading({ warningSigns: [warning("胸口痛")] })));
    expect(trackLinkIndex(pieces)).toBe(-1);
  });

  it("asks 明唔明？ after every piece and ends only after the last", () => {
    expect(phaseAfterPiece(1, 3)).toBe("ask");
    expect(phaseAfterPiece(2, 3)).toBe("ask");
    expect(phaseAfterPiece(3, 3)).toBe("end");
    expect(phaseAfterPiece(0, 0)).toBe("end");
  });
});

describe("what one piece says out loud", () => {
  it("speaks a card's own filtered body, unchanged", () => {
    const card = buildCards(reading({ medicines: [medicine()] })).find(
      (c) => c.type === "medicine",
    ) as Card;
    expect(pieceSpeech(card, "yue")).toBe(card.body.yue);
  });

  it("attaches the caution sentence to a card that disagrees with its own quoted line", () => {
    const card = buildCards(reading({ medicines: [medicine()] })).find(
      (c) => c.type === "medicine",
    ) as Card;
    const doubtful: Card = { ...card, unverified: true };
    expect(pieceSpeech(doubtful, "yue")).toBe(`${card.body.yue} ${CAUTION_SUFFIX.yue}`);
    expect(pieceSpeech(doubtful, "en")).toBe(`${card.body.en} ${CAUTION_SUFFIX.en}`);
  });

  it("reads every warning as one utterance, in the order the rules put them", () => {
    const { warnings } = splitCards(
      buildCards(reading({ warningSigns: [warning("發燒"), warning("氣促")] })),
    );
    const spoken = warningSpeech(warnings, "yue");
    expect(spoken.indexOf("發燒")).toBeGreaterThanOrEqual(0);
    expect(spoken.indexOf("發燒")).toBeLessThan(spoken.indexOf("氣促"));
    // English joins with a space; Chinese does not, because the bodies carry their own 。
    expect(warningSpeech(warnings, "en")).toContain(" ");
  });
});

/* ------------------------------------------------------------------ check-in */

describe("the check-in only counts what the page actually printed", () => {
  it("counts a recognised frequency", () => {
    const target = checkinTarget(reading({ medicines: [medicine()] }));
    expect(target?.total).toBe(2);
    expect(target?.printed).toBe("每日兩次，隨餐");
    // The name in the question is the printed name and strength, verbatim.
    expect(target?.name).toBe("Metoprolol 25mg");
  });

  /**
   * 「每朝一次」 IS counted, and 「每四小時一次」 is not — the line between them is whether the clause
   * states a number of times a day, not whether it mentions the clock.
   *
   * Once every morning is once a day, so it counts, and nothing about the morning ever reaches the
   * screen: the counter is an integer and the card prints the clause verbatim beside it. Every
   * four hours is an interval, and turning it into "six" would be the app scheduling a drug the
   * page timed. Refusing 每朝一次 as well was over-caution that cost the counter on most sheets.
   */
  it("counts 每朝一次 but not 每四小時一次", () => {
    const morning = reading({ medicines: [medicine({ frequency: "每朝一次" })] });
    expect(countableTargets(morning)).toHaveLength(1);
    expect(countableTargets(morning)[0].total).toBe(1);
    expect(hasCountableDose(morning)).toBe(true);

    const interval = reading({ medicines: [medicine({ frequency: "每四小時一次" })] });
    expect(countableTargets(interval)).toEqual([]);
    expect(hasCountableDose(interval)).toBe(false);
    expect(checkinTarget(interval)).toBeNull();
  });

  it("never counts a medicine the page has stopped", () => {
    const sheet = reading({
      medicines: [medicine({ status: "stopped" }), medicine({ status: "changed" })],
    });
    expect(countableTargets(sheet)).toEqual([]);
    expect(hasCountableDose(sheet)).toBe(false);
  });

  it("never counts an as-needed medicine", () => {
    const sheet = reading({
      medicines: [medicine({ frequency: "痛嘅時候食，一日最多四次" })],
    });
    expect(countableTargets(sheet)).toEqual([]);
  });

  it("asks about the first countable medicine, skipping the ones it cannot count", () => {
    const sheet = reading({
      medicines: [
        medicine({ name: "Paracetamol", frequency: "痛先食" }),
        medicine({ name: "Aspirin", frequency: "每四小時一次" }),
        medicine({ name: "Metoprolol", frequency: "每日兩次，隨餐" }),
      ],
    });
    expect(checkinTarget(sheet)?.name).toBe("Metoprolol 25mg");
    expect(hasCountableDose(sheet)).toBe(true);
  });

  it("has nothing to check in about on a sheet with no medicines", () => {
    expect(hasCountableDose(reading())).toBe(false);
  });
});
