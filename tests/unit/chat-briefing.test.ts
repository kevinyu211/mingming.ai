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
  CHECK_KEYS,
  CLAUSE_MARKS,
  checkinTarget,
  chunks,
  countableTargets,
  beatSpeech,
  buildBeats,
  fill,
  hasCountableDose,
  pauseAfter,
  pieceSpeech,
  splitCards,
  trackLinkIndex,
  withFocusFirst,
  type Beat,
} from "@/components/chat/briefing";
import type { Card, Medicine, StoredReading, WarningSign } from "@/lib/domain/schemas";
import { UI, type UiKey } from "@/lib/i18n/ui";
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
});

/* ------------------------------------------------------------------ check-in */

/* -------------------------------------------------------------------- script */

/**
 * The whole briefing, as an array, before a word of it has been said.
 *
 * This is where constitution II now lives. The old build put the red flags in a block that was
 * rendered outside the thread, so their position was a fact about JSX; here it is a fact about an
 * array, which is the only thing the driver can walk. Everything below is about that array.
 *
 * `t` is the REAL Cantonese dictionary, not a stub returning the key.
 *
 * It used to return the key, which read nicely in a failure message but made every assertion about
 * what a bubble actually SAYS impossible: `fill()` interpolates `{n}` and `{total}` into the
 * template, and a template that is just its own key has nothing to interpolate. Using the shipped
 * strings means these tests check the sentence the reader gets, counts and all.
 *
 * `display` is the no-conversion case — the script conversion has its own tests.
 */
const CTX = {
  dialect: "yue" as const,
  t: (key: UiKey) => UI.hant[key],
  display: (text: string) => text,
  sheetWord: "出院紙",
};

describe("the script 明明 plays", () => {
  const cards = buildCards(
    reading({
      warningSigns: [warning("胸口痛"), warning("氣促")],
      medicines: [medicine(), medicine({ name: "Aspirin" })],
    }),
  );
  const beats = buildBeats(cards, CTX);
  const at = (key: string) => beats.findIndex((beat) => beat.key === key);

  /**
   * The opening says what is ON the page before it says anything from it, and then hands over.
   *
   * A reader handed a medical document has no idea how long this will take or what is in it, and
   * someone who came worried about one specific thing should be able to say so rather than sit
   * through everything else to reach it. It addresses nobody: the profile holds a relationship
   * word, never a name.
   */
  it("opens with a summary of what is on the page, and offers a choice", () => {
    expect(beats[0].key).toBe("summary");
    expect(beats[0].origin).toBe("rule");
    expect(beats[0].awaits).toBe(true);
    expect(beats[0].text).toContain("2");
    expect(beats[0].text).not.toContain("陳太");
  });

  it("puts the red flags ahead of every other card (constitution II)", () => {
    expect(at("warn")).toBeGreaterThan(-1);
    expect(at("piece-0")).toBeGreaterThan(at("warn"));
    // The lead-in that promises them is inside the same bubble, above the signs themselves.
    const block = beats[at("warn")].text;
    expect(block.indexOf(CTX.t("brief.warnLead"))).toBe(0);
  });

  /**
   * The red flags are ONE amber bubble, not one per sign, and that grouping is not tidiness.
   * These are the lines that say "stop and go back to hospital"; splitting them across four turns
   * would make the most urgent thing on the page the slowest to get through, and a reader who
   * answers twice and puts the phone down would have seen half of them.
   */
  it("paints exactly one amber bubble, holding every red flag", () => {
    const amber = beats.filter((beat) => beat.tone === "warn");
    expect(amber.map((beat) => beat.key)).toEqual(["warn"]);
    expect(amber[0].text).toContain("胸口痛");
    expect(amber[0].text).toContain("氣促");
    expect(amber[0].sources).toHaveLength(2);
  });

  /**
   * A bubble is a SECTION now, so a message can quote several lines — the warning block is one
   * bubble standing on four of them. What must hold is that no printed line is dropped on the way
   * into the script (constitution IV), so the count is over sources, not over bubbles.
   */
  it("carries every card's printed line with it (constitution IV)", () => {
    const quoting = cards.filter((card) => card.source !== null).length;
    const carried = beats.reduce((total, beat) => total + beat.sources.length, 0);
    expect(carried).toBe(quoting);
  });

  /**
   * The question lives INSIDE the bubble it is about, not in a box of its own. That is what stops
   * the screen filling with small alternating boxes — content, question, content, question — which
   * is what it looked like on a real phone and what got it called "shooting out a lot of text".
   */
  it("asks inside the red-flag bubble, and only when there is more to come", () => {
    expect(beats[at("warn")].text).toContain(CTX.t("ask.warn"));
    expect(beats[at("warn")].awaits).toBe(true);

    // A sheet with red flags and nothing else has nowhere to go after the question, so it does
    // not hold the floor: 「明唔明？」 immediately before 「講完喇」 asks for nothing.
    const onlyWarnings = buildBeats(buildCards(reading({ warningSigns: [warning("胸口痛")] })), CTX);
    expect(onlyWarnings.find((beat) => beat.key === "warn")?.awaits).toBe(false);
  });

  /**
   * A medicine gets a turn of its own, numbered. It is a discrete thing to remember — a name, a
   * strength, a printed instruction — and five in one bubble is the wall of text this shape exists
   * to remove. Everything else is one idea, so it stays whole under a single connective.
   */
  it("numbers each medicine and gives it its own turn", () => {
    const meds = beats.filter((beat) => beat.section.startsWith("medicine-"));
    expect(meds).toHaveLength(2);
    expect(meds[0].lead).toContain("1");
    expect(meds[1].lead).toContain("2");
    // Medicines are asked about in pairs: the first of two does not stop, and the second is the
    // last piece here, so the closing line does the asking.
    expect(meds[0].awaits).toBe(false);
    expect(meds[1].awaits).toBe(false);
  });

  it("says the page printed no red flags rather than dressing that up as one", () => {
    const quiet = buildBeats(buildCards(reading({ medicines: [medicine()] })), CTX);
    // The slot is still filled (`noWarnings` takes it) but it is not amber, and the「go now」
    // lead-in is not said over a page that never printed one.
    expect(quiet.some((beat) => beat.tone === "warn")).toBe(false);
    const block = quiet.find((beat) => beat.key === "warn");
    expect(block).toBeDefined();
    // The 「go now」 lead-in is not said over a page that never printed a red flag.
    expect(block?.text.startsWith(CTX.t("brief.warnLead"))).toBe(false);
  });

  it("ends by handing the conversation over, with no button anywhere in it", () => {
    expect(beats[beats.length - 1].key).toBe("end");
    expect(beats[beats.length - 1].origin).toBe("rule");
  });
});

describe("what a beat says out loud, and how long it is given", () => {
  const beat = (overrides: Partial<Beat>): Beat => ({
    key: "b",
    lead: null,
    text: "張紙寫住每日兩次。",
    origin: "model",
    tone: null,
    sources: [],
    link: null,
    stopped: false,
    unverified: false,
    awaits: false,
    section: "piece-medicine",
    ...overrides,
  });

  it("speaks the connective and the body as one sentence", () => {
    expect(beatSpeech(beat({ lead: "跟住講藥。" }))).toBe("跟住講藥。張紙寫住每日兩次。");
  });

  it("puts a space after an English connective and none after a Chinese one", () => {
    // A space after 「跟住講藥。」 is a gap a voice reads as a pause in the wrong place, and it
    // shows on screen as a hole between two characters.
    expect(beatSpeech(beat({ lead: "跟住講藥。" }))).not.toContain(" ");
    expect(beatSpeech(beat({ lead: "Now the medicines.", text: "Take one twice a day." }))).toBe(
      "Now the medicines. Take one twice a day.",
    );
  });

  it("gives a red flag longer to land than anything else", () => {
    expect(pauseAfter(beat({ tone: "warn" }))).toBeGreaterThan(pauseAfter(beat({})));
  });
});

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

/**
 * Where the script hands the floor over.
 *
 * The briefing used to play every beat to the end whatever the reader did, so the only way to be
 * heard was to interrupt — and the reader this is built for does not interrupt. They listen, and
 * then have nowhere to put the question. Now every section ends with a question that WAITS.
 */
describe("the script stops and asks at the end of every section", () => {
  const beats = buildBeats(
    buildCards(
      reading({
        warningSigns: [warning("胸口痛"), warning("氣促")],
        medicines: [medicine(), medicine({ name: "Aspirin" }), medicine({ name: "Statin" })],
      }),
    ),
    CTX,
  );
  const asks = beats.filter((b) => b.awaits);

  /**
   * The FIRST wait is the summary, which offers a choice of where to start; the second is the red
   * flags. What must hold either way is that nothing from the body of the page is spoken before
   * the reader has answered at least once.
   */
  it("hands the floor over before any of the page's content is read out", () => {
    const firstAsk = beats.findIndex((b) => b.awaits);
    expect(firstAsk).toBe(0);
    expect(beats[0].section).toBe("opening");

    const secondAsk = beats.findIndex((b, i) => i > firstAsk && b.awaits);
    expect(beats[secondAsk].section).toBe("warn");
    expect(
      beats.slice(0, secondAsk).every((b) => !b.section.startsWith("medicine-")),
    ).toBe(true);
  });

  /**
   * Every bubble carries its own question — content and ask in ONE box — so the count of bubbles
   * that wait equals the count of bubbles that have somewhere to go afterwards. The closing line
   * is the only agent bubble that never waits.
   */
  it("puts the question inside the bubble rather than in a box of its own", () => {
    const asking = beats.filter((b) => b.awaits);
    expect(asking.length).toBeGreaterThan(1);
    // No beat exists whose entire job is to ask: every waiting beat also says something.
    const shortestCheck = Math.min(...CHECK_KEYS.map((key) => UI.hant[key].length));
    for (const beat of asking) {
      expect(beat.text.length).toBeGreaterThan(shortestCheck);
    }
    expect(beats[beats.length - 1].awaits).toBe(false);
  });

  it("puts the question last in its own section, so a resume lands on the next one", () => {
    for (const ask of asks) {
      const i = beats.indexOf(ask);
      const after = beats[i + 1];
      if (after) expect(after.section).not.toBe(ask.section);
    }
  });

  it("never ends the conversation on a question with nowhere to go", () => {
    expect(beats[beats.length - 1].awaits).toBe(false);
    expect(beats[beats.length - 1].key).toBe("end");
  });

  /**
   * The section label is what "say that again" walks back over. If a run's beats disagreed about
   * which section they belong to, a repeat would replay part of a section and call it whole.
   */
  it("gives every beat in a run the same section label", () => {
    const runs = new Map<string, string[]>();
    for (const beat of beats) {
      if (!runs.has(beat.section)) runs.set(beat.section, []);
      runs.get(beat.section)?.push(beat.key);
    }
    for (const [section, keys] of runs) {
      expect(keys.length, `section ${section} is empty`).toBeGreaterThan(0);
    }
    // Sections are contiguous: a label never reappears after a different one has started.
    const order = beats.map((b) => b.section);
    const seen = new Set<string>();
    let previous = "";
    for (const section of order) {
      if (section !== previous) {
        expect(seen.has(section), `section ${section} is split in two`).toBe(false);
        seen.add(section);
        previous = section;
      }
    }
  });
});

describe("the check-in rotation and the pairs of medicines", () => {
  const five = buildBeats(
    buildCards(
      reading({
        warningSigns: [warning("胸口痛")],
        medicines: [
          medicine(),
          medicine({ name: "Aspirin" }),
          medicine({ name: "Statin" }),
          medicine({ name: "Frusemide" }),
          medicine({ name: "Bisoprolol" }),
        ],
        dietLine: { raw: "低鹽", spoken: SPOKEN, source: SOURCE, recognisedType: "low_salt" },
      }),
    ),
    CTX,
  );
  const meds = five.filter((b) => b.section.startsWith("medicine-"));

  it("stops after every second medicine and after the last one", () => {
    expect(meds.map((b) => b.awaits)).toEqual([false, true, false, true, true]);
  });

  it("groups a pair under one section, so a repeat replays the pair", () => {
    expect(meds.map((b) => b.section)).toEqual([
      "medicine-1",
      "medicine-1",
      "medicine-2",
      "medicine-2",
      "medicine-3",
    ]);
  });

  /**
   * The words of the check-in walk the rotation in order, so no two neighbouring asks use the
   * same ones. 「明唔明？」 eight times in a row is what made the briefing read as a form.
   */
  it("asks a different way each time, in the order of the rotation", () => {
    const asks = five
      .filter((b) => b.awaits && b.key !== "summary" && b.key !== "warn")
      .map((b) => b.text.split("\n\n").pop());
    expect(asks).toEqual([CTX.t(CHECK_KEYS[0]), CTX.t(CHECK_KEYS[1]), CTX.t(CHECK_KEYS[2])]);
    for (let i = 1; i < asks.length; i += 1) expect(asks[i]).not.toBe(asks[i - 1]);
  });

  it("keeps the warning bubble's own question", () => {
    expect(five.find((b) => b.key === "warn")?.text).toContain(CTX.t("ask.warn"));
  });
});

describe("where the reader asked to start", () => {
  const cards = buildCards(
    reading({
      warningSigns: [warning("胸口痛")],
      medicines: [medicine()],
      followUp: [{ clinic: "SOPD", when: "2/52", tests: null, spoken: SPOKEN, source: SOURCE }],
      dietLine: { raw: "低鹽", spoken: SPOKEN, source: SOURCE, recognisedType: "low_salt" },
    }),
  );

  it("moves the run they named to just after the warning signs, and nothing else", () => {
    const beats = buildBeats(cards, { ...CTX, focus: "followUp" });
    expect(beats[0].key).toBe("summary");
    expect(beats[1].key).toBe("warn");
    expect(beats[2].section).toBe("piece-followUp");
    expect(beats[3].section).toBe("medicine-1");
    expect(beats[4].section).toBe("piece-diet");
  });

  it("changes nothing for no focus, or for a type the sheet has no card of", () => {
    const plain = buildBeats(cards, CTX).map((b) => b.key);
    expect(buildBeats(cards, { ...CTX, focus: null }).map((b) => b.key)).toEqual(plain);
    expect(buildBeats(cards, { ...CTX, focus: "activity" }).map((b) => b.key)).toEqual(plain);
  });

  it("never moves a warning (constitution II)", () => {
    const { pieces } = splitCards(cards);
    expect(withFocusFirst(pieces, "warning")).toEqual(pieces);
    expect(withFocusFirst(pieces, "noWarnings")).toEqual(pieces);
  });
});
