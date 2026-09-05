# Demo script · Vital track pitch

Rewritten 2026-09-05 for the merged build (main 5ea133e and later). Structure and tone follow the
YC pitch-coaching doctrine (Michael Seibel): say what it is in two sentences and one concrete
example, put the problem inside the example, order the middle by what is most impressive, talk
less than feels right, and end with an ask. The demo section is a click-list, not lines: you know
what to say once you know what to point at.

You present in **English**. The app speaks **Cantonese**. Do not translate 明明 for the judges: the
gap between the language you explain in and the language he answers in *is* the product.

**The rubric decides the shape.** Innovation and UX 30, problem definition 20, prototype
completeness 20, viability 20, compliance 10. Gates before scoring: runnability, the disclaimer,
the data statement. Veto: a diagnosis claim, a real record, a faked demo. Pitch window 5 to 8
minutes **including Q&A**, and the rules say the pitch "is not slide-focused". So: about 4½ minutes
of talking, the phone on screen for most of it, slides as a backdrop, the rest for questions.

---

## Numbers to know cold

| | |
| --- | --- |
| A one-page read on production | 30 to 50 s; the first ~30 s are silent while the model thinks |
| A two-page read | about 3 minutes. **Demo with one page.** |
| A question, warm | 4 to 7 s; the first sentence is spoken before the rest is written |
| First request after a few idle minutes | 75 to 80 s. **The warm-up is not optional.** |
| Live eval, current build | 20 of 20 outcomes on the 1.2.0 rubric, zero banned terms, both dialects |

---

## Before you walk up

- Phone on **https://mingming.app**, never a preview URL: only production has the microphone
  and cloud transcription settings.
- **Tap 明白，開始 before you are on.** That tap unlocks audio on iOS and clears the consent gate.
- **Hold the bar once and grant the microphone before you are on.** The first hold of a session is
  lost to the iOS permission sheet, every time.
- **Warm it up two minutes before you are called**: open 用示範紙, ask one throwaway question, wait
  for the answer, then clear the sample sheet. Skip this and your first live question is 80
  seconds of silence.
- 記錄 empty, no active sheet. Ring/silent switch OFF. Volume up, speaker toggle ON.
- MiniMax balance topped up the day before and one spoken line tried. At zero balance every line
  arrives as text. Emergency switch: `TTS_PROVIDER=browser` in Vercel Production, redeploy.
- **One** printed synthetic sheet on the table (the English appendicectomy sheet reads fastest).
  Laptop open with the backup video and the QR slide.

---

## 0:00 · What it is, and one person (40 s) — slide 1, then slide 2

Say what it is in two sentences. Then the example. The problem lives inside the example.

- **Two sentences.** 明明 is a phone app that reads a hospital discharge sheet out loud, in
  Cantonese, and answers questions about it. It is for the patient who cannot read the paper, and
  for the daughter who is holding it.
- **The person.** A woman in her seventies leaves a Hong Kong public hospital with a stack of
  sheets: medicines, warning signs, a follow-up date, a blood test. The nurse printed them.
  Nobody explained them. She thinks in Cantonese, which is not a written language.
- **The numbers, from the Hospital Authority's own study** (slide 2): 78% of nurses consistently
  print the sheet, 57% consistently explain it, and the workflow states "teach-back is not
  required". Two families in five walk out with the paper and no conversation. None are checked
  for understanding.
- **The sentence to land:** the paper exists; the conversation doesn't.

Do not say "platform", "AI-powered", "revolutionise". Do not tell your own story. If a judge
already looks lost here, stop and give a second example rather than pushing on.

---

## 0:40 · What we chose, and why this narrow (30 s) — slide 3

- **Track and direction.** Vital, direction A: health information, understood. Not diagnosis,
  not treatment, not a clinician, and we never say those words.
- **The scenario.** The walk out of the hospital: the sheet read to her, warning signs first,
  in her language, then the questions she was too tired to ask on the ward.
- **Why narrow.** The HA's own discharge checklist lists what a patient must understand after
  discharge: medicines, warning signs, follow-up, diet, activity, the hospital number. Those are
  exactly the six things we read. We didn't invent the scope; the hospital did.
- **The line.** He describes a piece of paper. He never assesses a person. Say this once here,
  and let the demo prove it.

---

## 1:10 · Photograph it, and talk over the read (up to 60 s) — slide 4

Tap **拍張紙**, shoot the sheet, tap **講俾我聽**. Point at the line under the thumbnails:
「張紙留在你電話。你唔send，冇人睇到」— it stays on the phone.

This is the dead-air slot. The model is thinking for about 30 seconds and the screen shows
nothing. Never stand in silence. Use slide 5 and say the model-versus-code point:

- Two things are the model: reading a page of clinical abbreviations into fields, copied
  character for character, and writing the sentence a daughter would say to her mother.
- Everything that decides what she is told is code: the order (warning signs first, always), the
  words that can never be spoken, whether a question is refused, whether a number is allowed on
  screen. Take the model away and you have a rulebook with nothing to read.

Cut this the moment 明明 starts talking. He is the demo; you are filler.

---

## 2:10 · The demo (about 100 s, phone on screen) — slide 7 behind you

What to do, in order. Say one sentence per step, no more. If a step misbehaves, use the line in
the last column and move on; never diagnose live.

| # | Do | Point at / meaning | If it breaks |
| --- | --- | --- | --- |
| 1 | Let him open. He says what is on the page and asks where to start. **Say 「藥」 into the phone.** | He tells her what's on it before reading any of it, and she chose where to go. The warning signs still come first: nothing moves them. | If the mic misses it, type 藥. |
| 2 | The amber block reads itself. | "Warning signs first. That's a rule in the code, not a prompt asking nicely." | — |
| 3 | He ends with a question and **waits**. Say 「明白」. | "This is the teach-back the hospital's workflow says is not required. He will not move on until she answers." | If he doesn't stop, hold the bar and ask a question; the floor is hers either way. |
| 4 | The medicines come, two at a time, then a different check-in. Say 「清楚」. | "One medicine at a time, name and instruction exactly as printed. And he never asks the same way twice." | — |
| 5 | Tap **睇張紙點寫** on one medicine. | "Every sentence opens the printed line it stands on." | — |
| 6 | Ask in Cantonese: 「白色嗰粒係朝早定夜晚食？」 | Comes back 「張紙冇講呢樣」. "The sheet never records a colour, so he doesn't guess. That refusal is worth more than a right answer." | If it answers anything else, say so plainly and move on; this beat is fixed by rule and has never failed. |
| 7 | Ask: 「空腹係咩意思？」 | Explained, labelled 「呢個唔係你張紙寫嘅，係一般嘅意思」. "A definition is the same for everyone. Action, not knowledge, is the line." | — |
| 8 | Ask: 「而家頭暈係咪正常？」 | Comes back as a boundary: one sentence handing it to the doctor, then the page's own warning signs, cited. "He won't judge her. He tells her who can, and reads her what the page says to watch for." | If it lands as 「張紙冇講呢樣」 instead, that is also correct; say the same sentence. |
| 9 | Type 「可唔可以唔食？」 | Refused in under a second. "Anything about changing a medicine is refused before the model is called at all. Same for crisis phrases: a referral, not an answer." | — |
| 10 | Tap **跟進**. Let him say his one line (「今日仲有 N 次。N 日之後覆診。食咗就撳一下。」) before you speak. | "Times remaining today, quoting the printed frequency. It will never say 8am: the page prints a frequency, not a clock." | If he says nothing, the counter still shows it; say the same sentence. |
| 11 | Point at 我哋講咗嘅, the recap card under the appointment. Then 分享俾屋企人. | "How far we got, how many times she said 明白, what she asked: the teach-back the hospital workflow doesn't require, on the record. One tap and the daughter in Toronto has the same checked text." | — |

Three things to remember about the demo itself:

- **Slow is right.** Let him finish a bubble before you speak. The pauses are the product.
- **Don't talk and drive.** Tap, then look up and say the sentence. Never both.
- **Never go silent** during a read or an answer; there is always a slide to point at.

**If the read fails** (502, or nothing after 90 s): say "the model isn't reachable from this room,
so here is the same flow from an hour ago", tap 用示範紙 (the bundled sheet exercises every screen
without a model call) or play the backup video from the laptop. Do not restart. Do not apologise
twice.

| What fails | Do | Say |
| --- | --- | --- |
| Camera | 上載相片 with the photo already in the camera roll | nothing; it's one tap |
| Network or the model | 用示範紙 | "same flow, bundled sheet, no model call" |
| Microphone | tap the bar and type | "she can type; a lot of daughters do" |
| Voice silent | check the ring/silent switch first, then the speaker toggle | nothing |
| Phone dead | the backup video on the laptop | "recorded on this phone an hour ago, one continuous run" |

The backup video in `docs/backup-video/` shows the previous look of the app. Re-record on the
phone with sound before you go if there is time; the script for the recording is the click-list
above, steps 1 to 11.

---

## 3:50 · What broke this week, and what we did (40 s) — slide 6

Pick **three** of the six; keep the rest for Q&A. Order by what will impress this panel most.
Each is one sentence of problem, one of fix.

1. **It paraphrased a medicine line** ("Breathless at rest" came back "Breathlessness at rest").
   Now every field is verbatim, and a card whose name and strength aren't in its own quoted line
   is marked "check this against the paper", never dropped.
2. **A withdrawn drug got scheduled.** Now a medicine's status comes from the page's own
   headings, and a stopped medicine is shown as stopped and never counted.
3. **It sounded like a form.** A greeting, a sum and "is this normal?" all got "the sheet doesn't
   say". Now there are five kinds of reply: a judgement about her goes to the doctor in one
   sentence, then the page; the check-in rotates; the whole conversation travels with every question.
4. **The safety filter hid a printed warning** ("blood sugar below 4.0 mmol/L" became "look at
   the sheet"). Now a number the page prints on the cited line passes; every other number is still
   blocked.
5. **Thirty seconds of silence** while it reads. Now he says he's reading, and an answer is spoken
   the moment its first sentence is written, through the same checks, while the other languages
   finish behind it.
6. **"Twice a day" became "8am"** in the design mock-up. Now counters count times a day, quote the
   printed clause, and a test sweeps every screen for anything shaped like a clock time.

Say the numbers once, at the end: 1,370 unit tests, 122 browser tests, 20 of 20 on the live
question set in both dialects, zero banned terms. Built alone in the 72 plus 48 hours.

---

## 4:30 · Where we stop, and the ask (25 s) — slide 8

- Nothing leaves the phone but the request. The photo is dropped after it is read. One button
  wipes everything.
- Every sheet we have ever tested, we wrote ourselves. He has never read a real discharge summary,
  and I'm not going to stand here and claim otherwise.
- **The ask.** One real sheet, from one consenting family, read on their phone with a nurse in the
  room. If anyone here can put us next to that family, that is the next thing we build.
- Then stop. Point at the QR. Let them ask.

---

## Rehearsed answers (Q&A ammunition, not script)

**"Isn't this medical advice?"** It restates what the page says and cites the line. Anything about
changing a medicine is refused before the model is called. A judgement about the person is handed
to the doctor and the number printed on the sheet. It never collects a diagnosis.

**"Where's the line between explaining and advising?"** Action, not knowledge. "What does fasting
mean" and "what is this medicine usually for" are the same for everyone and come labelled as
general. "Should I fast on Tuesday" is her plan: it comes off the page with a citation or it is
refused. "Is this normal for me" is a judgement: he says so, hands it to the doctor, and reads
what the page says to watch for. Never a verdict.

**"What if it misreads a medicine?"** Fields are verbatim, every card carries its source quote,
and anything it can't read it flags rather than guesses. On five deliberately hard fixtures,
including a photographed page with a thumb over a cell: zero invented medicines, zero missing
ones, zero withdrawn drugs reaching the counters.

**"Why not just ChatGPT?"** Three things. It refuses before it answers. It reads warning signs
first by rule, not by luck. And it says it out loud in Cantonese to someone who cannot read.

**"Has a clinician validated this?"** No. It has never read a real discharge summary. The fields
it reads are the ones the Hospital Authority's own discharge checklist says a patient must
understand; that is third-party support for what it looks for, not for how accurately it reads.

**"Why not a realtime speech-to-speech model?"** Because you can't put a guardrail on audio. Every
sentence is text first, checked against the banned list and the card it cites, then spoken. We
stream the one language she is listening to the moment it is written, so it feels live, and it
never skips the check.

**"How long did this take?"** 72 hours plus 48, one person. Reads took a week of tuning; the
conversation was rewritten this morning after a live review found it sounded like a form.

**"What's next?"** One real family. Then the rest of the page (wound care, what to bring, the
hotline as its own card). Then the medicine box, checked against the sheet's own list. Not more
features.

**Numbers if pressed.** 20 of 20 outcomes correct on the last live eval against the 1.2.0 rubric
in both dialects, zero banned terms; five of those answers are now a labelled general explanation
or a boundary reply where the old rubric expected a plain refusal.

---

## Backup video checklist

- 3 minutes or less, one continuous real-operation segment, no cuts inside a run (the rules).
- Record on production, warm, one page, with sound: the Cantonese is the point of the video.
- Show: photograph, the opening question, the amber block, one 明白, one medicine, 睇張紙點寫,
  the three questions, 跟進. Nothing else.
- Keep it on the laptop, not in the cloud. Play it only if the read fails twice.

---

## Time budget

| Time | Beat | Slide |
| --- | --- | --- |
| 0:00 | What it is, one person, the HA numbers | 1, 2 |
| 0:40 | What we chose and why narrow | 3 |
| 1:10 | Photograph; talk over the read: model vs code | 4, 5 |
| 2:10 | Demo click-list | 7 |
| 3:50 | What broke, what we did (three of six) | 6 |
| 4:30 | Where we stop; the ask; QR | 8 |
| 4:55 | Stop. Q&A | 7 |
