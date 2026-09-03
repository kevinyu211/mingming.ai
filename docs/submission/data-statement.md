# Data and Privacy Statement

Rendered in the app under Settings (`lib/i18n/data-statement.ts`) and repeated here for the
submission.

## What leaves the phone

| Data | Sent to | Why | Kept? |
| --- | --- | --- | --- |
| The photographed page(s), downscaled to ≤ 1600 px JPEG | The model provider's API (Anthropic, servers outside Hong Kong) | To read the sheet | Decoded in memory by our server, forwarded, then dropped. Not written to disk, not cached, not logged. Provider retention follows the provider's published policy. |
| The text of each card and each answer | The voice provider's API (to be named after the listening test: MiniMax, ElevenLabs or Azure; region per provider) | To speak it aloud | Not stored by us. Browser voices are used instead when no cloud voice is configured. |
| A spoken question (audio clip) | The transcription provider's API (ElevenLabs or Azure) when cloud transcription is enabled; otherwise the browser's own recognition | To turn speech into text | Not stored by us. |
| The reading's cards and the typed or transcribed question, plus the output dialect | The model provider's API | To answer the question from the cards | Not stored by us. |
| A memory brief: at most 1200 characters of plain text, built on the phone from sheets this app already read | The model provider's API, with the question above | So the app knows which earlier sheet a question is referring back to | Not stored by us. Sent only with a question, never on its own. |

Nothing else leaves the phone. The relationship label, the follow-up plan, its dates, and the
consent timestamp are never included in any request; the request schemas are strict and a unit test
asserts it.

The memory brief is the one thing memory ever sends, and it is a summary of pages, not of a person:
the dates sheets were read, the medicine and follow-up lines as printed, the diet line, the warning
signs, one or two sentences the model itself wrote at the time, and the questions already asked with
their outcomes. It never carries the relationship label, a name, an age, a location, the plan or its
dates, and it is capped in length so it cannot grow with use. A question that reached the fixed
crisis referral is never stored and so never appears in it; a question that was declined because it
asked about changing a medicine is named in the brief but not quoted, because it was answered on the
phone without a model call and must stay that way. The brief is background only: the answer must
still come from a card on the sheet in front of the person and cite it, so a question only memory
could answer is answered "the sheet does not say".

## What stays on the phone

One browser-storage key (`fitornot.v1`) holding: consent timestamp, the profile (a relationship label
such as 阿媽 and a dialect), the most recent reading as text, the confirmed plan, and memory. No image
is ever stored. "Delete everything" in Settings removes the key.

Memory is what lets the app pick up where it left off instead of meeting the family again from
scratch. It holds two capped lists:

- **The last 5 sheets read.** For each: the date it was read, whether it was an English or a Chinese
  sheet, the medicine lines, the follow-up lines, the diet line and the warning signs as printed,
  and a short recap in the app's own words. Not the photo, not the source references, not a
  diagnosis — the app never records one.
- **The last 50 questions asked**, with the outcome and which card answered each. Questions that hit
  the crisis referral are not recorded at all.

**How long:** until it is evicted by newer use (a sixth sheet drops the first, a fifty-first question
drops the first) or until "Delete everything" is tapped, whichever comes first. There is no expiry
timer and no copy anywhere else: memory lives in the same single browser-storage key as the rest, on
that phone only, so deleting it is one action and it is complete. It is never uploaded, never backed
up by us, never synced between devices, and never sent anywhere except as the capped brief described
above.

## What is never collected

Names, identity numbers, age, diagnoses, weight, readings, medicine lists typed by the user, location.
The app has no accounts and no server-side database.

## Cross-border processing

Model, voice and transcription requests are processed outside Hong Kong by the named providers.
This is disclosed in the app before the first health-related input (the simulated-input notice) and
in Settings.

## Demo data

All sheets used in the demo and the evaluation are synthetic, authored by the team, with fictional
patients and hospitals. No real medical record is used anywhere.
