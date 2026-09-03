# Implementation Plan: Discharge Sheet Agent

**Branch**: `001-discharge-sheet-agent` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-discharge-sheet-agent/spec.md`

## Summary

A phone-first web app that photographs a hospital discharge sheet (Hong Kong English or mainland
Chinese), extracts it into a fixed card structure (warning signs first, medicines as printed,
follow-up, diet line, activity, unreadable parts), speaks the cards in Cantonese or Mandarin, and
answers questions grounded only in those cards. One vision-capable model call does extraction and
dialect phrasing together under a strict JSON schema; every gate (card order, banned terms, diet
recognition, refusal, plan derivation, unreadable handling) is deterministic code. Profile, plan
and the last reading live in browser storage only; the image never leaves memory. Deployed as a
single Next.js app on Vercel with a laptop-and-hotspot fallback for the venue.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 (Vercel default runtime); React 19 via Next.js (App Router, latest stable at scaffold time)

**Primary Dependencies**: Next.js (App Router, route handlers on Fluid Compute); `@anthropic-ai/sdk` (Claude Opus 5 `claude-opus-5` by default, Sonnet 5 `claude-sonnet-5` if the fixture eval shows equal medicine-field accuracy; vision + structured outputs + streaming); Zod (schemas shared by model output validation and client state); Tailwind CSS; `opencc-js` (Traditional/Simplified conversion for on-screen text); **cloud text-to-speech as the primary voice** through a provider adapter chosen by a day-one listening test (shortlist: MiniMax Speech, ElevenLabs v3, Azure Speech `zh-HK`; see research.md R5), with browser `speechSynthesis` as offline fallback; speech-to-text through the same adapter pattern (ElevenLabs Scribe or Azure, browser `SpeechRecognition` fallback; R6)

**Storage**: Browser `localStorage` (profile, confirmed plan, most recent reading as JSON, all under one namespaced key with a single "delete everything" clear). No database. No server-side persistence. Photographed image held only in memory during the read request.

**Testing**: Vitest for rules and schemas (banned-term filter, diet-line recogniser, card ordering, plan derivation, crisis keywords, refusal detector); fixture evals (3 synthetic sheets with expected JSON, run against the live model on demand, results recorded in `tests/eval/results.md`); Playwright for the live path on a phone-sized viewport with the model route mocked from fixtures

**Target Platform**: Mobile browsers, primarily iOS Safari 17+ and Android Chrome 120+, opened from a link and installable to the home screen (web app manifest). Desktop Chrome for development.

**Project Type**: Single web application (Next.js app serving both UI and the three API routes)

**Performance Goals**: Shutter to first spoken warning-sign card under 30 s on venue Wi-Fi (SC-001); spoken answer starts within 10 s of the question ending (SC-006); decline message for a non-sheet within 10 s (SC-010)

**Constraints**: No accounts, no server storage, no image persistence or logging; every generated string passes the banned-term filter before display or speech; model requests carry only the image (read) or the reading plus question (ask), never profile fields; must degrade to bundled sample sheets when the model route fails; must run on a phone with only built-in speech voices

**Scale/Scope**: One user at a time on one phone; ~8 screens; 3 API routes; 3 fixture sheets; 2 output dialects; demo audience of judges opening a shared link (tens of concurrent sessions at most)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How the design satisfies it | Status |
| --- | --- | --- |
| I. Facts about the page, never verdicts about the person | The extraction schema has no diagnosis, no assessment and no advice fields; cards are typed as warning sign, medicine, follow-up, diet, activity, unreadable. The ask route's system prompt restricts answers to card content and the refusal detector in code blocks change/skip/add-medicine questions. No diagnosis is ever collected. | PASS |
| II. Red flags first | Card order is a fixed array in `lib/rules/card-order.ts`; the UI renders and auto-speaks cards in that order; "no warning signs printed" is itself a card generated in code from the reading. | PASS |
| III. Model reads and phrases; rules decide | Model calls exist in exactly three route handlers (read, ask, phrase). Diet-line recognition, banned-term filtering, unreadable handling, refusal, plan derivation and follow-up-date logic are pure functions in `lib/rules/` with unit tests. No model output toggles a gate. | PASS |
| IV. Everything traces to a line | Every card and answer carries a `SourceReference` (section, line index, verbatim quote) required by the schema; the UI shows it on tap. Unreadable regions are a first-class array; unknown sheet type is a schema value, not an error. | PASS |
| V. Nothing leaves the phone except the question | Image is decoded in the route handler, sent to the model, and dropped; no request body logging; profile and plan only in `localStorage`; the ask request carries the reading and the question, never the profile label or plan dates; "delete everything" clears the namespace. Data statement text is a fixture in the repo. | PASS |
| VI. Banned words are enforced, not requested | `lib/rules/banned-terms.ts` (traditional, simplified, English, numeric-target patterns) runs server-side on every generated string and again client-side before speech; hit → one regenerate via the phrase route → template fallback. UI copy passes the same test in CI. | PASS |
| Workflow: one live path first | Tasks will be ordered Story 1 end to end (with fixtures and failure paths) before any Story 2 work; no roadmap items in scope. | PASS |
| Workflow: model vs rules stated | This plan and the contracts mark each output as model-generated or rule-generated. | PASS |
| Workflow: failure paths are features | Camera → library → typed input; speech in → typed; speech out → on-screen text; model route → bundled sample. Each is a tested path. | PASS |
| Workflow: fixtures in repo, both dialects first-class | `fixtures/sheets/` ships with the code; every card carries both `yue` and `cmn` text from the first build. | PASS |

**Post-design re-check (after Phase 1)**: all gates still pass. The one design choice that needed care was provenance without keeping the image: the `SourceReference` is a verbatim quote plus section and line index, shown as text, so the image can be discarded as Principle V requires (see research.md R7).

## Project Structure

### Documentation (this feature)

```text
specs/001-discharge-sheet-agent/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── sheet-reading.schema.json
│   ├── api-read.md
│   ├── api-ask.md
│   └── api-phrase.md
└── tasks.md             # Phase 2 output (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
app/
├── layout.tsx                 # disclaimer footer, language provider, manifest link
├── page.tsx                   # consent gate → capture
├── setup/page.tsx             # profile: label, dialect (Story 2)
├── read/page.tsx              # cards, auto-speak in fixed order
├── ask/page.tsx               # push-to-talk / typed question, spoken answer
├── plan/page.tsx              # follow-up plan review + confirm (Story 2)
├── settings/page.tsx          # data statement, delete everything
└── api/
    ├── read/route.ts          # image → SheetReading (model, structured output)
    ├── ask/route.ts           # reading + question → grounded answer (model, streaming)
    ├── phrase/route.ts        # one card → dialect text regenerate (model)
    ├── tts/route.ts           # card/answer text → audio bytes (voice provider adapter, per-string cache)
    └── stt/route.ts           # audio clip → transcript (transcription provider adapter)

components/
├── ConsentGate.tsx
├── Capture.tsx                # camera → library → typed fallback
├── CardStack.tsx / Card.tsx
├── SourceSheet.tsx            # bottom sheet showing the source quote
├── SpeakButton.tsx / MicButton.tsx
├── Disclaimer.tsx / AiLabel.tsx
└── AgentLimits.tsx            # "what this agent can and cannot do"

lib/
├── model/
│   ├── client.ts              # Anthropic client, provider adapter interface
│   ├── prompts.ts             # frozen system prompts (cacheable prefix)
│   └── schemas.ts             # Zod: SheetReading, Answer, PhraseResult
├── rules/
│   ├── card-order.ts
│   ├── banned-terms.ts
│   ├── diet-line.ts           # recognised set + verbatim passthrough
│   ├── refusal.ts             # change/skip/add-medicine detector
│   ├── crisis.ts              # crisis keyword → referral card
│   ├── plan-from-reading.ts   # dates/times from source lines only
│   └── template-fallback.ts   # fixed sentences per card type, both dialects
├── speech/
│   ├── tts.ts                 # speak(text, dialect): cloud first, browser fallback, session cache, prefetch
│   ├── stt.ts                 # listen(): cloud first, browser fallback, typed fallback signal
│   └── providers/             # minimax.ts, elevenlabs.ts, azure.ts (server-side only)
├── storage/
│   └── local.ts               # namespaced localStorage, deleteEverything()
└── i18n/
    ├── ui.ts                  # UI strings (zh-Hant, zh-Hans, en)
    └── script.ts              # opencc conversion helpers

fixtures/
└── sheets/
    ├── hk_en.png  + hk_en.expected.json
    ├── cn_zh.png  + cn_zh.expected.json
    ├── cn_zh_photo.jpg + cn_zh_photo.expected.json
    └── not_a_sheet.jpg
tests/
├── unit/                      # rules, schemas, storage
├── e2e/                       # Playwright live path with mocked /api/read
└── eval/                      # fixture eval runner + results.md
public/
├── manifest.webmanifest
└── icons/
```

**Structure Decision**: Single Next.js application. The UI and the three model-facing route handlers live in one deployable so there is one link for judges, one place for the API key (server-side only), and no cross-origin work. Rules are isolated in `lib/rules/` with no imports from `lib/model/`, which makes Principle III checkable by lint.

## Complexity Tracking

No constitution violations to justify. Two choices deliberately kept simple: one model call for extraction plus phrasing instead of a two-stage pipeline (see research.md R2), and browser speech instead of a cloud voice by default (R5).
