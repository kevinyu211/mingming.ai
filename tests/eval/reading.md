# Reading test (photo to structured cards)

The decision record for research.md R1 and the speed-versus-accuracy rule added on 2026-09-02:
**Sonnet 5 becomes the default only if it matches Opus 5 on medicine fields exactly across all
three sheets.** Anything less and `MODEL_READ` stays `claude-opus-5`.

**Status:** not run yet. Runner is `tests/eval/reading.ts` (T031); this file is its record.

## How to run it

1. `npm run dev` in one terminal.
2. `npm run eval -- --sheets all --runs 5 --model claude-opus-5`, then the same with
   `claude-sonnet-5`.
3. Each fixture is posted to `/api/read` and diffed field by field against its
   `fixtures/sheets/*.expected.json`.

Pass, per `provider_shortlist.md` section 5: **zero invented medicines and exact medicine fields
on all three sheets.** A single wrong dose is a fail, however good everything else looks.

## Accuracy

Five runs per sheet per model. "Medicine fields exact" means name, strength, dose and frequency
all verbatim, in every run.

| model | sheet | runs | medicine fields exact | invented items | missed items | unreadable flags | warning signs found |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-opus-5 | hk_en | 5 |  |  |  |  |  |
| claude-opus-5 | cn_zh | 5 |  |  |  |  |  |
| claude-opus-5 | cn_zh_photo | 5 |  |  |  |  |  |
| claude-sonnet-5 | hk_en | 5 |  |  |  |  |  |
| claude-sonnet-5 | cn_zh | 5 |  |  |  |  |  |
| claude-sonnet-5 | cn_zh_photo | 5 |  |  |  |  |  |

## Refusal and provenance

| model | `not_a_sheet.jpg` declined? | every card has a source quote? | quotes verbatim? |
| --- | --- | --- | --- |
| claude-opus-5 |  |  |  |
| claude-sonnet-5 |  |  |  |

## Latency

SC-001 is 30 seconds from shutter to the first spoken warning-sign card, on venue Wi-Fi.

| model | sheet | ms to first card | ms to done | notes |
| --- | --- | --- | --- | --- |
| claude-opus-5 | hk_en |  |  |  |
| claude-opus-5 | cn_zh |  |  |  |
| claude-opus-5 | cn_zh_photo |  |  |  |
| claude-sonnet-5 | hk_en |  |  |  |
| claude-sonnet-5 | cn_zh |  |  |  |
| claude-sonnet-5 | cn_zh_photo |  |  |  |

## Banned terms

Every string in every response is scanned with `lib/rules/banned-terms.ts` (quotes exempt).
Any hit at all is a finding, not a statistic.

| model | hits | terms | where |
| --- | --- | --- | --- |
| claude-opus-5 |  |  |  |
| claude-sonnet-5 |  |  |  |

## Escalation

If either model misses a medicine line on the bad-photo fixture, the path in R1 is a dedicated
OCR stage (Azure Document Intelligence or PaddleOCR) feeding verbatim lines to the model. Record
here whether that was needed.

- 2026-09-03T08:40:12.366Z — `claude-opus-5` — hk_en 1/1 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-03T08:41:45.313Z — `claude-sonnet-5` — hk_en 0/1 runs, meds 0% exact; cn_zh 0/1 runs, meds 0% exact; cn_zh_photo 0/1 runs, meds 0% exact; invented 0, missing 0, banned 0 — SC-002 FAIL, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-03T08:45:29.127Z — `claude-sonnet-5` — hk_en 0/1 runs, meds 0% exact; invented 0, missing 0, banned 0 — SC-002 FAIL, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-03T08:48:46.223Z — `claude-sonnet-5` — hk_en 1/1 runs, meds 100% exact; cn_zh 1/1 runs, meds 100% exact; cn_zh_photo 1/1 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-03T08:51:25.923Z — `claude-opus-5` — hk_en 1/1 runs, meds 100% exact; cn_zh 1/1 runs, meds 100% exact; cn_zh_photo 1/1 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-03T08:54:01.765Z — `opus5-effort-medium` — hk_en 0/1 runs, meds 0% exact; cn_zh 0/1 runs, meds 0% exact; cn_zh_photo 0/1 runs, meds 0% exact; invented 0, missing 0, banned 0 — SC-002 FAIL, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-03T08:57:13.103Z — `opus5-effort-medium` — hk_en 2/2 runs, meds 100% exact; cn_zh 2/2 runs, meds 100% exact; cn_zh_photo 2/2 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-03T09:02:51.074Z — `opus5-medium-splitfix` — hk_en 2/2 runs, meds 100% exact; cn_zh 2/2 runs, meds 100% exact; cn_zh_photo 2/2 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-03T11:47:39.568Z — `claude-opus-5` — hk_en 1/1 runs, meds 100% exact; cn_zh 1/1 runs, meds 100% exact; cn_zh_photo 1/1 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-05T11:58:08.805Z — `anthropic/claude-sonnet-5-medium-candidate` — hk_en 0/1 runs, meds 0% exact; cn_zh_photo 0/1 runs, meds 0% exact; invented 0, missing 0, banned 0 — SC-002 FAIL, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-05T12:02:44.390Z — `anthropic/claude-sonnet-5` — hk_en 1/1 runs, meds 100% exact; cn_zh_photo 1/1 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-05T12:04:53.728Z — `anthropic/claude-sonnet-5` — cn_zh_photo 1/1 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

- 2026-09-05T12:06:03.564Z — `anthropic/claude-sonnet-5` — cn_zh_photo 1/1 runs, meds 100% exact; invented 0, missing 0, banned 0 — SC-002 PASS, SC-003 PASS (detail in tests/eval/results.md)

---

PICK: _(pending)_ because _(pending)_
