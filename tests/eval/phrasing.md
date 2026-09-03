# Phrasing test (cards to 粵語白話文 and 普通话)

The decision record for `provider_shortlist.md` section 4. Two things are being judged and they
pull in opposite directions: does the Cantonese sound like a person, and are the medicine
strings still exactly what the sheet printed?

**Status:** not run yet. Input is the reading produced by the winning model in
`tests/eval/reading.md`, so run that first.

## How to run it

1. Take one reading from the winning R-row and feed the same cards to each candidate.
2. A native Cantonese speaker rates naturalness 1 to 5, blind to which model produced which.
3. Diff every medicine string against the sheet. Any deviation is a fail, not a low score:
   FR-003 and constitution principle I require the medicine line verbatim.
4. Scan every generated string with `lib/rules/banned-terms.ts`.

## Cantonese naturalness (1 to 5, native speaker, blind)

"5" is a daughter explaining the paper to her mother. "1" is a machine translation of a hospital
form. Written Cantonese, traditional characters - a Mandarin sentence in traditional characters
scores 1 no matter how fluent it is.

| model | warning card | medicine card | follow-up card | diet card | mean | notes |
| --- | --- | --- | --- | --- | --- | --- |
| claude-opus-5 |  |  |  |  |  |  |
| claude-sonnet-5 |  |  |  |  |  |  |

## Mandarin naturalness (1 to 5, native speaker, blind)

| model | warning card | medicine card | follow-up card | diet card | mean | notes |
| --- | --- | --- | --- | --- | --- | --- |
| claude-opus-5 |  |  |  |  |  |  |
| claude-sonnet-5 |  |  |  |  |  |  |

## Faithfulness (pass or fail, no partial credit)

| model | medicine strings verbatim | nothing added beyond the sheet | no personal targets | banned-term hits |
| --- | --- | --- | --- | --- |
| claude-opus-5 |  |  |  |  |
| claude-sonnet-5 |  |  |  |  |

"Nothing added" is the one to watch: a model that helpfully explains why the medicine is taken
has invented a fact about the person and fails, however natural it sounds.

## Template fallback

When a banned term is hit, the card is regenerated once and then falls back to
`lib/rules/template-fallback.ts`. Record how often that happened and whether the template read
acceptably out loud.

| model | regenerations | template fallbacks | template acceptable aloud? |
| --- | --- | --- | --- |
| claude-opus-5 |  |  |  |
| claude-sonnet-5 |  |  |  |

---

PICK: _(pending)_ because _(pending)_
