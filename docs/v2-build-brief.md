# v2 build brief — implementing the approved clickable workflow

The source of truth is `design-canvas/workflow-v2.dc.html`, imported from Kevin's Claude Design
project "Medical discharge form explainer" (artboard: *出院紙傾偈 — clickable workflow, v2*).
**Read it before you write anything.** It is a working React prototype: the markup is the layout,
the `<script type="text/x-dc">` block at the bottom is the state machine and every string.

This brief pins the parts that cross module boundaries. Where the brief and the prototype
disagree, the brief wins — every difference is deliberate and explained.

---

## 1. What the product now is

Three tabs, one conversation, **one active sheet at a time**.

| Tab | Route | Contents |
| --- | --- | --- |
| 記錄 | `/` | Photograph or upload a sheet · a notification from 明明 · the sheet being talked about · 以前嘅 (read-only history) |
| 傾偈 | `/chat` | The whole product. The sheet arrives as messages from 明明, who types and speaks on his own. Questions go in the same thread. |
| 跟進 | `/track` | The active sheet's medicines, its appointment, its warning signs. Nothing else. |

Full-screen, tab-less routes: `/capture` (camera + review). `/chat` also hides the tab bar — it
has its own back arrow, like a WeChat conversation.

**One active sheet** is the load-bearing rule. 跟進 is not a global list; it is *this sheet's*
follow-up. Photographing a new sheet makes it active and archives the previous one read-only
(`只可以睇`) with its counters frozen. That is what keeps 「張紙寫：每日兩次」 honest — a counter
can only ever quote one piece of paper.

Legacy routes redirect: `/read` → `/chat`, `/ask` → `/chat`, `/plan` → `/track`.
`/setup` and `/settings` stay as they are.

---

## 2. Non-negotiables (constitution, unchanged)

These predate the redesign and survive it. `.specify/memory/constitution.md` is binding.

1. **Facts about the page, never verdicts about the person.** No diagnosis, no prognosis, no
   "you are getting better".
2. **Warning signs first, always, by rule.** `lib/rules/card-order.ts` decides the order. A model
   turn can never reorder or bury a red flag.
3. **Rules decide, the model only reads and phrases.** Refusals (`lib/rules/refusal.ts`) and crisis
   detection (`lib/rules/crisis.ts`) run *before* any model call.
4. **Everything traces to a line.** Every spoken fact carries a `source.quote` the user can open.
5. **Nothing leaves the phone** but the question and the page image. One button wipes everything.
6. **Banned words** (`lib/rules/banned-terms.ts`) filter every string the app speaks or shows.

Two more that this redesign makes newly easy to break:

7. **A counter must never show a clock time.** The sheet prints *frequencies* ("每日兩次，隨餐"),
   not times. Rendering "8am / 8pm" would be prescribing. Dose cards quote the printed clause
   verbatim behind 「張紙寫：」 and count *remaining times today*, never a time of day.
   The prototype's own reply 「夜晚仲有一次」 breaks this — **use 「今日仲有一次」**.
8. **A stopped medicine is never a dose.** `Medicine.status` is `current | stopped | changed`.
   Only `current` is scheduled or counted. A `stopped` medicine still appears — the family needs
   to know the page names it — but visibly marked as ended, never with a 食咗 button.

---

## 3. Design tokens

Taken from the prototype, with the greys and the jade darkened to clear WCAG AA 4.5:1. Measured
ratios are in the comments; do not re-lighten them. This app is for people in their seventies.

```
--ground        #FBF8F3   phone background
--card          #FFFFFF
--ink           #2A2723   14.0:1 on ground — all primary text
--muted         #6D6B65    4.9:1 on ground, 5.1 on white, 4.6 on #F1EDE4 — ALL secondary text
--faint         #B4B0A7   decoration ONLY: chevrons, rules, dots. Never a word to read.

--jade          #1A7D63   5.05:1 with white — every filled button, at any text size
--jade-shadow   #12604C   the `0 4px 0` chunky shadow under a jade button
--jade-ink      #14705A   5.67:1 on ground, 5.34:1 on tint — jade-coloured TEXT
--jade-tint     #E9F4F0   secondary button fill
--jade-tint-2   #E4F1EC   inline chips, dose pips
--jade-bubble   #DCEFE7   the user's own message bubble
--jade-edge     #CFE4DC   the tinted button's shadow

--neutral       #F1EDE4   quiet fills, keyboard-mode buttons
--neutral-2     #F6F3EC   the 「張紙寫：」 quote block
--hairline      #EAE5DC
--paper         #EDE8DF   page thumbnails

--warn-bg       #FCF2DC
--warn-ink      #6B4B03   7.17:1 — warning text
--warn-stroke   #8A6104   4.98:1 — the triangle, the 讀住 waveform
--warn-dot      #C88A16   bullets, the unread dot
--warn-btn      #F6E4BE
```

Greys collapsed on purpose: the prototype had `#7C7A73` (4.06), `#A5A29A` (2.41), `#B4B0A7`
(2.04) and `#8FA79E` (2.28) all carrying real words. They are now one `--muted` that passes on
every ground it lands on. `--faint` survives only for glyphs that carry no meaning.

**Type.** Chinese uses the system HK stack (`PingFang HK`, then `Noto Sans CJK HK`) — identical in
feel to the prototype's Noto Sans HK, already installed on every iPhone, and no multi-megabyte CJK
download on hotel wifi during a demo. Latin uses Instrument Sans via `next/font` (small, Latin
subset only), falling back to the system stack.

Sizes are from the prototype and are deliberately large: page titles 30/700, agent bubbles 18–20,
warning items 22/500, dose names 22/700, secondary lines 15–18. Minimum tap target 48px.
Buttons: radius 16–24px, `box-shadow: 0 4px 0 var(--jade-shadow)`, and on `:active`
`transform: translateY(4px); box-shadow: 0 0 0`.

---

## 4. Module ownership

Do not edit a file another agent owns. If you need something from it, use the contract below.

| Agent | Owns |
| --- | --- |
| **A · state** | `lib/sheets/**`, `lib/rules/doses.ts`, `lib/rules/template-fallback.ts`, `lib/storage/local.ts`, their tests |
| **B · system** | `app/globals.css`, `app/layout.tsx`, `lib/i18n/ui.ts`, `components/Mascot.tsx`, `components/TabBar.tsx`, `components/BottomSheet.tsx`, `components/ChunkyButton.tsx`, `components/SourceSheet.tsx` |
| **C · chat** | `app/chat/**`, `components/chat/**`, `app/read/**`, `app/ask/**` |
| **D · shell** | `app/page.tsx`, `app/capture/**`, `app/track/**`, `app/plan/**`, `components/home/**`, `components/track/**`, `components/Capture.tsx` |

Nobody edits `lib/domain/schemas.ts`, `lib/model/**`, `lib/server/**`, `app/api/**`,
`lib/rules/card-order.ts`, `lib/rules/plan-from-reading.ts`, `lib/rules/refusal.ts`,
`lib/rules/crisis.ts`, `lib/rules/banned-terms.ts`, or the fixtures. Those are correct and
verified against the live model; the redesign is a client concern.

---

## 5. The state contract (Agent A writes it, everyone imports it)

`lib/sheets/types.ts`

```ts
export type BriefPhase = "idle" | "intro" | "warn" | "ask" | "speaking" | "end";
export type CheckinState = "none" | "pending" | "open" | "done";

export interface ThreadMessage {
  id: string;
  role: "agent" | "user";
  text: string;                    // already in the sheet's dialect and script
  at: string;                      // ISO
  origin: "rule" | "model" | "user";
  source?: SourceReference | null; // opens the source sheet
  link?: "track" | null;           // renders the 睇「跟進」 button
  outcome?: AnswerOutcome | null;  // styles refusals / referrals / not-on-sheet
  stopped?: boolean;               // page says this medicine has been stopped
  unverified?: boolean;            // card and its own quote disagree — tell the reader to check
}

export interface DoseState {
  key: string;      // `m${index}` — the medicine's index in reading.medicines
  taken: number;
  day: string;      // local calendar date "YYYY-MM-DD" this count belongs to
}

export interface Sheet {
  id: string;
  capturedAt: string;
  pageCount: number;
  title: string;            // derived by rule, never by a model turn — see below
  reading: StoredReading;
  plan: DraftPlan;
  thread: ThreadMessage[];
  doses: Record<string, DoseState>;
  briefing: { phase: BriefPhase; step: number };
  checkin: CheckinState;
  archivedAt: string | null;
}
```

`title` is derived from the reading by a pure rule, in this order: the first non-empty line of
`hospitalContact.text` truncated at the first punctuation; else the first `followUp[].clinic`;
else the fixed string 「出院紙」 / 「出院纸」 / "Discharge sheet". **Never invent a hospital or a
department.** The prototype's 「瑪麗醫院 · 心內科」 is fixture data, not a promise.

`lib/sheets/store.ts` — the only module that writes sheets.

```ts
export function loadSheets(): { active: Sheet | null; archive: Sheet[] };
export function startSheet(reading: StoredReading, pageCount: number): Sheet; // archives the previous
export function updateActive(patch: (s: Sheet) => Partial<Sheet>): Sheet | null;
export function appendMessage(m: Omit<ThreadMessage, "id" | "at">): Sheet | null;
export function takeDose(key: string, today: Date): Sheet | null;
export function subscribeSheets(fn: (v: { active: Sheet|null; archive: Sheet[] }) => void): () => void;
```

Storage stays under the single `fitornot.v1` key so `deleteEverything()` is still one
`removeItem`. Archive is capped at 5 sheets; the image guard (`assertNoImageData`) still covers
every write. `StoredState.reading`/`plan` are kept as a read-only migration path: on first load,
an existing `reading` becomes the active sheet.

`lib/rules/doses.ts` — pure, no clock, `today` always passed in.

```ts
export interface DoseTarget {
  key: string;
  name: string;        // verbatim name + strength
  generic: string;     // verbatim strength/amount line, or ""
  printed: string;     // the frequency clause, VERBATIM, rendered behind 「張紙寫：」
  total: number;       // times per day the clause states; 0 when it is as-needed or unstated
  asNeeded: boolean;   // 痛先食 / PRN — never counted down
  stopped: boolean;    // status !== "current"
}
export function doseTargets(reading: StoredReading): DoseTarget[];
export function timesPerDay(frequency: string | null): { total: number; asNeeded: boolean };
export function remaining(target: DoseTarget, state: DoseState | undefined, today: Date): number;
export function localDay(d: Date): string;   // "YYYY-MM-DD" from the DEVICE's own calendar
```

`timesPerDay` recognises only what the page can print, in all three scripts, and returns
`{total: 0, asNeeded: true}` for anything as-needed and `{total: 0, asNeeded: false}` when it
cannot tell. **It never guesses.** Recognised: 每日/每天 N 次, N times daily/a day, BD/TDS/QID/OD
(and 每日兩次 etc.), 一日 N 次. As-needed: 痛先食, 需要時, PRN, as required, when necessary.
Anything else → 0/false, and the card shows the printed clause with no counter at all.

---

## 6. The chat surface (Agent C)

This is the product. Get it right.

**Nothing is a play button.** 明明 types himself out clause by clause (split on `，。、？！：`,
~360ms per clause) and speaks at the same time. The 讀住 waveform is a *status indicator*, not a
control. The only voice control is the speaker toggle in the header, which silences the audio and
lets the text keep typing.

**The briefing**, driven by `lib/rules/card-order.ts` — never by a model turn:

1. `intro` — 「我睇完你張紙。最緊要嘅先講。」 (fixed template, `origin: "rule"`)
2. `warn` — the amber warning block renders and reads itself immediately. Always first. If the
   sheet has no warning signs, the `noWarnings` card takes this slot and says so.
3. `ask` — 「明唔明？」 with 再講一次 / 明白. 再講一次 re-speaks the last thing said without
   re-typing it.
4. `speaking` — 明白 advances one piece. Pieces are the remaining cards in `CARD_ORDER` sequence:
   medicines (carries the 睇「跟進」 link), follow-up, diet, activity, unreadable. Each piece is
   the card's own `body` text, so it is already banned-term filtered and already carries a source.
5. `end` — 「講完晒。有咩想問，按住下面個框講。」

A card marked `stopped` is spoken as ended and gets no counter. A card marked `unverified` is
spoken with the caution suffix and the source link is emphasised.

**The bar.** One 72px control across the full width.
- Press and hold past 220ms → listening (`lib/speech/stt.ts`), waveform, label 「聽住你講…」,
  sub-label 「· 放手就送出」. Release sends.
- A quick tap (released before 220ms) → keyboard mode: a 56px text field and a 送 button, with a
  mic button to go back.
- Leaving the button while holding cancels the same way releasing does.
- When STT is unavailable, the bar goes straight to keyboard mode and says so honestly
  (`fallback` copy already exists in `lib/i18n/ui.ts`).

**Questions** go through `lib/client/ask-stream.ts` unchanged. The refusal, not-on-sheet and
crisis-referral outcomes render as messages in the thread, styled by `outcome` — not as separate
screens. The crisis referral keeps its resource list.

**The check-in.** When the active sheet has at least one countable dose and the briefing has
reached `end`, `checkin` becomes `pending`. Opening the notification sets it to `open` and 明明
asks 「今日食咗藥未？張紙寫每日兩次，隨餐食。」 — the frequency quoted **verbatim from the page**,
assembled by a fixed template, never by the model. 食咗 increments the counter and replies
「好，我幫你記低咗。今日仲有一次。」 (or 「今日食晒喇。」). 未食 replies with the printed clause
again and nothing else. Then `checkin` is `done`.

There are **no push notifications.** The block on 記錄 is an in-app message, and it must not
pretend otherwise.

---

## 7. 記錄 and 跟進 (Agent D)

**記錄, empty:** the two big buttons (拍張紙 jade / 上載相片 tinted), then 明明 at 34% opacity and
「仲未有紙。拍完我就即刻講俾你聽。」

**記錄, with a sheet:** the two buttons, smaller; then the notification block when
`checkin === "pending"` (明明's face, an amber unread dot, the time, the question, a chevron) or
the collapsed line 「今日嘅藥：仲有 N 次」 linking to 跟進 when it is `done`; then 傾緊呢張 with
the active sheet's card (page thumbnail, title, date · N 頁 · N 隻藥, and a preview of where the
conversation got to); then 以前嘅 (N) collapsing into read-only rows marked 只可以睇.

**Capture.** `/capture` is the camera; 上載相片 opens a multi-select picker. Ceiling is **6 pages**
and it is stated in all three places it can bite: the picker subtitle, the dimmed thumbnails once
you reach it, and the camera hint 「夠 6 頁喇，按「完成」」 with a spent shutter. A medical document
is never silently truncated. Review shows every page with 再拍 and 加一頁, the on-device notice
「張紙留在你電話。你唔send，冇人睇到。」, and 講俾我聽 which starts the read.

The reading screen is the transitional state while `/api/read` streams. Keep the existing
`lib/client/read-stream.ts` wiring and its failure states (502 → offer the bundled sample, 422 →
the couldn't-read state, 413 → re-downscale and retry once). Those are covered by
`tests/e2e/fallbacks.spec.ts` and must keep passing.

**跟進:** the strip naming the sheet it follows (taps into the thread) · the appointment card,
which shows a date and days-remaining **only when `plan.followUpDate` parsed**; otherwise it shows
the printed `when` verbatim and no countdown · 今日嘅藥, one card per medicine: name, strength,
「張紙寫：<frequency verbatim>」, and either 今日仲有 N 次 / 今日食晒 with a 食咗 button, or
唔痛就唔使食 with no button, or — for a `stopped` medicine — 張紙寫唔使再食 with no button and no
counter · 危險訊號 (N), collapsible, with 叫明明講一次 which jumps to the thread and re-speaks it.

---

## 8. Verification

Every agent runs, in the repo root, before reporting:

```
NODE_OPTIONS=--use-openssl-ca ./node_modules/.bin/tsc --noEmit
NODE_OPTIONS=--use-openssl-ca ./node_modules/.bin/vitest run
NODE_OPTIONS=--use-openssl-ca ./node_modules/.bin/eslint .
```

`NODE_OPTIONS=--use-openssl-ca` is required — without it Node hangs at exit whenever `tls` loads.
It also **breaks outbound HTTPS**, so anything that calls a provider runs under `env -u NODE_OPTIONS`.

Do not report a task done on a suite you did not run. If you break a test that belongs to another
agent's file, say so in your report rather than editing their file.

**Known blocker:** the Anthropic API credit balance is exhausted, so `/api/read` and `/api/ask`
return 502 `model_unavailable` against the live key. Build and test against the bundled fixtures
and the Playwright mocks; the live path is verified separately once the balance is topped up.
