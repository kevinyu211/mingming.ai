# Companion D — "Three Things" build brief

Source of truth for the look: the Claude Design artboard **Companion D - Three Things** in the
project "Medical form companion assistant" (`ba037191-dacc-47b3-9d03-2ec36739d138`). Source of
truth for behaviour: unchanged — `specs/001-discharge-sheet-agent/spec.md`,
`.specify/memory/constitution.md`, `docs/v2-build-brief.md`. Where the artboard and the
constitution disagree, the constitution wins; every such case is listed in §4.

Branch: `feat/companion-atoms` (started as Companion E, retargeted to D on 2026-09-05).

## 1. What the artboard is

Four screens, one voice: "the chat is the app."

| Artboard screen | Route | What it is now |
| --- | --- | --- |
| start | `/` (empty) | Wordmark + language pill, 明明 with 「仲未有紙…」, 「您好。畀我睇睇您嘅出院紙。」, two rows: 拍張紙 (charcoal) and 上載相片 (white) |
| scan or upload | `/capture` | Light page, dark rounded card with the frame and a scan line, shutter, an upload pill, 完成 |
| talk | `/chat` | The briefing as bubbles from 明明, each section handing over a widget: summary → checklist → visits → warning signs. Hold the bar to talk, tap to type |
| today | `/track` | Greeting, 今日嘅藥 with slots to tick, the next visit, the 「call if」 line, 分享俾屋企人, a floating 同明明傾傾 pill |

The v2 three-tab shell stays (記錄 / 傾偈 / 跟進): the artboard's "one button there, one button
back" is the floating pill on 今日 and the 記錄 pill in the chat header, and the tab bar underneath
is what the e2e suite and a seventy-year-old's thumb already know.

## 2. How the frontend meets the backend

Nothing under `lib/model`, `lib/server`, `app/api`, `lib/rules` or `lib/sheets/store.ts` changed.
The design is wired to what already exists:

| Artboard element | Backed by |
| --- | --- |
| Summary card (3 numbers) | `sheet.title` (`lib/sheets/title.ts`), `reading.medicines.length`, `reading.warningSigns.length`, `plan.followUpDate` (only when it parsed) |
| Pill checklist, slots to tick | `doseTargets()` + `remaining()` in `lib/rules/doses.ts`; a tap calls `takeDose()` in the store. Slots are counts (第 1 次), never clock times |
| Visit rows + 加入日曆 | `plan.items` (appointments) + `buildIcs()` via the shared `useAddToCalendar` hook |
| Warning signs, numbered | `reading.warningSigns` (model text → carries the AI chip); the hospital's own contact line becomes a `tel:` pill only when a number is printed |
| Which bubble gets which widget | `Beat.widget` in `components/chat/briefing.ts`, decided by position in the script (a rule), persisted as `ThreadMessage.widget` and rendered from the LIVE sheet |
| Language pill | `LocaleProvider.setDialect` + `setLocale`, same as the chat header chip |
| Hold-to-talk bar | `components/chat/ChatBar.tsx`, unchanged behaviour (220 ms hold, `listen()` from `lib/speech/stt.ts`) |

New files: `components/chat/Widgets.tsx`, `components/chat/Spark.tsx`, `components/track/DoseSlots.tsx`,
`components/track/useAddToCalendar.ts`, `components/home/LanguagePill.tsx`, `components/Wordmark.tsx`.
Type additions: `ThreadWidget` and `ThreadMessage.widget?` in `lib/sheets/types.ts` (optional, so
stored sheets from earlier builds still parse).

## 3. Tokens

Every v2 token **name** is kept (screens, tests and contrast notes are written against them); the
**values** move to the artboard's palette. See `app/globals.css` for the measured ratios.

- ground `#F3F3F5` · card `#FFFFFF` · ink `#131313` · muted `#68686D` (5.0:1 on ground) · faint `#A8A8AD` (decoration only)
- primary action (`--jade`) is charcoal `#131313`; secondary is white with a `#E3E2E7` stroke; quiet is `#EBEBEB`
- the assistant's colour: `linear-gradient(180deg,#978DB0,#BF87AB)` behind the ✦; the floating talk pill is darkened to `#5F6090→#7A5E8B→#95597F` so white text clears 5:1
- warnings keep the v2 amber (`#FCF2DC` / `#6B4B03`): the artboard has no amber, but the amber-first warning bubble is a brief rule and the tests assert on it
- type: system HK sans + Instrument Sans (standing in for Visuelt Pro); headlines 700 with −0.5 px tracking; bubbles 17/26; cards 20 px radius; pills 999; no shadows except the shutter and the talk pill

## 4. Where the artboard was not followed, and why

1. **"You were in hospital 3 days with a chest infection (pneumonia)"** — a diagnosis. The summary card shows the sheet's title and three counts instead (constitution I).
2. **Slot chips labelled 08:00 / 14:00 / 20:00** — the sheet prints frequencies, not times. Slots are 第 1 次 / 第 2 次 (brief §2 rule 7).
3. **Water tracker** — nothing on a discharge sheet says how much to drink; a goal would be an instruction the page did not print. Omitted.
4. **"→ 999" emergency line** — replaced by the sheet's own contact line and the existing crisis-referral path.
5. **Share card with a QR to "the real sheet"** — the sheet never leaves the phone, so there is nothing for a QR to open. 分享俾屋企人 keeps the on-device text share.
6. **Follow-up question chips** — the v2 chat deliberately removed "press a button to continue"; the reader replies by holding the bar. Not reintroduced.
7. **No mascot in the artboard** — 明明 stays in the header, on 記錄 and on the empty states (the animal picker and its tests still exist); the thread avatar is the artboard's ✦.
8. **Two contrast fixes** — `#6E6E73` → `#68686D` for secondary text, and the talk-pill gradient darkened.

## 5. Verification

```
NODE_OPTIONS=--use-openssl-ca ./node_modules/.bin/tsc --noEmit
NODE_OPTIONS=--use-openssl-ca ./node_modules/.bin/eslint .
NODE_OPTIONS=--use-openssl-ca ./node_modules/.bin/vitest run
E2E_PORT=3011 npm run e2e
```

Results on 2026-09-05 (branch `feat/companion-atoms`, commit after this brief):

- tsc, eslint, `next build`: clean. Vitest: 1263 passed.
- Playwright (both phone profiles): every spec that passes on the parent commit `87e5ad2` passes
  here. The parent itself fails 8 specs per profile on that date — the ones waiting for the old
  `brief.intro` sentence, the picker / laptop capture flows and the language switch — and the
  same 8 fail on this branch for the same reasons (the e2e specs are owned by the submission
  merge and were being repaired there). No failure is introduced by this branch.
- After merging `origin/main` (a8089cf: the deployed model path and the repaired specs) into the
  branch with no conflicts: tsc clean, 1263 unit tests passed, `next build` clean, and the full
  Playwright suite passed on both phone profiles (116 passed, 0 failed).
- Tests touched: `tests/unit/design-system.test.tsx` (the default companion plate colour pin).
- The e2e helpers require a visible heading named 記錄 / 跟進 on the two tabs; the artboard has no
  page title, so it is rendered small above the hero rather than dropped.
