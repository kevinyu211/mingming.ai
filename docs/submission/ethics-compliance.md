# Ethics and Compliance Statement

This entry follows the Vital track rules (`rules.md`) and its own constitution
(`.specify/memory/constitution.md`, v1.0.0). Each rule below is enforced in code and covered by
tests, not merely asserted. Module paths are given so any claim here can be checked against the
repository.

## Facts about the page, never verdicts about the person

The app transcribes and rephrases what the discharge sheet prints. It does not diagnose, does not
set targets, does not advise. The extraction schema (`lib/domain/schemas.ts`) has **no field for a
diagnosis**, so the model has nowhere to put one; the app never asks for a diagnosis, a weight, a
reading or a name. The only health input it accepts is the page itself.

## Warning signs first

The amber warning block renders and reads itself before anything else in the conversation. The
order is a fixed array in `lib/rules/card-order.ts` (`CARD_ORDER`), consumed by a pure phase
machine (`components/chat/briefing.ts`) that only ever moves forward. A model turn cannot reach
either. If the sheet prints no warning signs, a rule-written card takes that slot, says so, and
shows the hospital contact line — the red-flag slot is never empty.

## The model reads and phrases; rules decide

Model calls exist in three server routes: read the page (`/api/read`), answer from cards
(`/api/ask`), rephrase one card (`/api/phrase`). Everything else is deterministic code with unit
tests: whether a card is shown, in what order, whether a question is refused, whether a referral
appears, whether a citation is accepted, how many doses remain today, and what dates reach the
plan. ESLint enforces the direction of the dependency — `eslint.config.mjs` forbids anything under
`lib/rules/**` from importing `@/lib/model` or the Anthropic SDK. `model-vs-rules.md` lists every
output and its source.

## No medical advice, structurally

- **Both refusals run before any model call.** `lib/server/ask-pipeline.ts` runs the crisis gate,
  then the medicine-change gate, and only then resolves a model provider. The same two gates also
  run on the device in `app/chat/page.tsx`, so those answers involve **zero network calls** — which
  is why both eval runs record them at 0.0 s.
- Questions asking to skip, stop, double, add or re-time a medicine are detected in Cantonese,
  Mandarin and English (`lib/rules/refusal.ts`) and answered with a fixed sentence pointing to the
  pharmacist or the contact line printed on the sheet. The detector is deliberately biased to
  over-refuse: a false refusal costs one card, a missed one is advice about a medicine.
- Grounded answers must cite a card id **the server itself built** from the current sheet. Anything
  else becomes "the sheet doesn't say" (`lib/server/ask-pipeline.ts`). A question only the on-device
  memory brief could answer therefore still comes back "the sheet doesn't say".
- The diet card shows the printed line verbatim. For four recognised instruction types (低盐, 低脂,
  糖尿病饮食, 清淡) it adds one fixed plain sentence. Any other instruction — low-protein, renal,
  soft, liquid — adds nothing (`lib/rules/diet-line.ts`).

## Two rules the new conversation design makes newly easy to break

**A counter never shows a clock time.** A discharge sheet prints a frequency, not an hour.
`lib/rules/doses.ts` is pure, takes `today` as an argument, has no clock, and derives nothing from
the printed clause except a count of times remaining today. The clause itself is quoted verbatim
behind 「張紙寫：」. Rendering "8am / 8pm" from 「每日兩次，隨餐」 would be the app writing a
prescription the page did not. A clause the rules cannot parse gets the printed words and **no
counter at all** — fewer counters than the design draws is the correct outcome.

**A stopped medicine is never a dose.** `Medicine.status` is `current | stopped | changed`. Only
`current` is counted or scheduled. A stopped medicine still appears — the family needs to know the
page names it — visibly marked as ended, with no counter and no 食咗 button
(`lib/rules/doses.ts`, `lib/rules/plan-from-reading.ts`, `components/track/DoseCard.tsx`). On the
four stress fixtures, all 31 entries from "do not take" blocks came back marked non-current and
none of them reached the plan (`tests/eval/stress.md`).

## Nothing is promised that the app cannot do

**There are no push notifications.** The check-in is an in-app message on 記錄. No copy anywhere
implies the phone will go off by itself; the reply to 未食 quotes the printed clause and stops,
rather than saying "I'll ask you later" (`components/chat/Prompts.tsx`, `components/home/format.ts`).

**A medical document is never silently truncated.** Capture takes up to six pages — because a Hong
Kong patient leaves with 出院紙, 覆診紙, 抽血紙 and more, not one sheet — and at the seventh it
refuses in words, in the picker, on the thumbnails and in the camera hint. The client ceiling and
the server ceiling are the same constant and a test pins them together (`components/Capture.tsx`,
`app/api/read/route.ts`, `tests/unit/page-limit.test.ts`).

**A date appears only when the rules could read one.** `lib/rules/plan-from-reading.ts` parses a
follow-up date only from printed forms that can mean exactly one thing; hedged ("about 2 weeks"),
ambiguous ("01/02/2026") and unrecognised forms return null, and the appointment card then shows
the sheet's own words and counts nothing.

## Banned words are enforced, not requested

Every generated string passes `lib/rules/banned-terms.ts`, covering 診斷/诊断, 治療/治疗, 處方/处方,
治癒/治愈, 能吃, 不能吃, 唔食得, 建議你, 停藥/加藥/減藥, their English equivalents, and numeric
targets about the person (per-kilogram or per-day amounts, blood-pressure and glucose targets,
calories). A hit triggers one model rephrase from the card's typed facts alone, then a fixed
template, and a template that itself fails falls back to "read this line on the page". English is
filtered as well as both Chinese scripts. Product name, interface copy and pitch obey the same
list; `tests/unit/ui-copy.test.ts` runs every interface string through the filter in CI. The
rulebook's own disclaimer wording is the single exemption and is asserted as such.

Measured: raw model output tripped the filter 13 times (Opus) and 17 times (Sonnet) across 24
unfiltered direct runs, mostly 治療 out of "physiotherapy". After filtering: **0 hits in 20 API
runs** (`tests/eval/stress.md`).

## Disclaimer, AI label, transparency

The disclaimer required by `rules.md` section 16 is pinned to the bottom of every screen
(`components/Disclaimer.tsx`), in the interface language, and the footer measures its own height so
no screen can hide it. The simplified-Chinese and English strings are the rulebook's wording
character for character; the traditional-character string is the same statement in colloquial
Cantonese, because the audience for that locale cannot read the register the rulebook is written in.

Every message written by the model carries the AI chip (`components/AiLabel.tsx`, rendered only
where `message.origin === "model"`), and every spoken output ends with the inaccuracy caution. A
card whose typed fields disagree with its own quoted line is marked `unverified`: it is spoken with
the caution and its source link is emphasised, so the reader is told which line to check against
the paper. Every fact opens the verbatim line it stands on. Regions the reader could not resolve
are shown as "I couldn't read this part", with the field they cost named, never filled with a
guess.

## Consent and simulated data

A simulated-input notice with one-tap consent appears at the start of **every session**, before any
health-related input (`components/ConsentGate.tsx`; the dismissal is held in `sessionStorage`, so a
new visit sees it again). All demo data is synthetic and authored by us — see `data-statement.md`,
which states plainly that the app has never read a real discharge summary. No real sheet, no real
record, no audience member's health information has been used anywhere.

## No emotional-support surface; crisis referral anyway

The app answers questions about a page. It does not offer emotional support and does not invite
emotional disclosure. As insurance, a crisis-keyword rule (`lib/rules/crisis.ts`, Cantonese,
Mandarin and English) shows a calm referral card with real hotline numbers instead of any answer,
with no model call and no continuation of the conversation. Ordinary caregiver stress is
deliberately not a crisis, and 死-idioms (累死了, 笑死) are excluded so they cannot trigger it.

**Open item before submission:** `lib/i18n/referral.ts` carries the publicly listed Hong Kong and
mainland 24-hour lines plus emergency numbers, and one row still reads `TODO: replace with
organiser list`. The organisers' referral resources from the kickoff briefing must replace that row.

## Agent limits, stated on screen

「佢會做：讀出張紙、答張紙上面嘅嘢、幫你整個計劃你確認。／ 佢唔會做：唔會斷症、唔會改藥、唔會幫你
聯絡任何人。」 shown in the conversation and again in Settings (`components/AgentLimits.tsx`), never
collapsed behind a disclosure. Every plan date and time comes from a source line on the sheet;
doses are never altered; the app never messages, books or calls anyone. The calendar export copies
the sheet's words as all-day events with no invented times and no alarms (`lib/plan/ics.ts`).

*(Note for the compliance lead: the follow-up is now a view of the active sheet in 跟進 rather than
a draft you confirm, so the 「你確認」 clause in that string describes a step that no longer exists.
It should be reworded before the demo — the plan is still derived only from printed lines and is
still never acted on, but the sentence should say what the app now does.)*

## Privacy

See `data-statement.md`. In short: the page image is decoded inside one server function, forwarded
to the model, and dropped — never written to disk, never cached, never logged. Everything the app
keeps lives in one browser-storage key on the phone, guarded by a walker that refuses to persist
image data. No accounts, no server database, no analytics, no request or response bodies in logs.
"Delete everything" removes the key, clears session storage and drops the audio cache.
