/**
 * What one message in the 傾偈 thread is allowed to say about itself.
 *
 * Three of these are compliance rules rather than styling, and none of the bundled fixtures can
 * reach them — no sample sheet has a withdrawn medicine, and none has a card that disagrees with
 * its own quoted line — so they are asserted here rather than in the browser:
 *
 *   · a model-written line carries the AI label; a fixed template must NOT (FR-009);
 *   · a `stopped` medicine is marked as ended and offered no 食咗 anywhere (constitution VIII);
 *   · an `unverified` card's source link is emphasised, because that is the line to check.
 *
 * Rendered with `react-dom/server`: this repo's vitest runs in `node` with no jsdom, and
 * everything asserted here is in the markup either way.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatMessage from "@/components/chat/ChatMessage";
import { LocaleProvider } from "@/components/LocaleProvider";
import { UI } from "@/lib/i18n/ui";
import type { ThreadMessage } from "@/lib/sheets/types";

const SOURCE = { section: "Medications", lineIndex: 4, quote: "Metformin 500mg BD with meals" };

function message(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "m1",
    role: "agent",
    text: "Metformin 500mg，一粒，一日兩次，同飯一齊食。",
    at: "2026-09-03T02:00:00.000Z",
    origin: "model",
    sources: [SOURCE],
    ...overrides,
  };
}

function render(m: ThreadMessage): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <ChatMessage
        message={m}
        reading={false}
        sourceTitle={UI.hant["card.medicine"]}
        dialect="yue"
        onOpenSource={() => {}}
        onOpenTrack={() => {}}
        onSpeak={() => {}}
      />
    </LocaleProvider>,
  );
}

describe("a message says who wrote it", () => {
  it("labels a model-written line as AI", () => {
    expect(render(message())).toContain(UI.hant["aiChip"]);
  });

  it("does not label a fixed template as AI", () => {
    // The intro, the check-in question and every refusal are rule-written. Labelling them would
    // be as wrong as failing to label a model turn.
    expect(render(message({ origin: "rule", text: UI.hant["brief.intro"] }))).not.toContain(
      UI.hant["aiChip"],
    );
  });
});

describe("a stopped medicine is spoken as ended, never as a dose that is due", () => {
  const html = render(message({ stopped: true }));

  it("says the page has withdrawn it", () => {
    expect(html).toContain(UI.hant["dose.stopped"]);
  });

  it("offers no 食咗 and no counter", () => {
    expect(html).not.toContain(UI.hant["dose.take"]);
    expect(html).not.toContain("今日仲有");
    expect(html).not.toContain(UI.hant["dose.done"]);
  });

  it("keeps its line on the page, because the family has to see the drug is named", () => {
    expect(html).toContain(UI.hant["card.sourceLink"]);
  });
});

describe("a card that disagrees with its own line points harder at the line", () => {
  it("emphasises the source link on an unverified message", () => {
    const plain = render(message());
    const doubtful = render(message({ unverified: true }));
    expect(plain).toContain(UI.hant["card.sourceLink"]);
    expect(doubtful).toContain(UI.hant["card.sourceLink"]);
    // The doubtful one is drawn on the warning fill; the ordinary one is a quiet jade link.
    expect(doubtful).toContain("bg-warn-bg");
    expect(plain).not.toContain("bg-warn-bg");
  });
});

describe("an outcome styles the message as itself, inside the thread", () => {
  it("gives a refusal its own heading rather than its own screen", () => {
    const html = render(
      message({ origin: "rule", sources: [], outcome: "refused_medicine_change" }),
    );
    expect(html).toContain(UI.hant["ask.refused"]);
  });

  it("gives a not-on-sheet answer the honest heading", () => {
    const html = render(message({ origin: "rule", sources: [], outcome: "not_on_sheet" }));
    expect(html).toContain(UI.hant["ask.notOnSheet"]);
  });

  it("keeps the crisis referral's resource list", () => {
    const html = render(
      message({ origin: "rule", sources: [], outcome: "crisis_referral", text: "…" }),
    );
    expect(html).toContain(UI.hant["ask.referral"]);
    expect(html).toContain(UI.hant["ask.referralCall"]);
    // Nothing model-written, and nothing spoken: no AI chip on a fixed referral.
    expect(html).not.toContain(UI.hant["aiChip"]);
  });
});

describe("the reader's own words are their own bubble", () => {
  it("renders a user message with no source, no chip and no track link", () => {
    const html = render(
      message({ role: "user", origin: "user", text: "覆診要帶咩？", sources: [] }),
    );
    expect(html).toContain("覆診要帶咩？");
    expect(html).not.toContain(UI.hant["aiChip"]);
    expect(html).not.toContain(UI.hant["card.sourceLink"]);
    expect(html).not.toContain(UI.hant["brief.trackLink"]);
  });
});

describe("the 睇「跟進」 offer only appears where the rules put it", () => {
  it("renders under a message that carries the link", () => {
    expect(render(message({ link: "track" }))).toContain(UI.hant["brief.trackLink"]);
  });

  it("is absent otherwise", () => {
    expect(render(message())).not.toContain(UI.hant["brief.trackLink"]);
  });
});
