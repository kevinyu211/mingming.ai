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

describe("the v2 three-tab flow has every string it needs", () => {
  /**
   * The keys docs/v2-build-brief.md section 8 requires, listed by hand rather than derived, so
   * that deleting one is a failing test and not a blank screen at the demo. Four agents are
   * building screens against this dictionary in parallel; these names are the contract.
   */
  const V2_KEYS: UiKey[] = [
    "tab.record", "tab.chat", "tab.track", "tab.navLabel", "tab.chatPending",
    "mascot.name",
    "home.title", "home.emptySubtitle", "home.emptyMascot", "home.nowTalking", "home.pages",
    "home.medicines", "home.chatNotStarted", "home.chatPartway", "home.chatDone",
    "home.dosesLeft", "home.dosesDone", "home.older", "home.readOnly",
    "capture.photo", "capture.photoSub", "capture.upload", "capture.uploadSub",
    "camera.hintFirst", "camera.hintFirstSub", "camera.hintNext", "camera.hintNextSub",
    "camera.hintFull", "camera.hintFullSub", "camera.done", "camera.guiding",
    "camera.edgesLocked", "camera.close", "camera.shutter",
    "pick.title", "pick.subtitle", "pick.subtitleFull", "pick.use", "pick.useNone",
    "review.title", "review.subtitle", "review.retake", "review.addPage", "review.onDevice",
    "review.start",
    "reading.title", "reading.meta",
    "chat.back", "chat.sheetLine", "chat.muteSpeaker", "chat.unmuteSpeaker", "chat.language",
    "chat.today", "chat.reading", "chat.readingThis",
    "brief.intro", "brief.warnTitle", "brief.understandQuestion", "brief.repeat",
    "brief.understand", "brief.left", "brief.end", "brief.trackLink",
    "bar.hold", "bar.holdSub", "bar.listening", "bar.listeningSub", "bar.typePlaceholder",
    "bar.send", "bar.backToVoice",
    "checkin.question", "checkin.took", "checkin.notYet", "checkin.tookReply",
    "checkin.tookReplyAll", "checkin.notYetReply",
    "track.title", "track.following", "track.nextVisit", "track.daysAfter", "track.todayMeds",
    "track.warnings", "track.saySigns", "appt.directions",
    "card.printed", "dose.left", "dose.done", "dose.asNeeded", "dose.stopped", "dose.take",
    "sheet.close",
  ];

  it("carries every v2 key in all three locales", () => {
    for (const locale of UI_LOCALES) {
      const missing = V2_KEYS.filter((key) => !UI[locale][key]?.trim());
      expect(missing, `${locale} is missing v2 keys`).toEqual([]);
    }
  });

  it("keeps the six-page ceiling visible everywhere it can bite", () => {
    // A medical document is never silently truncated: the picker, the camera hint and the
    // "you're full" line all have to name the limit out loud.
    for (const locale of UI_LOCALES) {
      for (const key of ["pick.subtitle", "pick.subtitleFull", "camera.hintFull"] as UiKey[]) {
        expect(UI[locale][key], `${locale}.${key} must state the 6-page ceiling`).toMatch(
          /6|six/i,
        );
      }
    }
  });
});

describe("placeholders survive translation", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{[a-zA-Z]+\}/g)].map((m) => m[0]).sort();

  it("every locale of a key carries the same slots", () => {
    // A {n} dropped in one script is a counter that silently stops counting, and a {printed}
    // dropped is the verbatim page quote vanishing from a spoken line (constitution IV).
    const failures: string[] = [];
    for (const key of UI_KEYS) {
      const reference = placeholders(UI.hant[key]);
      for (const locale of UI_LOCALES) {
        const found = placeholders(UI[locale][key]);
        if (found.join(",") !== reference.join(",")) {
          failures.push(`${key}: hant has [${reference}] but ${locale} has [${found}]`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("uses only slots the callers know how to fill", () => {
    const allowed = new Set(["{n}", "{name}", "{printed}", "{text}", "{date}", "{label}"]);
    for (const locale of UI_LOCALES) {
      for (const key of UI_KEYS) {
        for (const slot of placeholders(UI[locale][key])) {
          expect(allowed.has(slot), `${locale}.${key} uses unknown slot ${slot}`).toBe(true);
        }
      }
    }
  });
});

describe("a counter is a frequency, never a clock time", () => {
  /**
   * Constitution I and brief section 2 rule 7. A discharge sheet prints "每日兩次，隨餐" — a
   * frequency. Turning that into "8am / 8pm" invents an instruction the doctor never wrote, which
   * is prescribing. The design canvas fails this: its check-in reply says 「夜晚仲有一次」. The
   * dictionary says 「今日仲有 N 次」 instead, and these two tests are what keeps it that way.
   */
  const CLOCK = [
    /\d{1,2}\s*[:：]\s*\d{2}/, //            9:41, 10：15
    /\b\d{1,2}\s*(?:am|pm)\b/i, //           8pm
    /[0-9一二三四五六七八九兩两十]\s*[點点]\s*(?:半|鐘|钟|[0-9]|$|[，。、])/, // 八點半, 10 點
    /\b\d{1,2}\s*o'clock\b/i,
  ];

  it("no fixed string anywhere prints a time of day", () => {
    const failures: string[] = [];
    for (const locale of UI_LOCALES) {
      for (const key of UI_KEYS) {
        const value = UI[locale][key];
        if (CLOCK.some((pattern) => pattern.test(value))) {
          failures.push(`${locale}.${key} → ${value}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("no counter string names a part of the day", () => {
    // 「夜晚仲有一次」 has no digits and no colon, so the clock test above cannot see it. This
    // one can: a dose counter may say 今日 (today) and nothing narrower.
    const COUNTER_KEYS: UiKey[] = [
      "home.dosesLeft", "home.dosesDone",
      "checkin.question", "checkin.tookReply", "checkin.tookReplyAll", "checkin.notYetReply",
      "card.printed", "dose.left", "dose.done", "dose.asNeeded", "dose.stopped", "dose.take",
      "track.todayMeds",
    ];
    const PART_OF_DAY =
      /早上|上午|中午|下午|晚上|夜晚|朝早|朝頭早|晚頭黑|傍晚|凌晨|\bmorning\b|\bafternoon\b|\bevening\b|\btonight\b|\bnight\b|\bnoon\b/i;

    const failures: string[] = [];
    for (const locale of UI_LOCALES) {
      for (const key of COUNTER_KEYS) {
        if (PART_OF_DAY.test(UI[locale][key])) failures.push(`${locale}.${key} → ${UI[locale][key]}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("would catch the canvas's own mistake", () => {
    // Proof the guard has teeth: this is the exact line workflow-v2.dc.html ships.
    const PART_OF_DAY = /夜晚/;
    expect(PART_OF_DAY.test("好，我幫你記低咗。夜晚仲有一次。")).toBe(true);
    expect(PART_OF_DAY.test(UI.hant["checkin.tookReply"])).toBe(false);
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
