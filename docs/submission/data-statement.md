# Data and Privacy Statement

A shorter version of this is rendered in the app under Settings
(`lib/i18n/data-statement.ts`), shown before the first health-related input, and repeated here for
the submission.

## All demo data is synthetic, and the app has never read a real sheet

Every discharge sheet the app has ever been given was **written by us**. The three clean fixtures in
`fixtures/sheets/` and the four hard ones in `fixtures/stress/` were authored as HTML, rendered to
images, and scored against answer keys taken from that same HTML. Fictional patients, fictional
hospitals, no real identifiers.

No real discharge sheet, no real medical record, and no audience member's health information has
been used in development, in testing, in any evaluation run, or in the demo. Nothing was trained or
fine-tuned; the model is used as a hosted API.

This matters twice over. It satisfies the track's data gate. It also **limits what we may claim**:
the extraction schema now has third-party support (the Hospital Authority's own discharge checklist
lists almost exactly the fields we pull — see `project.md`), but the *reading accuracy* has none.
Any figure in this pack is a figure on paper we wrote ourselves.

## What leaves the phone

| Data | Sent to | Why | Kept? |
| --- | --- | --- | --- |
| The photographed page or pages, downscaled on the device to a 2400 px long edge at JPEG quality 0.85 (`lib/image/downscale.ts`; roughly 0.4–0.9 MB a page, and if the server answers 413 the phone retries once at 1600 px), up to six pages | The model provider, through the Vercel AI Gateway (Vercel relays the request and holds no copy of it). On the demo build that is Anthropic Claude Sonnet 5 (`anthropic/claude-sonnet-5`, sent through the Gateway's Anthropic-compatible endpoint), servers outside Hong Kong | To read the sheet | Decoded inside one server function's scope, forwarded, dropped. Never written to disk, never cached, never logged. Provider retention follows the model provider's published policy; the Gateway does not log prompt content. |
| The reading's cards, the typed or transcribed question, which of the three spoken forms to lead with, and the conversation so far about this sheet — up to **40 turns** of the reader's own words and 明明's replies, with any refused or crisis turn and the question before it left out (`app/chat/page.tsx`, `withheldTurnsRemoved`) | The same model provider, through the Gateway | To answer the question from the cards, and to understand what a follow-up refers back to | Not stored by us. |
| A memory brief: at most **1200 characters** of plain text, assembled on the phone from sheets this app already read | The same model provider, attached to the question above | So a question can refer back to an earlier sheet | Not stored by us. Sent only with a question, never on its own, and omitted entirely when empty. |
| The text of a card or an answer | The configured voice provider. On the demo build that is **MiniMax `speech-2.8-hd`** through its international endpoint `api.minimax.io`; adapters for ElevenLabs and Azure Speech exist but are not enabled | To speak it aloud | Not stored by us. With no provider configured (`TTS_PROVIDER=browser`, the shipped default) nothing leaves the phone at all — the phone's own `speechSynthesis` speaks it. |
| A spoken question, as an audio clip recorded on the phone while the button is held | **OpenAI** (`gpt-4o-mini-transcribe` at `api.openai.com`, servers outside Hong Kong), through our `/api/stt` route. The demo build sets `STT_PROVIDER=openai` and `NEXT_PUBLIC_STT_MODE=cloud`. One engine per hold: while recording works, nothing else listens. If the recorder cannot start or returns nothing, the session falls back to the browser's own `SpeechRecognition` for good; on Chrome and Safari that API is a platform service and the browser vendor may process the audio on its own servers — that is between the phone and its browser, and we neither see nor control it. Set both variables to `browser` and no audio reaches our server at all. Adapters for ElevenLabs and Azure exist but are not enabled | To turn speech into text | Not stored by us. The clip is forwarded inside one server function's scope and dropped; never written to disk, never logged. The transcript is shown before it is submitted. Provider retention follows OpenAI's published policy. |
| A fixed warm-up call — one constant card that says the sheet lists no warning signs, and the greeting 你好 — sent by the app when it opens and by a scheduled job every few minutes (`app/api/warm/route.ts`, `vercel.json`) | The same model provider, through the Gateway | To keep the answering path warm, so the first question is not slow | Contains nothing from any reader: no photograph, no card from a real reading, no question. Logged as a timing only. |

The **分享俾屋企人 / Share with family** button on 跟進 builds a plain-text copy of the reading's cards on the device and hands it to the phone's own share sheet (or the clipboard). Where it goes from there is the reader's choice and the reader's app; this app sends nothing. The text carries no name, label or date about the person.

Nothing else leaves the phone. The relationship label, the follow-up plan, its dates and the consent
timestamp are never included in any request. The `/api/ask` request schema is strict at every level
(`lib/server/ask-pipeline.ts`), so a body carrying any profile field is rejected rather than quietly
forwarded, and `tests/unit/privacy.test.ts` asserts it.

The memory brief is a summary of pages, not of a person: the dates sheets were read, the medicine
and follow-up lines as printed, the diet line, the warning signs, one or two sentences the model
itself wrote at the time, and which questions were already asked with their outcomes. It carries no
label, no name, no age, no location, no plan and no dates, and its length cap means it cannot grow
with use. A question that reached the crisis referral is never recorded, so it can never appear
there. A question refused as a medicine change is named but not quoted, because it was answered on
the phone with no model call and must stay that way. The brief is background only: an answer must
still cite a card the server built from the sheet in front of the person, so a question only memory
could answer comes back "the sheet does not say".

## What stays on the phone

One browser-storage key, `fitornot.v1` (`lib/storage/local.ts`), holding:

- the consent timestamp and the interface language;
- the profile — three fields, `{ label, dialect, script }`: a relationship label such as 阿媽, the
  language to speak, and traditional or simplified characters. Never a name, never anything
  clinical;
- **the active sheet**: its reading as text, its rule-derived plan, the conversation thread, the
  dose counts and which day they belong to;
- **the archive**: up to **5** earlier sheets, read-only, counters frozen (`ARCHIVE_LIMIT` in
  `lib/sheets/store.ts`);
- **memory**: the last **5** readings and last **50** questions with their outcomes
  (`lib/memory/types.ts`). Crisis questions are never recorded.

**No image is ever written to that key.** Every write passes `assertNoImageData`, which walks the
object and throws on any key named `image`, `images` or `base64`.

One place does hold image bytes briefly, and it is worth naming rather than glossing: the
downscaled pages are put in `sessionStorage["fitornot.pending-images"]` to survive the single
client navigation from the capture screen to the conversation, because a route change cannot carry
a `File`. The receiving screen reads them once and removes them in a `finally` before the request
even resolves (`app/chat/page.tsx`, `takePendingImages`). They live in that one tab for a few
milliseconds and nowhere else. The downscale itself re-encodes through a canvas, which drops EXIF,
GPS and every maker note before anything is sent anywhere.

**How long:** until evicted by newer use (a sixth sheet drops the oldest; a fifty-first question
drops the oldest) or until 刪除所有資料 is tapped, whichever comes first. No expiry timer, no copy
elsewhere, no sync, no backup by us. Delete removes the single key, then clears `sessionStorage`
whole and drops the in-memory audio cache, so nothing about the sheet survives anywhere in the tab
(`app/settings/page.tsx`).

## What is never collected

Names, identity numbers, age, diagnoses, weight, readings, medicine lists typed by the user,
location. There are no accounts, no server-side database, and no analytics. The extraction schema
(`lib/domain/schemas.ts`) has **no field for a diagnosis**, so the model has nowhere to put one.
Nothing logs a request or response body: `/api/read` logs timing, an HTTP status, an error code
where there is one, and the filter counts; the speech routes log a provider name, an operation, the
language, a status, a duration and a byte count. No question, answer, card, transcript or image
byte appears in any log line.

## Cross-border processing

- **Model**: Anthropic Claude Sonnet 5 through the Vercel AI Gateway, servers outside Hong Kong
  (United States).
  Every page image and every question goes there. The model is one environment variable; the
  statement in the app names whichever is configured.
- **Voice**: MiniMax, international endpoint `api.minimax.io`, on the demo build. Card and answer
  text only — never an image, never the label, never a date. Set `TTS_PROVIDER=browser` and nothing
  is sent at all.
- **Speech input**: OpenAI, `api.openai.com`, servers outside Hong Kong (United States), on the demo
  build. The audio clip only — never an image, never the label, never a date. The browser's own
  recognition runs alongside it; see the table note. Set `STT_PROVIDER=browser` and
  `NEXT_PUBLIC_STT_MODE=browser` and nothing is sent at all.

This is disclosed in the app in the simulated-input notice before the first health-related input,
and again in full under Settings.

The in-app statement (`lib/i18n/data-statement.ts`) names the same three providers — the model
provider behind the Gateway, MiniMax, OpenAI — and is the single place to change if a provider changes. The consent notice
summarises it in one line: only the sheet, the conversation about it and the voice leave the phone, never the
name.
