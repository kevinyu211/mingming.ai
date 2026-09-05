import { describe, expect, it } from "vitest";

import { followUpLine, hasRecap, recap } from "../../components/track/followup";
import { UI, type UiKey } from "../../lib/i18n/ui";
import type { ThreadMessage } from "../../lib/sheets/types";

const t = (key: UiKey) => UI.hant[key];
const en = (key: UiKey) => UI.en[key];

function user(text: string): ThreadMessage {
  return { id: text, role: "user", text, at: "2026-09-05T00:00:00.000Z", origin: "user" };
}
function agent(text: string): ThreadMessage {
  return { id: text, role: "agent", text, at: "2026-09-05T00:00:00.000Z", origin: "rule" };
}

describe("明明's line on 跟進 is the counters in a sentence", () => {
  it("says doses left, the visit, and what to do — each from a fact the cards already show", () => {
    expect(followUpLine({ left: 2, countable: 3, daysToVisit: 3 }, t)).toBe(
      "今日仲有 2 次。3 日之後覆診。食咗就撳一下。",
    );
    expect(followUpLine({ left: 2, countable: 3, daysToVisit: 3 }, en)).toBe(
      "2 left today. Next visit in 3 days. Tap when you've taken one.",
    );
  });

  it("drops every clause the page cannot support", () => {
    // No countable medicine: nothing to count, nothing to tap.
    expect(followUpLine({ left: 0, countable: 0, daysToVisit: 5 }, t)).toBe("5 日之後覆診。");
    // No parsed date: no visit clause, and no invented one.
    expect(followUpLine({ left: 1, countable: 1, daysToVisit: null }, t)).toBe("今日仲有 1 次。食咗就撳一下。");
    // Visit today or past: days are not a thing to say.
    expect(followUpLine({ left: 0, countable: 1, daysToVisit: 0 }, t)).toBe("今日食晒。");
    // Nothing at all: nothing, so the caller shows nothing.
    expect(followUpLine({ left: 0, countable: 0, daysToVisit: null }, t)).toBe("");
  });

  it("never prints a time of day", () => {
    for (const loc of ["hant", "hans", "en"] as const) {
      const tt = (key: UiKey) => UI[loc][key];
      const line = followUpLine({ left: 3, countable: 3, daysToVisit: 12 }, tt);
      expect(line).not.toMatch(/\d{1,2}:\d{2}|am\b|pm\b|朝早|夜晚|早上|晚上/i);
    }
  });
});

describe("the recap counts what the reader actually did", () => {
  const thread = [
    agent("你好呀，我係明明。想我由邊樣講起？"),
    user("明白"),
    agent("先講最緊要嗰樣。明唔明？"),
    user("再講一次"),
    agent("先講最緊要嗰樣。明唔明？"),
    user("好"),
    agent("第1隻藥：… 呢隻清唔清楚？"),
    user("白色嗰粒係朝早定夜晚食？"),
    agent("張紙冇講呢樣。"),
    user("食咗"),
  ];

  it("separates understood, repeat, and the reader's own questions, and leaves the check-in out", () => {
    const r = recap(thread, { phase: "waiting", step: 4 }, [t("checkin.took"), t("checkin.notYet")]);
    expect(r).toEqual({ sections: 4, done: false, understood: 2, repeated: 1, asked: 1 });
    expect(hasRecap(r)).toBe(true);
  });

  it("knows when the briefing ended, and when there is nothing to recap yet", () => {
    expect(recap(thread, { phase: "end", step: 9 }).done).toBe(true);
    const nothing = recap([agent("你好呀")], { phase: "waiting", step: 1 });
    expect(nothing).toEqual({ sections: 1, done: false, understood: 0, repeated: 0, asked: 0 });
    expect(hasRecap(nothing)).toBe(false);
  });
});
