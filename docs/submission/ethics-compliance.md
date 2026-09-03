# Ethics and Compliance Statement

This entry follows the Vital track rules (`rules.md`) and its own constitution
(`.specify/memory/constitution.md`, v1.0.0). Each rule below is enforced in code and tested, not
merely stated.

## Facts about the page, never verdicts about the person

The app transcribes and rephrases what the discharge sheet prints. It does not diagnose, does not
set targets, does not advise. The extraction schema has no field for a diagnosis, so the model has
nowhere to put one; the app never asks for a diagnosis, weight, readings or a name.

## Warning signs first

The first card on every reading is the warning-signs card. If the sheet prints none, a rule-generated
card says so and shows the hospital contact line. The order is a fixed array in code, not a model
choice.

## The model reads and phrases; rules decide

Model calls exist in three server routes: read the page, answer from cards, rephrase one card.
Whether a card is shown, in what order, whether a question is refused, whether a referral is shown,
whether a citation is accepted, and what dates go into the plan are all decided by deterministic
functions with unit tests. A lint rule forbids the rules folder from importing model code.

## No medical advice, structurally

- Questions asking to skip, stop, double, add or re-time a medicine are detected by a rule in
  Cantonese, Mandarin and English **before any model call** and answered with a fixed sentence that
  points to the pharmacist or the sheet's contact line.
- Grounded answers must cite one card id the server itself built; anything else becomes "the sheet
  doesn't say".
- The diet card shows the printed line verbatim. For four recognised instruction types (低盐, 低脂,
  糖尿病饮食, 清淡) it adds one fixed plain sentence. Any other instruction, including low-protein,
  renal, soft or liquid diets, adds nothing.

## Banned words are enforced, not requested

Every generated string passes a filter covering 診斷/诊断, 治療/治疗, 處方/处方, 治癒/治愈, 能吃,
不能吃, 唔食得, 建議你, 停藥/加藥/減藥, their English equivalents, and numeric targets about the
person (per-kilogram or per-day amounts, blood-pressure and glucose targets, calories). A hit
triggers one rephrase, then a fixed template, and a template that itself fails falls back to
"read this line on the page". Product name, interface copy and pitch obey the same list; the UI
strings are tested against the filter in CI. The rulebook's own disclaimer wording is the single
exemption and is asserted as such.

## Disclaimer, AI label, editable output

The disclaimer from the rulebook (section 16) is pinned to every screen; every spoken output ends
with the inaccuracy caution; every AI-written card carries the AI label; the answer text is shown
before it is spoken and can be discarded.

## Consent and simulated data

A simulated-input notice with one-tap consent appears at the start of every session. All demo data
is synthetic: fictional patients, fictional hospitals, sheets authored by the team. No real sheet,
record or audience health information is used.

## No emotional-support surface; crisis referral anyway

The app answers questions about a page. It does not invite emotional disclosure. As insurance, a
crisis-keyword rule (Cantonese, Mandarin, English; idioms like 累死了 excluded) shows a calm referral
card with hotline resources instead of any answer, with no model call. The organisers' resource list
replaces the placeholder entries at kickoff.

## Agent limits, stated on screen

"It will: read the sheet, answer from the sheet, build a plan you confirm. It will not: diagnose,
change medicines, contact anyone." Every plan date and time comes from a source line on the sheet;
nothing is saved until the user confirms; doses are never touched; the app never messages, books or
calls anyone on the user's behalf.

## Privacy

See `data-statement.md`. In short: the image is decoded in memory, sent to the model, and dropped;
the profile and plan live only in browser storage; no accounts, no server storage, no logging of
bodies; a "delete everything" control removes the single storage key.
