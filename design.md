# Design brief: Discharge Sheet Agent (working name "Fit or Not")

For Claude Design. Everything a designer needs to draft the screens without reading the spec.
Source of truth for behaviour: `specs/001-discharge-sheet-agent/spec.md`. Source of truth for
rules: `.specify/memory/constitution.md` and `rules.md`.

## 1. What it is

A phone web app for the adult child of a parent who just left hospital. Photograph the discharge
sheet, hear it explained in the parent's dialect (Cantonese or Mandarin), warning signs first,
medicines exactly as printed, follow-up, diet line. Then ask it questions about the page and hear
the answer. Nothing is stored anywhere but the phone.

**Persona**: Ka-yan, 42, Hong Kong. Her mother, 72, reads only Chinese and speaks Cantonese. The
sheet is one page of English abbreviations. Ka-yan reads English slowly and is holding the paper
in a taxi.

**The stage moment**: a dense English page goes in, and the phone says, in warm Cantonese,
"如果佢胸口痛、氣促、或者隻腳腫，即刻返急症室。" Design everything around that moment landing.

**Names to pick from** (all pass the banned-word rule; none sound clinical):
- 聽得明 (Teng1 Dak1 Ming4, "can understand by listening")
- 講你知 (Gong2 Nei5 Zi1, "tell you")
- 出院之後 ("after discharge")
- Fit or Not (current working name, from the earlier food idea; weakest fit now)

## 2. Design principles

1. **Warning signs first, always.** The first card on every reading is the red-flag card. It is
   visually heavier than everything else and it auto-plays.
2. **One thing per screen.** Capture, then cards, then ask. No dashboard, no tabs.
3. **Speak-first.** The primary control on any card is Play. Reading is the fallback, not the
   default. The play state must be obvious from across a room (the parent is watching too).
4. **Big and calm.** Body text 18 px minimum, card titles 22 px, tap targets 48 px. The bystander
   is 72 and reads over a shoulder.
5. **Honest states are designed, not apologetic.** "I couldn't read this part", "This is a sample
   sheet", "The sheet doesn't say", and the AI label are first-class components with their own
   look, not error toasts.
6. **Warm, not clinical.** No red crosses, no stethoscopes, no hospital blue, no lab-coat white.
   It should feel like a kitchen table, not a ward. This is also a rule: the product must never
   look like it is issuing medical verdicts.
7. **Everything traces to a line.** Every card has a visible "from the page" affordance that opens
   the verbatim quote. It is part of the card anatomy, not hidden in a menu.

## 3. Visual language

**Palette** (light theme first; dark theme should invert warmth, not go clinical)
- Ground: warm off-white `#FAF7F2`
- Ink: `#1F1B16`
- Muted ink: `#6B625A`
- Accent (play, primary actions): deep teal `#0F6E68`
- Warning card: amber `#B8600F` on `#FFF1DF`, thick left rule; never pure red (reads as "danger
  verdict"), amber reads as "attention"
- Medicine cards: neutral card `#FFFFFF` with a soft `#E9E2D8` border
- Unreadable / sample / not-on-sheet: dotted border, muted ink, small "?" glyph, background `#F3EEE6`
- AI label chip: `#E6F0EF` background, teal text, sparkle glyph

**Type**
- Chinese: Noto Sans TC (traditional) and Noto Sans SC (simplified), weight 500 for body
- Latin and numbers: Inter
- Sizes: display 28, card title 22, body 18, meta 15. Line height 1.5 for Chinese body.
- Medicine names, strengths and frequencies are set in a slightly larger monospaced-feeling
  treatment (Inter tabular numbers, 20 px) so "5 mg" and "1 tab daily" are unmistakable.

**Layout**
- 8 pt grid, 20 px page margins, cards full-bleed to the margins, 16 px radius
- Persistent bottom area: disclaimer line (13 px, muted) above a safe-area padding; on the cards
  screen the sticky bottom holds Play-all and Ask
- No drop shadows heavier than 0 2 8 rgba(31,27,22,0.06)

**Motion**
- Cards arrive one by one as the reading streams: 120 ms fade-and-rise each, staggered
- Play button pulses gently while speaking; the spoken sentence highlights word-group by
  word-group if the voice provider gives timings, otherwise the card gets a soft glow
- Push-to-talk: the mic button grows while held, with a level ring
- Respect reduced motion: no stagger, no pulse, state changes only

**Iconography**: rounded, 2 px stroke, no medical symbols. Speech bubble, page with a fold, ear,
microphone, quote marks for "from the page".

## 4. Screens and states

All artboards 390 × 844 (iPhone), also design 360 × 800 (Android). Copy shown in zh-Hant, with
zh-Hans and English variants to be supplied from `lib/i18n/ui.ts`.

### S1 Consent gate (first thing, every session)
- Title: 呢個係示範用嘅資料
- Body: two lines saying inputs are simulated, nothing is stored anywhere but this phone, no names
  and no diagnoses are collected
- One button: 明白，開始 (48 px tall, full width)
- Disclaimer line pinned at bottom (see section 6)

### S2 Session language (until the profile exists)
- Question: 阿媽聽咩話？ with two big tiles: 廣東話 / 普通話. Script toggle (繁 / 简) small under.

### S3 Capture
- Big camera tile with a page silhouette and the line 影低張出院紙
- Secondary: 相簿揀相 · 打字輸入 · 用示範紙
- After one photo: thumbnail with "加第二頁" and a primary 開始讀
- State: uploading/reading. Not a spinner alone: a progress line with three steps (讀緊 →
  執緊重點 → 準備讀出), and the text 首先會讀警號 so the user knows what comes first
- State: not a sheet. Illustration of a page with a question mark, text 睇落唔似出院紙, buttons
  再影一次 / 用示範紙

### S4 Cards (the main screen)
- Sticky header: 出院紙 · label of who it is for if a profile exists · script toggle
- Card 1 (always): **警號** in amber, each warning sign as a line with its action, big Play
- Then medicine cards: name large, strength and frequency on one line, Play, and the
  "from the page" quote link. If frequency is missing: a muted line 用法冇印，睇藥袋或者問藥劑師
- Follow-up card: clinic and when, Play
- Diet card: the printed line in quotes, plus one plain sentence only for recognised types
- Activity card (if printed)
- Unreadable cards: dotted, 呢部分讀唔到 with the section name and 再影一次
- Every AI-written body carries the AI chip: AI 寫嘅，可能有錯
- Sticky bottom: 全部讀出 (primary) · 問問題 (secondary)
- Sample mode: a full-width banner at the top of the stack, 示範紙，唔係真嘅

### S5 Source sheet (bottom sheet from any card)
- Section name, line number, the verbatim quote in a serif-ish quote block, the original language
  untouched (English stays English)
- Close only. No editing here.

### S6 Ask
- Top: the last answer as a card (same anatomy as S4 cards, with cited card name and the quote link)
- Middle: transcript of the question with an edit affordance before sending
- Bottom: language toggle (廣東話 / 普通話 / English), a big hold-to-talk mic, a text field always
  visible beside it
- Outcome states, each its own card style:
  - Answered: teal accent, cited card chip
  - Refused (medicine change): neutral card, 呢樣要問藥劑師, with the sheet's contact line if any
  - Not on sheet: dotted card, 張紙冇講呢樣
  - Crisis referral: calm card, no amber, the organisers' resource list, one Call button per line
- Agent limits line under the mic (see section 6)

### S7 Setup (profile, two screens)
- 你煮飯畀邊個？ chips: 阿媽 · 阿爸 · 老豆 · 家婆 · 其他 (max 12 characters, no name prompt)
- 佢聽咩話？ tiles as S2
- Privacy line on both: 只會存喺呢部電話，除咗你問嘅問題，乜都唔會傳出去。冇名，冇病名。

### S8 Plan
- Draft list: appointment row, medicine-time rows, each with the verbatim when/frequency and the
  quote link
- Primary: 確認 (nothing is saved until tapped). Secondary: 加入日曆
- Expired state: banner 張紙嘅指示係寫到覆診嗰日為止，覆診時問吓仲使唔使

### S9 Settings
- Data statement (full text), the agent-limits block, script toggle, and 刪除所有資料 with a
  confirm sheet

### S10 Offline / fallback states
- No voice available: the Play button becomes 睇字 and the card body is already there
- Model unavailable: 而家讀唔到，用示範紙睇下點運作 with the sample button
- Camera denied: capture tile swaps to 相簿揀相 as primary

## 5. Component inventory

Card (warning / medicine / followUp / diet / activity / unreadable / noWarnings / referral), AI
chip, Source link + bottom sheet, Play button (idle / speaking / unavailable), Play-all bar, Mic
button (idle / held / processing / unavailable), Language tiles, Script toggle, Sample banner,
Progress line, Consent screen, Disclaimer footer, Agent-limits block, Chip group (labels),
Confirm sheet (delete), Empty and decline illustrations.

## 6. Copy rules (non-negotiable)

- Never use: 診斷/诊断, 治療/治疗, 處方/处方, 治癒/治愈, 能吃/唔食得/不能吃, "diagnose", "treat",
  "cure", "prescribe", "you should", or any number about the person. UI copy is tested against
  this list in CI.
- Disclaimer footer, every screen (from rules.md section 16): 本工具只係幫你理解出院紙，唔係醫療建議，
  唔可以代替醫護人員嘅診斷同治療。有疑問請問返醫生或者藥劑師。AI 寫嘅內容可能有錯。 (The words
  診斷/治療 appear here only because the rulebook's own disclaimer wording requires them; this is
  the single exemption.)
- Spoken outputs end with: AI 寫嘅，可能有錯。
- AI chip: AI 寫嘅，可能有錯
- Agent limits block: 佢會做：讀出張紙、答張紙上面嘅嘢、幫你整個計劃你確認。佢唔會做：唔會斷症、
  唔會改藥、唔會幫你聯絡任何人。
- Tone: a daughter talking to her mother. Short sentences. Particles are fine (啦, 喎). Never
  scold, never alarm beyond what the sheet itself says.

## 7. Accessibility

- Contrast 4.5:1 minimum for all text, 3:1 for the amber rule and icons
- All tap targets 48 × 48
- Supports the phone's larger text sizes up to 200% without clipping cards
- Every Play button has a spoken label; every card is a landmark with the card type announced
- Playback never autoplays without a user tap (iOS rule and a courtesy)
- Colour is never the only signal: warning cards have the amber rule and the 警號 title

## 8. Artboards to produce

1. S1 Consent
2. S2 Session language
3. S3 Capture, idle
4. S3 Capture, reading progress
5. S3 Not a sheet
6. S4 Cards, Hong Kong English sheet, Cantonese, warning card speaking
7. S4 Cards, sample banner + one unreadable card
8. S5 Source sheet open over a medicine card
9. S6 Ask, answered state
10. S6 Ask, refused state
11. S6 Ask, crisis referral state
12. S7 Setup, label chips
13. S8 Plan, draft with confirm
14. S9 Settings with delete confirm sheet
15. S10 No-voice fallback on the cards screen
16. App icon: speech bubble wrapping a folded page, teal on warm off-white; no medical symbols

## 9. Open decisions for the designer

- Whether the warning card uses an illustration or stays typographic (lean typographic)
- Whether spoken text highlights by phrase (depends on the voice provider's timing data)
- Final name (see section 1)
