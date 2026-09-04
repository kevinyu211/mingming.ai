# Demo script (5 minutes) and backup video checklist

Written for the three-tab app (記錄 · 傾偈 · 跟進). Every label below is the one actually on screen.

**The one number to know cold:** on the deployed app a read takes **anywhere from 25 seconds to a
minute**, and the cards all arrive at the end rather than trickling in. Three consecutive reads of
the same page through Vercel measured **24 s, 54 s and 57 s**. Locally it is faster (27–46 s), so do
not rehearse against localhost and expect the venue to match.

Plan for a minute and be pleased when it is twenty-five seconds. Section 1:00 exists to fill that
gap and can be cut short the moment 明仔 starts talking — never photograph a sheet and then stand
in silence.

---

## Setup before you walk up

- Phone on the venue Wi-Fi, **on the deployed HTTPS URL, not the LAN address** — hold-to-talk needs
  a secure origin. Test the mic once that morning.
- Consent tapped once already so the gate does not eat 15 seconds. (It reappears every session by
  design; tap it before you're on.)
- 記錄 empty, no active sheet, so the demo starts from a clean phone.
- The printed English sheet (`fixtures/sheets/hk_en.png`) on the table. Mainland sheet in the bag.
- Volume up, and the speaker toggle in the chat header ON.
- Laptop open with the backup video and the QR code. 用示範紙 is the last resort if the network dies.

---

## 0:00 — The gap, in the Hospital Authority's own numbers (40 s)

Hold up the sheet.

> "This is what a Hong Kong family carries out of hospital. The Hospital Authority already prints a
> good version of it — medicines, side effects, warning signs, follow-up date, in Chinese, in large
> type. They built it in 2017.
>
> Their own published study on how it gets delivered found that **78% of nurses consistently print
> it, and 57% consistently explain it**. And the workflow says, in as many words, **teach-back is
> not required**.
>
> So roughly two families in five walk out holding this with no explanation at all — and nobody
> checks that the ones who got an explanation understood it. That is the gap. Not the paper. The
> conversation that was supposed to happen next to it."

*(Source: `docs/real-sheet-evidence.md`. If a judge asks, it is the PDIS implementation study,
published in Implementation Science Communications.)*

---

## 0:40 — Photograph it (20 s)

Tap **拍張紙**. Shoot the sheet. The review grid appears: **睇下夠唔夠清楚 / 矇嘅可以再拍**.

Point at the line under the thumbnails:

> "張紙留在你電話。你唔send，冇人睇到. It stays on the phone."

Tap **講俾我聽**.

---

## 1:00 — Talk over the read (up to 60 s — the dead-air slot)

The screen says 讀住你張紙… and about a minute. Use it — and if the read finishes early, stop
mid-sentence and let 明仔 talk. He is the demo; this is the filler.

> "Two things here are the model, and only two: reading a page of clinical abbreviations, and
> writing the sentence a daughter would say to her mother in Cantonese.
>
> Everything that decides *what you are told* is code. The order the pieces come in. The words that
> can never be spoken. Whether a question gets refused. Whether a number is allowed on screen at
> all. If you took the model away you would have a rulebook with nothing to read."

---

## 1:30 — 明仔 reads it out (75 s)

He introduces himself, then the amber block appears **and reads itself**. Do not touch anything.

> "Warning signs first. Always. That is not a prompt asking nicely — it is `lib/rules/card-order.ts`,
> and no model output can reorder it or push it down the screen."

When 明唔明？ appears with 再講一次 / 明白:

> "**This is the teach-back the hospital workflow explicitly does not require.** One piece at a
> time, and it will not move on until she says she understood."

Tap **明白**. The medicines arrive. Point at one:

> "Name, strength, and the instruction exactly as printed. Not paraphrased."

Tap **睇張紙點寫** under it — the source sheet opens with the verbatim line.

> "Every sentence he says traces to a line on the page, and you can see the line."

Tap **明白** twice more (follow-up, then diet), and stop at 講完晒.

---

## 2:45 — Ask it (60 s)

**Hold** the bar and ask in Mandarin: 「二甲双胍要随餐吃吗？」 Let the Cantonese answer play.

> "She asks in her language, he answers in hers. Median 3.1 seconds, 5.9 at the 95th — re-measured
> this morning against the live model, twelve questions, every outcome as expected."

Then the question that shows the honesty — hold and ask in Cantonese:
「白色嗰粒係朝早定夜晚食？」 It answers 張紙冇講呢樣.

> "The sheet records names, strengths and frequencies. It never records what colour a pill is. So
> he doesn't guess. That refusal is worth more than a right answer."

**Tap** the bar to switch to the keyboard, type 「可唔可以唔食？」, send.

> "Anything about changing, skipping or adding a medicine is refused **before the model is called at
> all**. Same for crisis phrases — those get a referral, not an answer. Those are `lib/rules/`, not
> a system prompt. In the eval those three refusals come back in **0.0 seconds**, because nothing
> leaves the phone."

---

## 3:45 — 跟進, and the thing that is easy to get wrong (45 s)

Tap **跟進**.

> "The appointment, with the days remaining — **only because that date was printed**. If the sheet
> had said 'about two weeks', it would show those words and no countdown. It never computes a date
> the page didn't give it."

Point at a dose card:

> "張紙寫：BD with meals — verbatim. And the counter says **今日仲有 2 次**. Times remaining today.
>
> It will never say 8am. The sheet prints a frequency, not a clock. The moment this app invents a
> time of day, it stops describing a document and starts prescribing — and that is the line we don't
> cross. There is a rule that refuses to count anything it can't read as a number of times, and a
> test that sweeps this whole screen for anything that looks like a time."

If there is a stopped medicine on the sheet, point at it:

> "The page says this one was stopped. It's shown, because the family needs to know the drug is
> named — but no counter, and no 食咗 button. That bug was real: we caught the reader scheduling a
> drug the hospital had withdrawn."

---

## 4:30 — The loop, and close (30 s)

Tap **記錄**. The check-in is waiting from 明仔, with the unread dot.

> "Later, the same conversation asks 今日食咗藥未 — quoting the sheet's own frequency back. She taps
> 食咗, and the counter moves. That's the whole loop: photograph once, understood repeatedly."

Close:

> "Nothing is stored anywhere but the phone. The photo is dropped after it's read. One button wipes
> everything. And every sheet we've tested is one we wrote ourselves — we have never fed it a real
> discharge summary, and I'm not going to stand here and claim otherwise."

---

## Rehearsed answers

**"Isn't this medical advice?"** It restates what the page says and cites the line. It refuses
anything about changing a medicine before the model is called. It defers to the pharmacist and the
number printed on the sheet. It never collects a diagnosis.

**"What if it misreads a medicine?"** Fields are verbatim, every card carries its source quote, and
anything it can't read it flags rather than guesses. On the four deliberately hard fixtures: **zero
invented medicines and zero missing ones on every run**, three of the four at 100% verbatim on every
field, and the fourth losing one blurred glyph in a printed instruction — which it does not hide.
And after a bug we found and fixed, **zero withdrawn drugs reach the plan**. That last one is the
one I'd want a clinician to check first.

**"Why not just ChatGPT?"** Three things. It refuses before it answers. It reads warning signs first
by rule, not by luck. And it says it out loud in Cantonese to someone who cannot read the page. Ask
a chatbot the pill-colour question and it will answer confidently.

**"Has a clinician validated this?"** No. It has never read a real discharge summary. The *fields* we
extract match the HA's own discharge checklist almost one-to-one, which we arrived at independently
— but the reading accuracy is measured on synthetic sheets only, and that is the honest state of it.

**"What's the business model / next step?"** Next is one real sheet from a consenting family, then
the medicine box against the sheet's own list. Not more features.

---

## Backup video (≤ 3 minutes, one continuous real run)

- Screen-record the phone: 記錄 → 拍張紙 → review → 講俾我聽 → the amber block reading itself → 明白
  through to 講完晒 → a source quote → one spoken question → one refusal → 跟進 with the counter.
- **No cuts inside the run.** The 30-second read stays in, sped up with a visible time indicator if
  needed — cutting it invites the question of what else was cut.
- Say at the start that the sheet is synthetic.
- Record with MiniMax Cantonese, the voice the live demo uses.
- Load it on both the laptop and the phone.

## If something breaks on stage

| Fails | Do |
| --- | --- |
| Camera | 上載相片 and pick the sheet from the photo library — same flow from the review grid on |
| Network mid-read | 用示範紙 — bundled, needs nothing, reaches the same conversation |
| Mic / hold-to-talk | Tap the bar instead of holding, and type the question. Say you're typing for time |
| Voice silent | Say so and keep going — the text types itself out regardless, which is the designed fallback |
| Phone entirely | Backup video on the laptop, and finish the talk over it |
