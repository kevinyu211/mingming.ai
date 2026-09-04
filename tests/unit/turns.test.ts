/**
 * Reading the reader's reply.
 *
 * The bias under test is one-directional and it is the whole point of the file: when in doubt,
 * treat it as a QUESTION. Mistaking a question for a yes marches past a section the reader asked
 * about and silently drops information off a medical document. Mistaking a yes for a question
 * costs one wasted answer.
 */
import { describe, expect, it } from "vitest";
import { classifyReply } from "@/components/chat/turns";

describe("replies that mean carry on", () => {
  const yes = [
    "明白", "明", "明白喇", "知道", "係", "係呀", "好", "好呀", "得", "冇問題",
    "明白了", "知道了", "是的", "对", "嗯", "好的", "可以", "懂了",
    "yes", "Yeah", "yep", "OK", "okay", "Got it", "understood", "sure",
  ];
  for (const reply of yes) {
    it(`reads ${JSON.stringify(reply)} as continue`, () => {
      expect(classifyReply(reply)).toBe("continue");
    });
  }

  it("ignores trailing punctuation and case", () => {
    expect(classifyReply("Yes.")).toBe("continue");
    expect(classifyReply("明白。")).toBe("continue");
    expect(classifyReply("  OK！ ")).toBe("continue");
  });

  it("takes an explicit ask for the next section anywhere in the sentence", () => {
    expect(classifyReply("繼續講啦")).toBe("continue");
    expect(classifyReply("你講埋下一樣")).toBe("continue");
    expect(classifyReply("go on please")).toBe("continue");
    expect(classifyReply("next one")).toBe("continue");
  });

  it("takes a short reply that opens with an affirmative", () => {
    expect(classifyReply("明白喇，多謝")).toBe("continue");
    expect(classifyReply("yes ok")).toBe("continue");
  });
});

describe("replies that mean say it again", () => {
  const again = [
    "唔明", "唔明白", "再講一次", "再講", "講多次", "慢啲講", "聽唔到",
    "不明白", "再说一次", "没听清", "慢一点",
    "again", "Repeat", "say that again", "sorry?", "I didn't catch that",
  ];
  for (const reply of again) {
    it(`reads ${JSON.stringify(reply)} as repeat`, () => {
      expect(classifyReply(reply)).toBe("repeat");
    });
  }

  /**
   * The ordering bug this file exists to prevent. 「唔明」 contains 「明」, so any implementation
   * that tests the affirmatives first answers "I understand" to "I don't understand" and moves on
   * past the very thing the reader said they missed.
   */
  it("never reads 唔明 as 明", () => {
    expect(classifyReply("唔明")).toBe("repeat");
    expect(classifyReply("我唔明白呢樣")).toBe("repeat");
    expect(classifyReply("唔係好明")).toBe("repeat");
  });
});

describe("replies that are questions", () => {
  /**
   * The dangerous case, and the reason affirmatives are matched as WHOLE replies. This sentence
   * contains 「係」 — yes — and is a question about a pill. Substring matching answers "yes" to it
   * and skips the medicines.
   */
  it("does not mistake a question containing 係 for a yes", () => {
    expect(classifyReply("白色嗰粒係朝早定夜晚食？")).toBe("question");
    expect(classifyReply("呢隻藥係咪要隨餐食")).toBe("question");
  });

  const questions = [
    "止痛藥同心臟藥可以一齊食嗎？",
    "覆診要帶咩",
    "點解要食兩次",
    "可唔可以唔食",
    "what should I bring to the appointment",
    "when is the follow up",
    "我隻腳腫咗",
  ];
  for (const reply of questions) {
    it(`reads ${JSON.stringify(reply)} as a question`, () => {
      expect(classifyReply(reply)).toBe("question");
    });
  }

  it("treats an empty or whitespace reply as a question rather than a yes", () => {
    expect(classifyReply("")).toBe("question");
    expect(classifyReply("   ")).toBe("question");
  });

  /** Long replies are the reader telling us something, whatever word they open with. */
  it("does not read a long sentence as a yes just because it starts with one", () => {
    expect(classifyReply("好呀不過我想問吓隻白色藥係做咩用嘅")).toBe("question");
  });
});
