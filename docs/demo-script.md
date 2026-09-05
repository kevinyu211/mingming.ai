# Demo script and backup video checklist

You present in **English**. The app speaks **Cantonese**. Do not translate 明明 for the judges —
the gap between the language you are explaining in and the language he is speaking in *is* the
product, and they should watch it rather than be told about it.

The pitch window is **5–8 minutes including Q&A**. This script is about five, which leaves room.

**The one number to know cold:** a read takes **30–50 seconds** on the deployed build (5 Sept, Claude Sonnet 5 through the Gateway's Anthropic-compatible path: rendered sheets 27.6 / 36.6 / 38.0 / 43.6 s server-side, the realistic photo 46.3 / 48.0 s end to end). **The first ~30 seconds show nothing at all** — the progress bar has nothing to count while the model thinks — then the text streams in over about ten seconds and every card lands at once. That silence is the model working, not a hang: keep talking, which is what section 1:05 exists for. A question answers in **about 5 seconds** once the app is warm. Never photograph a sheet and then stand in silence.

**The number that will ruin you if you skip the warm-up:** the FIRST request after the app has sat
idle for a few minutes takes **75–80 seconds** — measured four separate times today, and every
request after it was under 6 s. So the warm-up below is not optional.

---

## Before you walk up

- Phone on **`https://mingming.app`**, never the LAN address — the microphone needs a secure origin,
  and only Production carries the cloud transcription settings (a preview URL falls back to iOS
  dictation, which mishears). The first open of the custom domain after idle costs about four
  seconds on the TLS handshake — measured, harmless, and gone by the second tap.
- **Tap 明白，開始 before you are on.** That tap is what unlocks audio on iOS; without it 明明 is
  silent. It also gets the consent gate out of your five minutes.
- **Hold the bar once and grant the microphone before you are on.** The first hold of a session is
  behind the iOS permission sheet, and you cannot keep holding the bar while tapping Allow — so
  that hold is lost by construction, every time, on any phone. Grant it once beforehand and every
  hold on stage opens immediately. (The app now says 「麥克風未開到。撳住耐啲再講一次」 rather than
  「我冇聽到」, but you do not want to spend a beat explaining that.)
- **Warm it up, two minutes before you are called.** Open 用示範紙 on the phone and ask it one
  throwaway question — 「有咩要注意？」 — and wait for the answer. The first request after a few
  idle minutes takes 75–80 s; the one after takes 5. Do this and every question on stage is fast.
  Skip it and your first live question is eighty seconds of silence in front of the judges.
  Then clear the sample sheet.
- 記錄 empty, no active sheet.
- **Ring/silent switch OFF.** Check it. This is the failure that looks exactly like a broken app.
- **MiniMax balance topped up** (platform.minimax.io) the day before, and one spoken line tried on
  the phone. MiniMax is prepaid: at zero balance every line comes back as text with 「而家出唔到聲」,
  which happened on 5 September. If it cannot be topped up, set `TTS_PROVIDER=browser` in the Vercel
  Production environment and redeploy — the phone's own voice, but a voice.
- Volume up, speaker toggle in the chat header ON.
- Printed sheets on the table. Laptop open with the backup video and a QR code to the link.

---

## 0:00 — The gap, in the Hospital Authority's own numbers (45 s)

Hold up the sheet.

> "This is what a Hong Kong family carries out of hospital. The Hospital Authority already prints a
> good version of it — medicines, side effects, warning signs, follow-up date, in Chinese, in large
> type. They built it in 2017.
>
> Their own published study on how it gets delivered found **78% of nurses consistently print it,
> and 57% consistently explain it**. And the workflow states, in as many words, that **teach-back is
> not required**.
>
> So about two families in five walk out holding this with no explanation at all — and nobody
> checks that the ones who got an explanation understood it.
>
> The gap isn't the paper. It's the conversation that was supposed to happen next to it."

*Source if asked: the PDIS implementation study, Implementation Science Communications. It's in
`docs/real-sheet-evidence.md`.*

---

## 0:45 — Photograph it (20 s)

Tap **拍張紙**, shoot the sheet, tap **講俾我聽**.

Point at the line under the thumbnails as you go:

> "張紙留在你電話。你唔send，冇人睇到 — it stays on the phone."

---

## 1:05 — Talk over the read (up to 60 s: the dead-air slot)

Cut this short the moment 明明 starts talking. He is the demo; this is filler.

> "Two things here are the model, and only two: reading a page of clinical abbreviations, and
> writing the sentence a daughter would say to her mother in Cantonese.
>
> Everything that decides *what you are told* is code. The order the pieces come in. The words that
> can never be spoken. Whether a question gets refused. Whether a number is allowed on screen at
> all. Take the model away and you have a rulebook with nothing to read."

*Spare material if it runs long:* the six-page ceiling and why a medical document must never be
silently truncated · nothing stored off the phone, one button wipes it · the withdrawn-medicine bug
we found in a stress fixture and made impossible by construction.

---

## 2:05 — He starts talking, and then he stops (75 s)

明明 opens with what is on the page — how many things to watch for, how many medicines, one visit —
and asks where to start. **Say 「一樣一樣講」 out loud, into the phone.**

> "He tells her what's on it before he reads any of it, and then he hands over. Someone who came to
> this worried about one specific thing can just say so."

The red flags arrive as one amber block and read themselves.

> "Warning signs first. Always. That's not a prompt asking nicely — it's a rule in the code, and no
> model output can reorder it or push it down the screen."

He ends that bubble with 明唔明？ and **waits**.

> "**This is the teach-back the hospital workflow explicitly does not require.** He will not move on
> until she answers."

Say **「明白」**. The medicines come one at a time, numbered.

> "One medicine per turn. Name, strength, and the instruction exactly as printed — not paraphrased."

Tap **睇張紙點寫** on one.

> "Every sentence traces to a line on the page, and she can see the line."

---

## 3:20 — Ask it three things (70 s)

**Hold the bar and ask in Cantonese: 「白色嗰粒係朝早定夜晚食？」** → 張紙冇講呢樣

> "The sheet records names, strengths and frequencies. It never records what colour a pill is. So he
> doesn't guess. **That refusal is worth more than a right answer.**"

**Hold and ask: 「空腹係咩意思？」** → he explains it, labelled 「呢個唔係你張紙寫嘅，係一般嘅意思」

> "But he isn't useless either. That's a definition — it means the same for everybody, and refusing
> it would fail the literacy question this whole track is about. The guardrail is **action, not
> knowledge**: he'll tell you what a word means, he will not tell you what to do."

**Type 「可唔可以唔食？」** → refused

> "Anything about changing, skipping or adding a medicine is refused **before the model is called at
> all**. Same for crisis phrases — those get a referral, not an answer. Zero-second responses,
> because nothing leaves the phone."

*If a judge asks why the voice isn't a realtime speech-to-speech model:* "Because you can't put a
guardrail on audio. Every sentence he says is text first, checked against a banned-term list and
the card it cites, and only then spoken. We stream the one language she's listening to the moment
it's written, so it feels live — but it never skips the check."

*Numbers if pressed: 20 of 20 outcomes correct on the last live eval, zero banned terms.*

---

## 4:30 — 跟進, and the line we don't cross (40 s)

Tap **跟進**.

> "The appointment shows days remaining **only because that date was printed**. If the sheet said
> 'about two weeks', it would show those words and no countdown."

Point at a dose card.

> "張紙寫：BD with meals — verbatim. And the counter says 今日仲有 2 次. Times remaining today.
>
> **It will never say 8am.** The sheet prints a frequency, not a clock. The moment this app invents
> a time of day it stops describing a document and starts prescribing. There's a rule that refuses
> to count anything it can't read as a number of times, and a test that sweeps this screen for
> anything resembling a time."

Tap **分享俾屋企人** at the bottom. The share sheet opens with the warning signs, the medicines and
the visit as plain text.

> "One tap and the daughter in Toronto has the same sheet. Built on the phone from the same checked
> sentences — no name, nothing we invented."

If a stopped medicine is on the sheet, point at it:

> "The page says this one was stopped. It's shown — the family needs to know the drug is named — but
> no counter and no 食咗 button. That bug was real: we caught the reader scheduling a drug the
> hospital had withdrawn."

---

## 5:10 — Close (25 s)

> "Nothing is stored anywhere but the phone. The photo is dropped after it's read. One button wipes
> everything.
>
> And every sheet we've tested is one we wrote ourselves. We've never fed it a real discharge
> summary, and I'm not going to stand here and claim otherwise."

---

## Rehearsed answers

**"Isn't this medical advice?"** It restates what the page says and cites the line. Anything about
changing a medicine is refused before the model is called. It defers to the pharmacist and the
number printed on the sheet. It never collects a diagnosis.

**"You just said it explains things — where's the line?"** Action, not knowledge. "What does fasting
mean" is a definition and the same for everyone. "Should I fast before Tuesday" is their plan, and
that either comes off the page with a citation or is refused. "Is this normal for me" is a judgement
about them and is always refused.

**"What if it misreads a medicine?"** Fields are verbatim, every card carries its source quote, and
anything it can't read it flags rather than guesses. On four deliberately hard fixtures: zero
invented medicines, zero missing ones, and zero withdrawn drugs reaching the plan.

**"Why not just ChatGPT?"** Three things. It refuses before it answers. It reads warning signs first
by rule, not by luck. And it says it out loud in Cantonese to someone who cannot read the page.

**"Has a clinician validated this?"** No. It has never read a real discharge summary. The *fields*
we extract match the HA's own discharge checklist almost one-to-one, which we arrived at
independently — but reading accuracy is measured on synthetic sheets only.

**"What's next?"** One real sheet from a consenting family, then the medicine box checked against
the sheet's own list. Not more features.

---

## If something breaks on stage

| Fails | Do |
| --- | --- |
| Camera | 上載相片, pick the sheet from the photo library — same flow from the review grid on |
| Network mid-read | 用示範紙 — bundled, needs nothing, reaches the same conversation |
| Microphone | Tap the bar and type. Say you're typing for time; the rules explicitly allow finishing the same user story on the text path |
| Voice silent | **Check the ring/silent switch first.** Then say so and keep going — the text types out regardless, which is the designed fallback |
| Phone entirely | Backup video on the laptop, and finish the talk over it. A failed demo may be retried once |

---

## Backup video — required, ≤3 minutes

The rule is explicit: **at least one continuous real-operation segment**, no montage faking a single
run. Slides or click-throughs with fake data do not count as complete.

- Record at the venue, on venue wifi, the night before. That is the network it has to survive.
- Cover: 記錄 → 拍張紙 → review → 講俾我聽 → the amber block reading itself → 明白 → one medicine →
  a source quote → one spoken question → one refusal → 跟進 with the counter.
- **Leave the read in.** Speed it up with a visible time indicator if you must; cutting it invites
  the question of what else was cut.
- Say at the start that the sheet is synthetic.
- Load it on both the laptop and the phone.
