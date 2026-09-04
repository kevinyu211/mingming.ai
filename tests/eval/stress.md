# Stress reading — four hard sheets

Machine-run by `tests/eval/stress.ts`, judged by hand here. Run on 2026-09-03 against the dev
server on `http://localhost:3011` and, for the model comparison, against the model layer directly.

`tests/eval/reading.md` records 100% verbatim on the three clean fixtures. Those three were written
by us, single-column, typeset and photographed politely. This file asks the question the product
owner actually asked: **what happens on a sheet that is not clean.**

---

## The four sheets

All synthetic — fictional patients, fictional hospitals, no real identifiers. Each was rendered
from HTML by `fixtures/stress/render.ts`, and each has a `*.truth.json` answer key written from
that HTML, never from a model reply.

| Sheet | File | What it stresses |
| --- | --- | --- |
| `dense` | `dense.png` 1240x1754 | Two columns; 12.5px type at 1240px wide, 1.16 leading; a ruled 8-row medicine table with **two strengths of one ingredient** (Furosemide 40mg and 20mg), **three meal-timed lines**, **one taper** ("40mg daily x 3/7 then 20mg daily") and **one PRN**. Plus a "medicines stopped or changed (not to be taken)" block naming 6 more drugs, and a lab-heavy narrative column. |
| `messy` | `messy.jpg` 1100x1500 q55 | The same page photographed badly: rotated 8.2°, 0.75px out of focus, a shadow gradient across the right-hand third (which falls on the warning box), JPEG artefacts, and **a thumb over the right margin covering the Duration cells of rows 6 and 7** — two real values ("x 3/12", "x 10/7") that must come back `null` plus an `unreadable` flag, not a guess. |
| `handwritten` | `handwritten.png` 1240x1754 | A typeset form annotated in ink: the follow-up date and time written into a blank rule, **two printed doses struck through and replaced by hand** (5mg→2.5mg, TDS→BD PRN), and a **deliberately illegible scrawl** filling the "Doctor's remarks" box. |
| `mixed` | `mixed.png` 1240x1754 | Bilingual: English drug names inside Chinese instruction lines, bilingual headings, **a ruled 8-row laboratory table sitting directly above the medicines** (including a "维生素B12 Vitamin B12 148 pmol/L" row that looks like a drug), and a **"停用药物（出院后不再服用）" block**. Both are traps for a reader that hoovers up nearby numbers. |

**Trap markers.** Every `*.truth.json` lists strings that appear ONLY inside a non-instruction block
on that page (`NT-proBNP`, `3820`, `Digoxin`, `Diltiazem`, `1000mg`, …). A hit anywhere in the
returned reading is a leak, never a coincidence.

## How it was scored

- **Strict** — the constitution's rule, and the same comparison `tests/eval/diff.ts` makes: a
  medicine field is verbatim after trimming, or it is wrong. A run passes only if all five fields
  of every printed medicine are verbatim, with nothing invented and nothing missing.
- **Line-level** — the weaker question: did every printed value survive *somewhere* among that
  medicine's five fields. This separates a field-boundary choice from a value that was lost or
  altered. Reported alongside; it never decides pass/fail.
- Medicines are aligned by drug (with strength as a tie-break, which is what keeps the two
  Furosemide rows apart), so one dropped row costs one MISSING instead of shifting every later
  comparison.
- Banned terms are counted with `checkText` from `lib/rules/banned-terms` — on the API path over the
  **filtered** cards the app would actually speak, on the direct path over **raw** model output.

**Caveats, stated up front.** The runner posts the full 1240x1754 image; the real app downscales to
a 1600px long edge first, so its input is slightly smaller. Time to first card equals time to done
on every run because `app/api/read/route.ts` emits cards only after the whole reading is validated —
there is no early card to measure. The three model paths were first run concurrently; a later serial
API pass (nothing else running) reproduced the same latencies within ~5 s, so the numbers below are
not a concurrency artefact.

---

## Results

`strict` = runs where every medicine field was verbatim. `field` = share of individual medicine
fields verbatim. `unread` = runs where every deliberately covered region was flagged. `leak` = trap
markers found. Latency is time to `done` (= time to first card).

### dense — 8 medicines, two columns, tiny type

| Model / path | runs | ok | strict | line | field | invented | missed | unread | leak | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-opus-5` via `/api/read` | 5 | 5 | **100%** | 100% | **100%** (200/200) | 0 | 0 | 5/5 | 0 | 54.8s | 59.6s |
| `claude-opus-5` direct | 3 | 3 | **100%** | 100% | **100%** (120/120) | 0 | 0 | 3/3 | 0 | 59.1s | 194.7s |
| `claude-sonnet-5` direct | 3 | 3 | **100%** | 100% | **100%** (120/120) | 0 | 0 | 3/3 | 0 | 85.6s | 165.9s |

The hardest-looking sheet is the one whose *medicines* it reads perfectly. 440 medicine fields
across 11 runs, every one verbatim: both Furosemide strengths kept apart, all three meal timings,
the taper string `40mg daily x 3/7 then 20mg daily` and the PRN line intact, and not one of the six
drugs in the "not to be taken" block pulled into the list.

The warning box is where `dense` fails, and not by dropping anything. All four signs come back every
time — but in **6 of opus's 8 runs the `source.quote` is not verbatim**:

```
page prints:  "Breathless at rest, or needing to sleep sitting up"
quote says:   "2. Breathlessness at rest, or needing to sleep sitting up"
```

`source.quote` is the one field the whole traceability principle rests on: the app shows it as the
line the card stands on. Here it shows a word the page does not contain. Twice, opus also returned
**five** warning signs for a four-line box. Sonnet quoted all four verbatim in all 3 of its runs.

### messy — the same page, badly photographed

| Model / path | runs | ok | strict | line | field | invented | missed | unread | leak | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-opus-5` via `/api/read` | 5 | 5 | **0%** | 0% | 97.4% (185/190) | 0 | 0 | 5/5 | 0 | 68.8s | 78.5s |
| `claude-opus-5` direct | 3 | 3 | **0%** | 0% | 97.4% (111/114) | 0 | 0 | 3/3 | 0 | 64.4s | 73.6s |
| `claude-sonnet-5` direct | 3 | **2** | **100%** | 100% | **100%** (76/76) | 0 | 0 | 2/2 | 0 | 103.5s | 154.2s |

The honest headline: **the thumb test passes and the blur test does not.** Across the 10 completed
runs, all 20 covered Duration fields came back `null` — **zero guesses** — with an `unreadable`
entry that names the cause ("A finger or thumb covers the lower right area of the page, hiding part
of the printed text near the bottom edge"). That is exactly the behaviour the product needs.

One qualification on that `unread 5/5`, so it is not over-read: the flag says *an area* is covered,
never *which two values are missing*. No run named the Duration column or the two drugs. A user is
told "part of the page is hidden"; they are not told "the length of the Prednisolone course is the
thing you cannot see". The gap is honest but not actionable.

What blur costs is punctuation and dates. Opus read the printed comma in
`daily, 30 min before breakfast` as a semicolon in all 8 of its runs, and dropped the full stop from
the diet line in 4 of 5. Worse, one run silently changed an appointment date, and one dropped a test
name:

- `followUp[0].when` expected `10-09-2026 09:15`, got `17-09-2026 09:15`
- `followUp[1].tests` expected `RFT and potassium 3 days before`, got `potassium 3 days before`

(the second on the direct opus path). Neither was flagged as uncertain.

Sonnet's medicine fields were perfect on the two runs it completed, but it **dropped a whole warning
sign in both** — "Chest pain not relieved by 3 doses of GTN spray" simply was not returned, on the
sheet where the shadow gradient falls across the warning box — and **failed the third run outright**
(`invalid_output:truncated`, the reply hit `MAX_TOKENS`), the only hard failure in 44 runs. Opus
returned all four warning signs on every messy run.

### handwritten — ink over print

| Model / path | runs | ok | strict | line | field | invented | missed | unread | leak | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-opus-5` via `/api/read` | 5 | 5 | **40%** | 100% | 95.2% (119/125) | 0 | 0 | 5/5 | 0 | 57.0s | 58.1s |
| `claude-opus-5` direct | 3 | 3 | **33%** | 100% | 96.0% (72/75) | 0 | 0 | 3/3 | 0 | 43.9s | 48.8s |
| `claude-sonnet-5` direct | 3 | 3 | **67%** | 100% | 97.3% (73/75) | 0 | 0 | 3/3 | 0 | 57.5s | 58.8s |

The handwriting itself is read correctly every time: `17/9/26 2:30 pm`, `2.5mg` and `BD PRN` came
back in all 11 runs, and the illegible remarks box was flagged in all 11 ("Handwritten remarks are a
wavy scrawl; no words can be made out"). The failure is what happens to the **struck-through** value.
Three behaviours across runs, and the wrong one is the most common:

- `strength: "2.5mg"` — correct (2 of 5 API runs)
- `strength: "5mg 2.5mg"` — both doses in one field (3 of 5 API runs)
- `strength: "2.5mg (handwritten; printed 5mg struck out)"` — a comment inside a verbatim field (opus direct)

### mixed — bilingual, with a lab table and a stopped-drug block

| Model / path | runs | ok | strict | line | field | invented | missed | unread | leak | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-opus-5` via `/api/read` | 5 | 5 | **0%** | 0% | 80.0% (100/125) | **2** | 0 | 5/5 | **21 hits in 1/5 runs** | 41.5s | 45.2s |
| `claude-opus-5` direct | 3 | 3 | **0%** | 0% | 80.0% (60/75) | 0 | 0 | 3/3 | 0 | 38.8s | 44.6s |
| `claude-sonnet-5` direct | 3 | 3 | **67%** | 67% | 94.7% (71/75) | 0 | 0 | 3/3 | 0 | 54.0s | 59.4s |

Two separate failures here.

**The meal timing is dropped from `frequency`.** In all 8 opus runs, every Chinese instruction line
lost its second clause: `每日一次，早餐后服` came back as `每日一次`, `每晚睡前皮下注射` as `每晚睡前`.
The words are not gone from the page's `source.quote` and the spoken card still says them, so the
family hears the right thing — but the **typed field** is what `lib/rules/plan-from-reading.ts` turns
into a `medicineTime` plan item, and what `lib/rules/template-fallback.ts` rebuilds a card from when
the banned-term filter fires. On this sheet the plan says "每日一次" and "after breakfast" is gone.
Sonnet kept the full clause in 2 of 3 runs.

**The "do not take" block was read as discharge medicines, once.** See below.

The lab table itself never leaked: `NT-proBNP`, `3820`, `eGFR`, `148 pmol/L` and the
`维生素B12 / Vitamin B12` row appear in no field of any of the 11 runs, and no medicine was invented
from them. That trap is clean.

---

## The worst single miss

`mixed`, `/api/read`, run 2 of the serial pass. Two drugs printed under the heading
**「停用药物（出院后不再服用） Discontinued — do not take」** came back as discharge medicines 6 and 7:

```json
{ "name": "Digoxin",     "strength": "0.25mg", "amount": null, "frequency": "每日一次", "duration": null,
  "source": { "section": "停用药物（出院后不再服用）", "quote": "Digoxin 0.25mg，每日一次，已于住院第2天停用。" } }
{ "name": "Glimepiride", "strength": "2mg",    "amount": null, "frequency": "每日一次", "duration": null,
  "source": { "section": "停用药物（出院后不再服用）", "quote": "Glimepiride 2mg，每日一次，已于住院第4天停用，改为下方出院带药方案。" } }
```

The spoken card is careful — it says so:

> "Digoxin 0.25mg, once a day — the page says this was stopped on day 2 in hospital and is not to be
> taken after going home."

So a family listening to the card is not misled, and this is why the miss is subtle rather than
obvious. But the **typed record carries no trace of "stopped"**, because `MedicineSchema` has no
field for it. `draftPlan` walks `reading.medicines`, keeps every entry with a `frequency`, and emits
a `medicineTime` item labelled `Digoxin 0.25mg` / `每日一次`. The plan the app shows therefore
schedules a drug the hospital stopped. And if that card ever trips the banned-term filter, the
repair path rebuilds it from the typed facts alone — `templateFor("medicine", …)` would say
"药名 Digoxin，0.25mg，每日一次。" with the "stopped" sentence gone.

Runner-up, and more persistent (3 of 5 API runs, and seen on both models):

```
Bisoprolol.strength expected "2.5mg", got "5mg 2.5mg"
Tramadol.frequency  expected "BD PRN", got "TDS BD PRN"
```

A field that reads `5mg 2.5mg` states two doses of a beta-blocker and resolves neither.

---

## Verdict

### (a) Does this pipeline read a complex, badly-photographed or annotated real-world-shaped sheet correctly?

**Partly. It does not lose or invent medicines, and it is honest about what it cannot see — but it
is not verbatim, and it will schedule a stopped drug.**

What holds up, across 44 runs (43 completed) on three paths:

- **Zero missing medicines and near-zero invented ones** — 42 of 43 completed runs returned exactly
  the printed medicine list. The single exception is the `mixed` "stopped medicines" case above.
- **Nothing is guessed where the page is covered.** 10 of 10 runs left both thumb-covered Duration
  cells null and flagged the region; 11 of 11 flagged the illegible remarks box.
- **The lab table did not leak.** Not one of ~20 markers in any of 11 `mixed` runs.
- **The banned-term filter earns its place.** Raw model output tripped it 13 times (opus) and 17
  times (sonnet) across 24 direct runs — mostly `治療` from "physiotherapy", and the taper line
  reading as a rate. On the API path, after filtering, **0 hits in 20 runs**.

What does not hold up:

- **Verbatim is 100% on only one of the four sheets.** Strict pass rate: `dense` 5/5, `handwritten`
  2/5, `messy` 0/5, `mixed` 0/5. Field-level: 100%, 95.2%, 97.4%, 80.0%.
- **A blurred date changed silently** (10-09 → 17-09) with no uncertainty flag. Under blur the model
  is confident about characters it cannot actually resolve — it flags a *covered* region but not an
  *ambiguous* one.
- **Struck-through values survive into the typed field** in the majority of runs.
- **`source.quote` is not always verbatim.** On `dense`, 6 of 8 opus runs quoted "Breathlessness at
  rest" for a line that prints "Breathless at rest". A quote that is silently rewritten undermines
  the one thing the user is told they can check.
- **Warning signs are not stable in count.** Opus returned five signs for a four-line box twice;
  sonnet dropped one of four in both of its completed `messy` runs. Warning cards are the highest-
  stakes output on the page.
- **Latency misses the 30 s target on every hard sheet**: p50 41.5–68.8s, p95 up to 78.5s, and
  because cards are emitted only after the whole reading validates, that is also the time to the
  first spoken word.
- **1 hard failure in 44 runs** (sonnet, truncated at `MAX_TOKENS` on `messy`).

### (b) Is there evidence that a second vision model is needed?

**No. The evidence points at the schema and the prompt, not at the vision.**

Both models read the same pixels correctly. Where they differ, they differ on formatting judgement,
and neither dominates:

| | dense | messy | handwritten | mixed | warning signs | hard failures | raw banned hits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-opus-5` | 3/3 strict | 0/3 strict, 97.4% field | 1/3 strict | 0/3 strict, 80% field | all returned; 1 quote not verbatim (6/8 runs); 5-for-4 twice | 0/12 | 13 |
| `claude-sonnet-5` | 3/3 strict | 2/2 strict, 100% field | 2/3 strict | 2/3 strict, 94.7% field | **dropped 1 of 4 on `messy`, both runs** | **1/12** | 17 |

Sonnet was *better* on the two sheets opus struggles with (it kept `daily, 30 min before breakfast`
and `每日一次，早餐后服` intact) and slower (p50 54–104s vs 39–64s) — but it is also the only path
that lost a warning sign and the only one that produced an unusable reply, while opus is the only
one that rewrote a quote. Neither is safer; they are unsafe in different places. A second *vendor*
would add another set of these same formatting
quirks, another latency profile and another failure mode, for no gain on the errors that actually
matter — every one of which is a schema or prompt problem that a second model would reproduce:

- No model can express "this drug is stopped" through `MedicineSchema`; there is no field for it.
- No model can be graded on where a clause belongs when the prompt does not say.
- Cross-checking two models would double the cost and roughly double the 41–79s wait, and the
  disagreements it would surface are exactly the punctuation-level ones that do not change care.

**What evidence would justify one:** a sheet where the two models return *different medicine
identities* — a different drug name, a different strength, a different number of items — rather
than different formatting. That did not happen once in 24 direct runs. Run this suite against
photographs of real (consented, de-identified) sheets; if the same-image disagreement rate on drug
name or strength exceeds ~1%, a second reader used as a cross-check on medicines only becomes worth
its latency. Until then it is cost without a finding.

---

## What to change first

1. **Add `status: "current" | "stopped" | "changed"` (or an explicit `discontinued: boolean`) to
   `MedicineSchema`**, default `"current"`, and teach `READ_SYSTEM` to set it from headings like
   "not to be taken" / 「已停用」/「出院后不再服用」. Then have `draftPlan` and `buildCards` drop or
   visually separate anything not `"current"`. This is the only fix that removes the worst miss;
   prompt wording alone cannot, because the field does not exist. **Highest value.**
2. **Say in `READ_SYSTEM` what happens to a struck-through value**: the ink replaces the print; the
   crossed-out value goes to `unreadable` or is dropped, never concatenated into the field, and never
   annotated inside it. One sentence, and it fixes 3 of 5 handwritten runs.
3. **Say that `frequency` carries the whole instruction clause** — "每日一次，早餐后服" and
   "daily, 30 min before breakfast" are one frequency, not a frequency plus a comment. That is the
   entire 20% field gap on `mixed`.
4. **Flag ambiguity, not just occlusion.** The prompt tells the model to admit what it *cannot see*;
   it says nothing about a character it can see but cannot resolve. Add: a digit in a date or a dose
   that the image does not settle goes to `unreadable` as well. That is what would have caught
   `17-09-2026`.
5. **Latency.** Nothing here is a model choice: cards are emitted only after the whole reading
   validates. Emitting the warning card as soon as `warningSigns` is parseable from the partial JSON
   stream would cut time-to-first-word by tens of seconds without touching accuracy.

## How to reproduce

```bash
env -u NODE_OPTIONS ./node_modules/.bin/tsx fixtures/stress/render.ts
env -u NODE_OPTIONS ./node_modules/.bin/tsx tests/eval/stress.ts \
  --mode api --sheets all --runs 5 --base http://localhost:3011 --out /tmp/api.json
env -u NODE_OPTIONS ./node_modules/.bin/tsx tests/eval/stress.ts \
  --mode direct --models claude-opus-5,claude-sonnet-5 --sheets all --runs 3 --out /tmp/direct.json
```

`--dump <dir>` writes the whole returned reading per run, which is how the "where did 早餐后服 go"
question above was answered. Both flags are local and opt-in; point them at synthetic fixtures only.

---

# Re-run after the four fixes

Same four fixtures, same runner, same dev server on `http://localhost:3011`, `--mode api --runs 3`.
Run on 2026-09-03, after the changes listed under "What was changed" below.

**The answer keys and the runner changed too, so read the numbers with that in mind.** Since
`Medicine.status` exists, a page's "not to be taken" block is no longer purely a trap: each
`*.truth.json` now lists it under `stoppedMedicines`, and the runner judges a returned entry from
it on two things only — its `status` must not be `"current"`, and it must not reach the plan
`lib/rules/plan-from-reading.ts` drafts. Those entries are held out of the strict and field-level
medicine scores, so `strict` and `field` still count exactly the same printed medicines as the runs
above. **The before column below is a fresh 3-run pass on the unmodified pipeline scored by the new
runner**, not the 5-run numbers from the original table — otherwise the two halves would not be
comparable.

Two new columns: `danger` is a stopped-block drug returned as one to take, or any non-current
medicine that reached the plan. `stopmk` is stopped-block entries returned and correctly marked.

## Before — unmodified pipeline, new runner

| Sheet | runs | ok | strict | line | field | inv | miss | guess | danger | stopmk | unread | leak | warn | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dense` | 3 | 3 | 100% | 100% | 100.0% (120/120) | 0 | 0 | 0 | 0 | 0 | 3/3 | 0 | 75% | 59.1s | 61.0s |
| `messy` | 3 | 3 | 0% | 0% | 97.4% (111/114) | 0 | 0 | 0 | 0 | 0 | 3/3 | 0 | 100% | 69.9s | 73.4s |
| `handwritten` | 3 | 3 | 0% | 100% | 92.0% (69/75) | 0 | 0 | 0 | 0 | 0 | 3/3 | 0 | 100% | 57.4s | 62.9s |
| `mixed` | 3 | 3 | 33% | 33% | 86.7% (65/75) | 0 | 0 | 0 | 0 | 0 | 3/3 | 0 | 100% | 36.0s | 43.4s |

## After — the four fixes in place

| Sheet | runs | ok | strict | line | field | inv | miss | guess | danger | stopmk | unread | leak | warn | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dense` | 3 | 3 | **100%** | 100% | **100.0%** (120/120) | 0 | 0 | 0 | **0** | 9 | 3/3 | 0 | **100%** | 99.3s | 109.8s |
| `messy` | 3 | 3 | 0% | 0% | 97.4% (111/114) | 0 | 0 | **0** | **0** | 10 | 3/3 | 2 | 100% | 102.1s | 111.4s |
| `handwritten` | 3 | 3 | **100%** | 100% | **100.0%** (75/75) | 0 | 0 | 0 | **0** | 6 | 3/3 | 0 | 100% | 67.9s | 68.5s |
| `mixed` † | 3 | 3 | **100%** | **100%** | **100.0%** (75/75) | 0 | 0 | 0 | **0** | 6 | 3/3 | 0 | 100% | 44.5s | 45.0s |

† **`mixed` was not re-run against the very last prompt revision: the API credit balance ran out
mid-pass** (`502 model_unavailable`, which a direct call resolves to
`invalid_request_error: Your credit balance is too low`). The row above is the immediately
preceding 3-run pass, whose prompt differs only in the clause about list numbering versus a printed
`Diet:` label — a clause that touches `dietLine`/`activityLine` and no medicine field. Across the
three completed `mixed` passes since the fixes (7 runs in total) the medicine numbers were
identical every time: strict 100%, field 25/25, `danger` 0, both stopped drugs marked and neither
planned. The three sheets in the table above did complete on the final prompt.

## What the numbers say

- **`danger` is 0 in every completed run, on every sheet.** 31 entries from the four pages'
  "not to be taken" blocks were returned across the pass, every one with `status` `"stopped"` or
  `"changed"`, and `draftPlan` scheduled none of them. That is the fix to "The worst single miss",
  and it is now exercised on every run rather than surfacing once in five.
- **`mixed` field-level went 86.7% → 100%.** The whole gap was the dropped instruction clause:
  `每日一次，早餐后服` and `每晚睡前皮下注射` now come back whole.
- **`handwritten` strict went 0/3 → 3/3.** The struck-through value no longer survives into the
  typed field: `5mg 2.5mg` and `TDS BD PRN` did not appear once. This was not one of the four fixes
  — the stricter verbatim wording appears to have carried it.
- **`dense` warning coverage went 75% → 100%.** "Breathless at rest" is quoted as printed, in all
  three runs, instead of "Breathlessness at rest".
- **Zero guesses on covered cells held.** Both thumb-covered Duration cells came back null in all
  three `messy` runs, and the flag now names the field it costs (`followUp[1].tests`,
  `medicines[5].duration`) rather than only the region.
- **`unver` is 0 throughout.** The new server-side check never fired on a real reading: every
  medicine's `name` and `strength` were findable in its own `source.quote` in all 12 runs. The
  check is exercised by `tests/unit/reading-pipeline.test.ts` instead, which is the honest reading
  of a zero here — it means the reply was internally consistent, not that the check is inert.

## What is still failing

- **`messy` strict stays at 0%, on one field.** `daily, 30 min before breakfast` is still read as
  `daily; 30 min before breakfast` in all three runs. The comma is one blurred glyph, and this is
  the only medicine field wrong on that sheet.
- **The reader is now more willing to withhold a blurred value.** On `messy` it flagged
  `followUp[1].tests` unreadable rather than guessing at it, on runs where the earlier pipeline
  returned the value correctly. That is the intended trade — a wrong appointment is worse than a
  missing one — but it costs recall on fields that were blurred yet actually legible.
- **Latency got materially worse**: p50 59→99s on `dense`, 70→102s on `messy`, 57→68s on
  `handwritten`. Two causes, both real: the system prompt is ~4k characters longer, and the reply
  now carries two to six extra medicines, each with three spoken forms. The 30s target was already
  missed; it is missed by more. The fix named in the original verdict — emitting the warning card
  from the partial stream instead of after the whole reading validates — is untouched and is now
  worth more than it was.
- **`messy` shows 2 leaks in one run**, both inside `unreadable[0].source.quote`: the model quoted
  the narrative line it was declaring unreadable. Nothing reached an instruction field, and it is
  arguably correct to cite the line you cannot read, but the trap scan counts it.
- **`handwritten` `followUp[1].clinic`** returns `Rehabilitation Block 2/F` rather than
  `Physiotherapy` in all three runs, unchanged from before.

## What was changed

1. `MedicineSchema` gained a required `status: "current" | "stopped" | "changed"`, mirrored in
   `specs/001-discharge-sheet-agent/contracts/sheet-reading.schema.json`. `draftPlan` schedules
   only `current`; `buildCards` still emits a card for the rest, carrying `stopped: true` and
   `facts.status`; the banned-term repair path in `lib/server/reading-pipeline.ts` falls back to
   `SEE_THE_SHEET` for a stopped medicine rather than a template that reads as a dose to take.
2. `UnreadableRegionSchema` gained a required `field: string | null`, and `READ_SYSTEM` now
   separates COVERED from UNCERTAIN: one character you cannot resolve makes the whole field
   unreadable, null plus a named field rather than the most likely reading.
3. `READ_SYSTEM` says `quote` is a character-for-character copy, with "Breathless at rest" as the
   worked example, and `lib/server/reading-pipeline.ts` checks what a server can check — a
   medicine's `name` and `strength` have to appear in its own `source.quote`, or the card is kept
   and marked `unverified`.
4. `READ_SYSTEM` says `frequency` carries the complete printed instruction, meal timing and route
   included, as one verbatim string.
