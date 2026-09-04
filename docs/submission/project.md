# 聽得明 · Discharge Sheet Agent — Project Description

**Track**: Vital (Soft Healthcare), AIx Origin Summit. **Direction**: A, 健康信息赋能与可及性.
**Team**: Kevin Yue (solo; product/demo lead and compliance lead).

## The problem

The Hospital Authority already prints a good discharge form. The problem is what happens when it is
handed over.

Since 2017 the HA has run a **post-discharge information summary (PDIS)**: an EHR-generated sheet
that prints about 80% of the discharge medications together with 235 side-effect and **warning
signal** items adapted to local older adults, plus follow-up appointment information, translated
into Chinese and set in a larger font. The published implementation study of it
([Kwok et al., *Implementation Science Communications*, PMC12046763](https://pmc.ncbi.nlm.nih.gov/articles/PMC12046763/))
reports two numbers that describe the whole product:

- only **78% of nurses consistently print** the form, and
- only **57% consistently explain** its content.

The same study describes the workflow as "print the written PDIS form and explain the content" and
states plainly: **"Teach-back is not required."**

So roughly two in five patients get the paper with no explanation at all, and none of them are
checked for understanding. The study also names *lack of English versions* among the barriers — and
Cantonese, the language most of these patients actually think in, is not a written form at all.

It is also not one page. The Hong Kong West Cluster's own patient-facing
[出院清單 / Discharge Checklist (June 2022)](https://www8.ha.org.hk/QMH/patient_and_visitor/inpatient_information/docs/discharge_checklist.pdf)
tells the patient to leave carrying 出院紙, 覆診紙, 繳費單, 病假紙, 抽血紙 and 治療處方. The
follow-up date is on a different sheet from the medicines, which is on a different sheet from the
blood test. A tool that reads one page reads a third of the discharge.

Full working notes and the source copies are in `docs/real-sheet-evidence.md` and `docs/reference/`.

## Target user

A patient in their sixties or seventies walking out of a Hong Kong public hospital with that stack
of paper, and often the adult child holding it for them.

There is **one flow and no modes**. Big type, one thing per screen, voice throughout, nothing to
configure — so a 72-year-old can do it alone, and a daughter doing it for her mother never notices
it was built for the mother.

## What it does

Three tabs, one conversation, **one active sheet at a time**.

**記錄** — photograph or upload the sheet. Capture takes **up to six pages**, and at the seventh it
says so out loud in the picker, on the thumbnails and in the camera hint rather than truncating
(`components/Capture.tsx`, `admitPages`). A truncated medical document is a missing medicine. Below
the buttons: the in-app check-in, the sheet currently being talked about, and 以前嘅 — earlier
sheets, read-only, marked 只可以睇.

**傾偈** — the product. The sheet does not arrive as a stack of cards. It arrives as messages from
明明, who types himself out clause by clause and speaks at the same time. **There is no play button
anywhere**: the 讀住 waveform is a status indicator, and the speaker toggle in the header is the
only voice control.

- The **warning signs come first**, always. The amber block renders and reads itself before
  anything else, by a fixed array in `lib/rules/card-order.ts`. No model turn can reorder it. If
  the sheet prints none, a rule-written card says so and shows the hospital contact line.
- After each piece 明明 stops and asks **明唔明？** with 再講一次 / 明白. That is teach-back — the
  step the HA's own documented workflow does not require — applied one piece at a time.
- Questions go in the same thread through **one bar: hold to talk, tap to type**. Answers are
  grounded in one card and cite it. Questions the sheet does not answer get "the sheet doesn't
  say". Questions about skipping, stopping, doubling or re-timing a medicine are refused before any
  network call and routed to the pharmacist or the number printed on the sheet.
- Every message a fact came from opens the verbatim line it stands on. Regions the reader could not
  resolve come back as "I couldn't read this part", never as a guess.

**跟進** — this sheet's follow-up and nothing else: its appointment, its medicines, its warning
signs. Dose counters count **times remaining today** and quote the sheet's printed frequency
verbatim behind 「張紙寫：」. They never show a clock time — the page prints a frequency, and turning
「每日兩次，隨餐」 into "8am / 8pm" would be prescribing. A clause the rules cannot parse gets the
printed words and no counter at all. A medicine the page says has been **stopped** is shown, marked
as ended, and never counted, never scheduled, never given a 食咗 button. The appointment shows a
date and a countdown only when `lib/rules/plan-from-reading.ts` parsed an unambiguous one;
otherwise it shows the printed words and counts nothing.

**There are no push notifications.** The check-in is an in-app message on 記錄, and no copy anywhere
implies the phone will go off by itself.

Photographing a new sheet makes it active and archives the previous one read-only with its counters
frozen. That is what keeps 「張紙寫：每日兩次」 honest: a counter can only ever quote one piece of
paper.

## Where the AI carries the load

Two jobs, both language problems: turning a photographed page of abbreviations into structured,
verbatim fields, and saying what a daughter would say to her mother in colloquial Cantonese, plain
Mandarin or plain English. Remove the model and what is left is a rulebook with nothing to read.

Everything that decides what the user is told is deterministic code: card order, refusals, crisis
detection, the banned-term filter, the diet-line recogniser, dose counting, plan dates, and the
grounding check against server-built card ids. `model-vs-rules.md` lists every output and its
source, module by module.

## Convergent evidence for the schema

The HKWC checklist's own list of what a patient must understand after discharge maps almost
one-to-one onto the fields we extract:

| HA checklist item | Our field |
| --- | --- |
| 藥物種類及服用量 · Types of medicines & dosage | `medicines` |
| 病情變化徵狀 · Signals of condition change | `warningSigns` |
| 醫院聯絡方法 · Contact information of hospital | `hospitalContact` |
| 覆診安排 · Follow-up arrangement | `followUp` |
| 飲食禁忌 · Foods to avoid | `dietLine` |
| 活動 / 運動建議 · Advice on activities / sports | `activityLine` |
| 護理技巧 · Post-discharge care | **not extracted, deliberately** |

We arrived at those six from format research and the constitution's "warning signs first" rule; the
HA arrived at them from clinical practice. 護理技巧 is left out on purpose: it is procedural
instruction, and reading it aloud edges toward telling someone how to perform care rather than
telling them what the page says.

That is third-party support for **what the app looks for**. It is not evidence about how accurately
it reads. See the limits below.

## Tech stack

Next.js 16.3 (App Router) on Node.js; TypeScript; Zod 4 schemas shared by the model's structured
output and the client; Claude Opus 5 (`claude-opus-5`, reasoning effort `medium`) through the
official Anthropic SDK for reading, answering and rephrasing; Tailwind CSS 4; MiniMax `speech-02-hd`
text-to-speech behind a provider adapter (ElevenLabs and Azure adapters also written; the phone's
own `speechSynthesis` is the fallback and the default when no provider is configured); speech input
through the browser's own recognition with a typed fallback; on-device browser storage only, one
key, no accounts, no server database. Vitest (1060 unit tests in 35 files) and Playwright (5 spec
files, 46 tests, run on two phone profiles for 92 in total). Deployment target Vercel.

## Team roles

Solo entry. Product and demo lead: Kevin Yue. Compliance lead: Kevin Yue. Engineering was done with
AI-assisted development (Claude Code with subagents implementing tasks against a written
constitution, plus a reviewer pass); the constitution, spec, plan, build brief and review log are in
the repository.

## Status and honest limits

**The app has never read a real discharge summary.** Every sheet it has been tested on — the three
clean fixtures in `fixtures/sheets/` and the four hard ones in `fixtures/stress/` — was written by
us, rendered from our own HTML, and scored against an answer key taken from that HTML. The schema
now has third-party support (the table above). The **reading accuracy has none**. Nothing in this
submission should be read as a validation claim, a clinical claim, or an accuracy figure on real
paper.

What has been measured, on synthetic fixtures only:

- **Reading, three clean single-page fixtures** (`tests/eval/results.md`, 2026-09-03, live model
  through `/api/read`): medicines 100% verbatim, zero invented, zero missing, zero banned terms
  after filtering, 25–29 s from post to the finished reading.
- **Reading, four deliberately hard fixtures** — two-column 12.5px type, the same page rotated,
  blurred and with a thumb over two cells, ink over print, and a bilingual page with a lab table and
  a "do not take" block (`tests/eval/stress.md`, 3 runs each through `/api/read` after four prompt
  and schema fixes): every printed medicine field verbatim on three of the four sheets;
  **`messy` fails at 0%** on a single blurred comma read as a semicolon. Zero medicines invented or
  missed. One caveat the eval file states and this pack repeats rather than hides: `mixed` was not
  re-run against the very last prompt revision — the API credit balance ran out mid-pass — so its
  row is the immediately preceding pass, whose prompt differs only in a clause that touches no
  medicine field. All 31 entries from the four pages' "do not take" blocks came back marked non-current and
  **none of them reached the plan**. Both thumb-covered cells came back null with the field named,
  in every run. Latency p50 44.5–102.1 s, p95 up to 111.4 s — the app emits cards only after the
  whole reading validates, so that is also time to the first spoken word, and it misses the 30 s
  target on every hard sheet.
- **Questions** (`tests/eval/results.md`, 2026-09-03): 12 of 12 outcomes correct across Cantonese,
  Mandarin and English — answered with the right citation, "not on the sheet", medicine-change
  refusal, crisis referral — p50 3.3 s, p95 5.8 s, zero banned terms. The refusal and crisis cases
  answer in 0.0 s because they never reach the network.
- **The banned-term filter earns its place.** Raw model output tripped it 13 times (Opus) and 17
  times (Sonnet) across 24 direct runs, mostly 治療 out of "physiotherapy". After filtering, 0 hits
  in 20 API runs.

Not measured, and not claimed:

- Anything on a real discharge sheet. The realistic routes to one are listed in
  `docs/real-sheet-evidence.md` §5.
- The blind voice listening test (`tests/eval/voices.md` still ends "PICK: not decided"). MiniMax
  renders Cantonese, Mandarin and English at about 2 s a sentence; whether the Cantonese voice
  sounds like a daughter rather than a newsreader has not been judged by native listeners.
- On-device behaviour: real camera, real playback, and speech input on iOS Safari. Both Playwright
  profiles run on Chrome; the "iPhone" profile is an iPhone 14 viewport and user agent, not WebKit.
- The venue network. Every latency figure above is a home connection.

Known gaps in the reading, all documented in `tests/eval/stress.md`: a blurred comma still lands as
a semicolon; on `handwritten`, `followUp[1].clinic` returns the ward rather than the department in
every run; and the reader is now willing to withhold a blurred value it might have read correctly,
which costs recall to avoid a wrong appointment date.

Two sheet formats are supported (Hong Kong English, mainland 出院记录). Cantonese, Mandarin and
English output; other dialects are roadmap. The dish check, share card, medicine-box reader and lab
reports are designed and deliberately not built for the sprint.
