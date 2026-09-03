# Demo script (5 minutes) and backup video checklist

## Setup before you walk up

- Phone on the hotspot or venue Wi-Fi, app open at `/` with consent already tapped once so the
  gate is one tap.
- The printed Hong Kong English sheet (`fixtures/sheets/hk_en.png`) on the table; the mainland sheet
  in the bag.
- Volume up. Cantonese voice confirmed working that morning (Settings → play a card).
- Laptop with `next start` and the QR code as the fallback link; sample-sheet path as the last resort.

## 0:00 Hook (30 s)

Hold up the sheet. "This is what a family gets when they leave a Hong Kong hospital. One page. In
English. My persona's mother is 72 and reads only Chinese. Her daughter reads English slowly, and is
holding this in a taxi. Everything she needs to do for the next two weeks is on here, and neither of
them can read it."

## 0:30 Live read (90 s)

Tap the language tile (廣東話), photograph the sheet, tap 開始讀. While the progress line runs: "It
reads the page into a fixed structure. The first thing it will say is the warning signs, always."

Tap 讀出嚟. Let the Cantonese warning card play in full. Then scroll: "Three medicines, exactly as
printed. Name, strength, how much, how often. Nothing added." Tap 睇張紙點寫 on a medicine card:
"Every card shows the line it came from, verbatim. If it can't read a part, it says so instead of
guessing." Play the follow-up card.

## 2:00 Ask it (60 s)

Tap 問問題. Hold the mic and ask in Mandarin: 「二甲双胍要随餐吃吗？」 Play the Cantonese answer; point
at the cited-card chip and the source quote. "You ask in your language, she hears it in hers. The
answer has to cite one card the server built, or it says the sheet doesn't say."

Then ask the question that shows the honesty, in Cantonese: 「白色嗰粒係朝早定夜晚食？」 It answers
「張紙冇講呢樣」. "The sheet records names, strengths and frequencies. It never records what colour
the pill is. So it doesn't guess."

Type 「可唔可以唔食？」. "Anything about changing, skipping or adding a medicine is refused before the
model is even called, and it points to the pharmacist or the number on the sheet."

Measured on the synthetic sheets with Claude Opus 5: answers land in about 3 seconds, 6 at the
95th percentile. Do not promise a number you have not re-measured on the venue network.

## 3:00 What the AI is, and isn't (45 s)

"Two jobs are the model: reading a page of abbreviations, and writing what a daughter would say to
her mother in Cantonese. Everything that decides what you're told is code: the card order, the
banned-word filter, the refusal, the grounding check, the plan dates. Remove the model and you have a
rulebook with nothing to read. And yes, with a perfect prompt a frontier model gets close on the
reasoning. Nobody writes that prompt, nobody has this pipeline, and it still has to be said out loud
in Cantonese at a kitchen table."

## 3:45 Compliance in one breath (30 s)

"Facts about the page, never verdicts about the person. No diagnosis is ever collected. Every
generated word passes a banned-term filter. Disclaimer on every screen, AI label on every card.
Synthetic sheets only. Nothing stored anywhere but the phone; the image is dropped after reading.
Crisis phrases get a referral card, not an answer."

## 4:15 Where it goes (30 s)

"Next document types are the lab report and the medicine box, same engine. Next users are the parent
alone, by voice, and the relative who cooks, by a shared card. Hospitals hand out this checklist
because families leave without knowing these things; this makes the sheet say them out loud."

## 4:45 Buffer for questions

Rehearsed answers: "Isn't this medical advice?" (it restates the sheet; refuses changes; defers to the
pharmacist). "What if it misreads a medicine?" (verbatim fields, source quote on every card, unread
regions flagged, eval on three fixtures with zero invented items as the pass line). "Why not ChatGPT?"
(the three-question answer above).

## Backup video (≤ 3 minutes, one continuous real run)

- Screen-record the phone: consent → language → photograph the printed sheet → cards → play the
  warning card → source quote → ask by voice → refusal by text. No cuts inside the run.
- Record with the actual voice provider chosen by the listening test; keep the browser-voice take as
  a second file.
- Keep the file under 3 minutes; state at the start that the sheet is synthetic.
- Load it on the laptop and the phone; judges watch it alongside the live demo.
