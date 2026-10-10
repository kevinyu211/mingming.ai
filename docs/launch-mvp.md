# Launch MVP · Ming Ming 明明

The cut Steven locked for launch. Do not widen it.

Live: https://mingming.app · Repo: https://github.com/kevinyu211/mingming.ai

## What this is

A **sheet companion** for a Hong Kong carer (or patient) holding a real discharge or clinic
sheet on a phone. The pain is the HA print-out: the family cannot turn it into next steps.
Ming Ming is for **understanding**, not dosing.

Photograph the sheet → hear it in 粵 / 中 / 英 → teach-back (明白) → hard refusal on start/stop
and 「可唔可以唔食？」 → clear follow-ups on 跟進.

## Soft Healthcare boundary (do not cross)

| Does | Does not |
| --- | --- |
| Read the photographed sheet | Sync to eHealth |
| Speak the page in 粵 / 中 / 英 | Send anyone to A&E on its own advice |
| Explain what a printed word means, labelled as general | Diagnose, or say what is wrong with the person |
| Refuse start / stop / skip / change of a medicine | Give dose advice or invent clock times |
| Count remaining *times today* from a printed frequency | Replace a nurse explaining the sheet |
| Store the profile and the extracted text on the phone | Claim clinical accuracy |

Constitution: `.specify/memory/constitution.md`. Facts about the page, never verdicts about the
person. Warning signs first. The model reads and phrases; rules decide. Every claim about this
sheet traces to a printed line. Banned terms are enforced.

## The four launch items

### 1. On-phone sheet photo → 記錄 (English + 繁中)

- **拍張紙** / **上載相片** on 記錄 → `/capture` → 講俾我聽 → `/chat` reads → one active sheet
  in 記錄. A second photograph archives the first (`只可以睇`).
- **English demo path:** empty 記錄 → 英文示範紙 → `/chat?sample=demo_en` (Harbour View
  Hospital, synthetic). No camera, no model.
- **繁中 demo path:** empty 記錄 → 繁中示範紙 → `/chat?sample=demo_zh_hant` (港灣醫院,
  synthetic). Same.
- Older fixtures (`hk_en`, `cn_zh`, `cn_zh_photo`) still load via `?sample=` and the 502
  fallback.

### 2. Read-aloud + teach-back that sticks (明白)

明明 speaks the sheet, warning signs first. After every section he **waits**. 明白 and 再講一次
are on screen so the wait is a tap, not only a spoken word. Saying 「明白」 into the bar still
works. 跟進's recap counts both.

### 3. Hard refusals + Settings honesty

- 「可唔可以唔食？」「我可唔可以唔食抗生素？」「can I skip this medicine?」 are refused on the
  phone. No model call. The reply points at the pharmacist / the printed contact line.
- Settings opens with **老實講**: this is not a nurse explaining the sheet, and it does not
  claim the reading is accurate. Then the data statement names the vendors and that the page,
  the question and the voice leave Hong Kong (Anthropic via Vercel AI Gateway, MiniMax,
  OpenAI). Capture and the empty 記錄 footer say the same: the page is sent outside Hong Kong
  to be read, then discarded. They never say the photograph “stays on the phone”.

### 4. One happy path under three minutes

On a phone at https://mingming.app (or `npm run dev` with the bundled samples):

1. Tap **明白，開始** (unlocks audio; consent is honest).
2. On 記錄, tap **英文示範紙** (or photograph `fixtures/demo/demo_en.png`).
3. Hear the greeting. Tap **明白**. Hear the warning signs.
4. Tap **明白** again, or hold the bar and ask **「可唔可以唔食抗生素？」** — instant refusal.
5. Open **跟進**: appointment, dose counts (times, never clock times), warning signs.
6. Open **設定**: 老實講 + 你啲資料去咗邊 (vendors, 香港以外).

The Traditional Chinese path is the same from **繁中示範紙**.

Without an API key the photo path offers the bundled sample; the two demo links never need a
key.

## What was deliberately not added

eHealth sync, A&E routing, diagnosis, dose advice, clock-time schedules, a second product
surface. Prefer hardening this path over rewriting the app.

## How to verify

```bash
npm test
npm run typecheck
npm run lint
npm run e2e
# the stitched 3-minute walk only:
npx playwright test tests/e2e/launch-mvp.spec.ts
```

Browser checks that matter for this cut:

- Empty 記錄 shows 英文示範紙 and 繁中示範紙, and the footer names 香港以外.
- Each demo link opens 傾偈, waits, and shows 明白 / 再講一次.
- 「可唔可以唔食？」 never leaves the phone (no `/api/ask`).
- Settings states the nurse / accuracy limit and names the three vendors.
- Photographing `fixtures/sheets/hk_en.png` (mocked or live) still becomes the one active sheet.
