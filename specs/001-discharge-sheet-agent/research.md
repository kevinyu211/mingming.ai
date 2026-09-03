# Research: Discharge Sheet Agent

Phase 0 output. Every unknown from the Technical Context resolved to a decision.

## R1. Model and provider

**Decision**: Claude Opus 5 (`claude-opus-5`) through the official `@anthropic-ai/sdk`, called
only from Next.js route handlers. A thin provider adapter interface (`readSheet`, `answer`,
`phrase`) wraps the client so a second provider can be added without touching the UI or rules.
Adaptive thinking left on (default); `output_config.effort` set to `medium` for phrasing and
answers, `high` for extraction where medicine exactness matters. Enable the server-side refusal
fallback (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`) as the SDK
guidance recommends for Opus 5 code, and always check `stop_reason` before reading content.

**Rationale**: The demo runs in Hong Kong, so a first-party API is reachable. Extraction accuracy on
a dense, abbreviated page is the whole product; Opus-tier vision is the safest bet for reading
"T2DM on OHA, FU SOPD 2/52" correctly. One model for all three routes means one prompt-cache
namespace and one set of behaviours to tune. Rough cost: a one-page photo is on the order of
1.5k input tokens plus a ~2k-token system prompt and ~2k output tokens, roughly US$0.06 per read at
$5/$25 per million; a question is a few cents. A full demo day is under US$20.

**Alternatives considered**: Sonnet 5 (cheaper, faster; rejected as default because a misread
medicine line is the failure that eliminates the entry, and the cost difference is irrelevant at
demo volume; keep as a one-line switch in the adapter). A domestic provider (needed only if the
demo moved to the mainland; the adapter leaves the door open). Two-model split, cheap model for
phrasing (rejected: see R2).

**Speed versus accuracy, decided by eval (added 2026-09-02)**: the fixture eval (R11) runs
both `claude-opus-5` and `claude-sonnet-5` on the three synthetic sheets and records field-level
accuracy, banned-term hits, Cantonese phrasing quality (rated by a native speaker) and latency.
Sonnet 5 is roughly 2.5x cheaper and materially faster; Opus 5 is the accuracy ceiling. The
rule: Sonnet 5 becomes the default only if it matches Opus 5 on medicine fields exactly across
all three sheets. Effort stays at `high` for reads and drops to `medium` for answers and
phrasing on whichever model wins. A dedicated OCR stage (Azure Document Intelligence or
PaddleOCR feeding text lines to the model) is the escalation path if either model misreads a
medicine line on the bad-photo fixture: OCR gives deterministic verbatim lines, at the cost of a
second hop.

## R2. One call or two for extraction and phrasing

**Decision**: One structured-output call returns the whole `SheetReading`, including for every
card both spoken forms (`yue` written Cantonese in traditional characters, `cmn` Mandarin in
simplified). A separate `phrase` route exists only to regenerate a single card after a banned-term
hit.

**Rationale**: SC-001 gives 30 seconds from shutter to first spoken card. One round trip that
yields all cards, streamed, lets the UI speak the warning-sign card as soon as its object arrives
while the rest finishes. A two-stage pipeline doubles latency and doubles the surfaces where a
banned term can appear. Output tokens grow (two languages per card) but stay in the low thousands.

**Alternatives considered**: Extract first, phrase on demand per card (rejected for latency and
because the demo needs all cards spoken in sequence anyway). Extract in source language only and
translate in the browser (rejected: no on-device Cantonese phrasing of quality).

## R3. Structured output and validation

**Decision**: Define `SheetReading` once as a Zod schema in `lib/model/schemas.ts`, derive the JSON
schema from it for the model's `output_config.format`, and validate the response with the same
Zod schema on the server before anything reaches the client. Unknown or malformed responses fail
closed: the client shows the "couldn't read this sheet" state, never partial invented cards.

**Rationale**: One source of truth for the shape, and the SDK's structured-output support means
the model's JSON matches the schema rather than being parsed out of prose. Validation on the
server is also where the banned-term filter runs, so every string is checked before it can be
displayed.

**Alternatives considered**: Tool-use with a forced tool call (unnecessary; structured outputs are
the documented path and forced tool choice is being removed on newer models). Free-text JSON with
regex extraction (rejected: fragile).

## R4. Image handling

**Decision**: Capture via `<input type="file" accept="image/*" capture="environment">` (works on
iOS Safari and Android Chrome without permissions prompts beyond the camera sheet), downscale in
the browser to a maximum 1600 px long edge and JPEG quality ~0.85 before upload, send as base64
in the read request, decode in memory in the route handler, pass to the model as an image block,
and drop it. No temp files, no logging of request bodies. Multi-page: the client lets the user add
a second photo before submitting; both go in the same request as two image blocks.

**Rationale**: 1600 px is enough for dense print on an A4 sheet while keeping uploads small on
venue Wi-Fi. The file input route avoids the WebRTC camera stream and its permission edge cases.
Discarding after the call is what Principle V requires.

**Alternatives considered**: `getUserMedia` live viewfinder (more polish, more permission failure
modes; not worth it for the sprint). Uploading originals (slow on Wi-Fi, no accuracy gain).

## R5. Speech output (Cantonese and Mandarin) — revised 2026-09-02

**Decision**: Cloud text-to-speech is the primary voice, served through a `/api/tts` route
behind a `speak(text, dialect)` interface with a provider adapter. The provider is chosen by a
**listening test on day one**, not by spec sheet, from this shortlist in order of expected
Cantonese quality:

1. **MiniMax Speech (speech-2.x HD)**: documents native Cantonese voices and accepts Jyutping
   with tone numbers in parentheses to force pronunciation of specific words, which matters for
   drug names and numbers. Strongest documented Cantonese support of the general providers.
2. **ElevenLabs (Eleven v3)**: 74 languages, best-in-class naturalness in English and Mandarin,
   but Cantonese is documented for transcription and not clearly for speech; at least one 2026
   comparison reports multilingual platforms, ElevenLabs included, reading Cantonese with Mandarin
   tones. Include only if it passes the test.
3. **Azure Speech `zh-HK` neural voices** (HiuMaan, HiuGaai, WanLung): reliable, SSML control,
   slightly flatter delivery. The safe fallback if 1 and 2 disappoint.
4. **Cantonese specialists** (cantonese.ai, CantoVoice): built for Hong Kong Cantonese with
   number, date and mixed-English normalisation. Worth one sample each if time allows.

Browser `speechSynthesis` (`zh-HK` / `zh-CN` voices) remains the offline fallback, and on-screen
text the last fallback.

**The listening test** (30 minutes, before any TTS code): the same three sentences per dialect,
one warning sign, one medicine line with an English drug name and a number, one follow-up date,
rendered by each provider; play them to two native Cantonese speakers blind; pick by ear. Judge
tones, the English drug name, the numbers, and whether it sounds like a person talking to a
parent rather than a newsreader. Record the choice and samples in `tests/eval/voices.md`.

**Design consequences**: audio for every card is requested as soon as the card arrives from
`/api/read` (in parallel, not on tap), cached per exact string for the session so replays are
instant, and the first card starts playing while later ones are still rendering. Only card and
answer text is sent to the TTS provider; never the profile label, never the image. The data
statement names the voice provider (R13). The route returns audio bytes and never logs the text.

**Rationale**: The user's judgement is that the voice is the product's most important moment,
and the risk is specific: a multilingual voice reading traditional Chinese with Mandarin
phonology sounds wrong to every Cantonese speaker in the room. Only listening settles it.

**Alternatives considered**: Browser voices only (adequate on iOS, robotic; kept as fallback).
Pre-recorded audio (violates the real-run rule). Volcano Engine (豆包) Cantonese voices are
excellent but need a mainland account and sit behind a cross-border question for a Hong Kong demo.

## R6. Speech input — revised 2026-09-02

**Decision**: Same shape as output: a `/api/stt` route with a provider adapter, chosen by a
short test on Cantonese, Mandarin and English questions. Shortlist: **ElevenLabs Scribe**
(documents Cantonese transcription explicitly), **Azure Speech-to-Text `zh-HK`**, and the
browser `SpeechRecognition` API as the no-key fallback. Push-to-talk, interim text shown where
the provider supports it, typed text box always visible.

**Rationale**: Question text is short and the stakes are lower than output (the user can see the
transcript and correct it before sending), so the browser API may be enough; the adapter makes
the upgrade a configuration change. Test on iOS Safari specifically, where `SpeechRecognition`
for `zh-HK` is the least certain.

**Alternatives considered**: Cloud-only (adds a failure mode to a path that has a typed
fallback anyway).

## R7. Provenance without keeping the image

**Decision**: `SourceReference` = section name (as printed), line index within that section, and
a verbatim quote of the source line. The UI shows the quote in a bottom sheet; there is no image
highlight because the image is not retained.

**Rationale**: Principle V forbids keeping the image after extraction. A verbatim quote is what a
family can compare against the paper in their hand, and it is what the ask route cites. Bounding
boxes would require retaining the image and add little for the user.

**Alternatives considered**: Normalised bounding boxes with the image kept in memory for the
session (rejected by the constitution). Keeping only a heavily downscaled thumbnail (still an
image of a medical record; rejected).

## R8. Written forms and dialect text

**Decision**: The model produces `yue` (colloquial written Cantonese, traditional characters) and
`cmn` (Mandarin, simplified characters) per card. On-screen text follows the selected dialect's
script; the user can flip script with `opencc-js` without a model call. Medicine names, strengths
and frequencies are copied verbatim from the sheet into both forms and are never translated or
transliterated (an English drug name stays English).

**Rationale**: Cantonese speech sounds natural only from Cantonese text. Keeping medicine strings
verbatim satisfies FR-003 and avoids the classic transliteration error.

**Alternatives considered**: Single Chinese text read by two voices (rejected: Cantonese voice
reading Mandarin phrasing sounds like a newsreader, not a daughter).

## R9. Storage

**Decision**: `localStorage` under one key (`fitornot.v1`) holding `{ profile, plan, reading,
consentedAt }` with a schema version. `deleteEverything()` removes the key. No IndexedDB, no
cookies, no analytics.

**Rationale**: The data is a few kilobytes of JSON; simplicity beats capacity. One key makes
"delete everything" provably complete.

**Alternatives considered**: IndexedDB (unneeded), cookies (would travel to the server, violating
Principle V).

## R10. Hosting and venue fallback

**Decision**: Deploy to Vercel (Fluid Compute route handlers, API key as a server environment
variable). Keep a laptop fallback: `next build && next start` on the laptop, phone joins the
laptop's hotspot, QR code to the LAN address. The bundled sample sheets cover the case where the
model route itself is unreachable.

**Rationale**: Vercel is reachable from Hong Kong, gives judges a single link, and needs no
infrastructure work. The fallback chain (hosted → local → bundled sample) matches the constitution's
failure-path rule.

**Alternatives considered**: Domestic hosting (only needed for a mainland venue).

## R11. Testing approach

**Decision**: Vitest unit tests for every file in `lib/rules/` (these are the constitution's
gates, so they get the most tests). Fixture evals: each synthetic sheet has an
`expected.json`; an eval script calls the real read route and reports field-level diffs plus a
banned-term scan over all strings; results are recorded in `tests/eval/results.md` and become the
evidence for SC-002 and SC-003. Playwright covers the live path on a 390×844 viewport with
`/api/read` mocked from fixtures so it runs offline.

**Rationale**: The rules are cheap to test exhaustively and are where a bug becomes a compliance
failure. Model behaviour is tested against fixtures because that is what the demo runs on.

**Alternatives considered**: Snapshot-testing full model outputs (brittle; field-level diff is
enough).

## R12. Prompt caching and streaming

**Decision**: Frozen system prompt and schema instructions first in every request with a
`cache_control` breakpoint after them; the image and question after. Stream the read and ask
responses so the UI can start speaking as soon as the first card object is complete.

**Rationale**: Judges will run the same flow many times; caching the fixed prefix cuts latency
and cost. Streaming is what makes the 30-second target comfortable.

**Verify at implementation**: the fixed prefix meets the model's minimum cacheable length, checked
via `usage.cache_read_input_tokens` on the second request.

## R13. Cross-border and data statement

**Decision**: The data statement (a fixture rendered on the settings screen and copied into the
submission) states: the photographed image and the typed or spoken question are sent to the model
provider's API outside Hong Kong for processing; the text of each card and answer is sent to the
voice provider to be spoken, and spoken questions are sent to the transcription provider; the app
stores nothing on any server; the image is discarded after the response; the profile and plan
never leave the phone; provider retention follows each provider's published policy. Providers are
named once the listening and transcription tests (R5, R6) pick them.

**Rationale**: FR and constitution require the disclosure; writing it once as a fixture keeps the
UI and the submission identical.

## R14. Banned-term filter design

**Decision**: A single list in `lib/rules/banned-terms.ts` with three groups: Chinese terms in
both scripts (診斷/诊断, 治療/治疗, 處方/处方, 治癒/治愈, 能吃/唔食得/不能吃, 建議你/建议你 when
followed by a health verb), English terms (diagnos*, treat*, cure*, prescri*, "you should" in a
health context), and numeric-target patterns (grams/kilogram, mg/dL or mmol targets, calorie
targets, "每天…克"). Terms that legitimately appear on the sheet (a drug name containing "cure",
a section titled "Treatment and Outcome") are exempt only inside `SourceReference.quote`, never in
generated text. The filter returns the matched term so the phrase route can be told what to avoid.

**Rationale**: The rulebook's negative list is enforced at the string level regardless of prompt
quality, and the exemption keeps verbatim quotes honest.
