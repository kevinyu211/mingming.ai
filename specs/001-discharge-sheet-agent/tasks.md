---

description: "Task list for the Discharge Sheet Agent (feature 001)"
---

# Tasks: Discharge Sheet Agent

**Input**: Design documents from `/specs/001-discharge-sheet-agent/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md, `.specify/memory/constitution.md`

**Tests**: Included. The plan's Testing context requires Vitest for every rules module (they are the constitution's gates), fixture evals against the live model, and a Playwright live path. Test tasks sit next to the code they cover.

**Organization**: Setup → Foundational (includes the provider tests that pick the voice and the reader) → User Story 1 (scan, speak, ask) → User Story 2 (profile and plan) → Polish. The constitution forbids starting Story 2 before Story 1 is demo-ready on a phone.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Include exact file paths in descriptions

## Path Conventions

Single Next.js app at the repository root, per plan.md: `app/` (pages and `app/api/*/route.ts`), `components/`, `lib/{model,rules,speech,storage,i18n}/`, `fixtures/sheets/`, `tests/{unit,e2e,eval}/`, `public/`, `docs/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the app, fixtures and the provider-test harness so decisions can be made by measurement.

- [X] T001 Scaffold the Next.js app (App Router, TypeScript, Tailwind, ESLint) at the repository root with `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --yes`; add `.env.example` listing `ANTHROPIC_API_KEY`, `MODEL_READ`, `MODEL_ASK`, `TTS_PROVIDER`, `STT_PROVIDER`, `MINIMAX_API_KEY`, `MINIMAX_GROUP_ID`, `ELEVENLABS_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`; ensure `.gitignore` covers `.env.local` and `.claude/`
- [X] T002 [P] Install runtime deps `@anthropic-ai/sdk zod opencc-js` and dev deps `vitest @vitest/ui @playwright/test @types/node` in `package.json`; add scripts `test`, `e2e`, `eval`, `lint` per `specs/001-discharge-sheet-agent/quickstart.md`
- [X] T003 [P] Add the import-boundary lint rule (no imports from `lib/model/**` or `@anthropic-ai/sdk` inside `lib/rules/**`) in `eslint.config.mjs` using `no-restricted-imports` with an override for `lib/rules/**`
- [X] T004 [P] Create `public/manifest.webmanifest` (name, short name, standalone display, icons) and `public/icons/icon-192.png`, `public/icons/icon-512.png`; link the manifest and set viewport/theme metadata in `app/layout.tsx`
- [X] T005 [P] Author the synthetic sheets from `specs/001-discharge-sheet-agent/research.md` R-case (72-year-old woman, HT + new T2DM, 3 medicines, 低盐低脂 line, follow-up 2 weeks, 3 warning signs): `fixtures/sheets/hk_en.html` (HKPHA field layout, English, abbreviations) and `fixtures/sheets/cn_zh.html` (出院记录 layout, numbered 出院医嘱); render both to `fixtures/sheets/hk_en.png` and `fixtures/sheets/cn_zh.png` with a headless browser script `fixtures/sheets/render.ts`; photograph the printed `cn_zh` at an angle with a thumb in frame as `fixtures/sheets/cn_zh_photo.jpg`; add `fixtures/sheets/not_a_sheet.jpg` (a menu)
- [X] T006 [P] Write the expected readings `fixtures/sheets/hk_en.expected.json`, `fixtures/sheets/cn_zh.expected.json`, `fixtures/sheets/cn_zh_photo.expected.json` conforming to `specs/001-discharge-sheet-agent/contracts/sheet-reading.schema.json` (medicine fields verbatim; for the photo fixture, list the regions expected to be unreadable)
- [X] T007 [P] Create the provider test harness: `tests/eval/sentences.json` (6 test sentences: 3 Cantonese, 3 Mandarin, per `provider_shortlist.md` section 5), `tests/eval/voices.ts` (renders each sentence through every configured TTS adapter into `tests/eval/out/voices/<provider>/<id>.mp3` and prints latency), `tests/eval/stt.ts` (runs `tests/eval/clips/*.m4a` through each STT adapter and prints transcripts), and result templates `tests/eval/voices.md`, `tests/eval/stt.md`, `tests/eval/reading.md`, `tests/eval/phrasing.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schemas, every rules gate with its tests, the model and speech adapters, storage, shared UI, and the measured provider decisions. No story work starts before this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Define Zod schemas `SheetReading`, `Speakable`, `SourceReference`, `WarningSign`, `Medicine`, `FollowUpItem`, `DietLine`, `TextLine`, `UnreadableRegion`, `AskResult` (`grounded`, `citedCardId`, `answer`), `PhraseResult` in `lib/model/schemas.ts`, mirroring `specs/001-discharge-sheet-agent/contracts/sheet-reading.schema.json`; export the JSON schema for the model's structured output; add `tests/unit/schemas.test.ts` validating all three `fixtures/sheets/*.expected.json`
- [X] T009 [P] Implement the banned-term filter in `lib/rules/banned-terms.ts` (traditional and simplified Chinese terms, English terms, numeric-target patterns, exemption for `SourceReference.quote`; returns matched terms) per research.md R14; tests in `tests/unit/banned-terms.test.ts` covering hits, near-misses, quote exemption and both scripts
- [X] T010 [P] Implement the card builder and fixed ordering in `lib/rules/card-order.ts` (`buildCards(reading): Card[]` with the rule-generated `noWarnings` card, order warnings → medicines → followUp → diet → activity → unreadable) per data-model.md; tests in `tests/unit/card-order.test.ts` using the three expected fixtures
- [X] T011 [P] Implement the diet-line recogniser in `lib/rules/diet-line.ts` (`recogniseDiet(raw) → low_salt | low_fat | diabetic | light | other`, plus the one fixed plain sentence per recognised type in both dialects, nothing for `other`/null) per FR-025; tests in `tests/unit/diet-line.test.ts` including 低鹽/低盐, "low salt diet", "DM diet", 清淡, 低蛋白 → other
- [X] T012 [P] Implement template fallbacks in `lib/rules/template-fallback.ts` (one sentence per card type in `yue` and `cmn`, built only from fact fields, "frequency not printed" variant) per contracts/api-phrase.md; test in `tests/unit/template-fallback.test.ts` asserting every template passes the banned-term filter
- [X] T013 [P] Implement the medicine-change refusal detector in `lib/rules/refusal.ts` (skip/stop/double/add/change-dose patterns in Cantonese, Mandarin, English) and the crisis-keyword detector in `lib/rules/crisis.ts` (returns the referral card text from `lib/i18n/referral.ts`, to be filled with the organisers' resource list); tests in `tests/unit/refusal.test.ts` and `tests/unit/crisis.test.ts`
- [X] T014 Implement the model client and provider adapter in `lib/model/client.ts` (Anthropic SDK client; `readSheet(images)`, `answer(reading, question, dialect)`, `phrase(facts, avoid, dialect)`; model ids from `MODEL_READ`/`MODEL_ASK` env with `claude-opus-5` default; adaptive thinking; `output_config.effort` high for read, medium otherwise; structured output via the exported JSON schema; streaming; `stop_reason` check; server-side refusal fallback beta per the claude-api skill) and the frozen system prompts with a cache breakpoint in `lib/model/prompts.ts` (read prompt: extract only the schema fields, verbatim medicines, `unknown` for non-sheets, colloquial written Cantonese for `yue`; ask prompt: answer only from cards, cite one card id, `grounded:false` otherwise; phrase prompt: restate facts only, avoid listed terms)
- [X] T015 [P] Implement the speech provider interface and server adapters in `lib/speech/providers/types.ts`, `lib/speech/providers/minimax.ts`, `lib/speech/providers/elevenlabs.ts`, `lib/speech/providers/azure.ts` (each exposes `synthesize(text, dialect) → audio bytes` and, where supported, `transcribe(audio, language) → text`), selected by `TTS_PROVIDER`/`STT_PROVIDER` env in `lib/speech/providers/index.ts`
- [X] T016 [P] Implement the client speech layer: `lib/speech/tts.ts` (`speak(text, dialect)`: cloud via `/api/tts` first, browser `speechSynthesis` `zh-HK`/`zh-CN` fallback, on-screen-only signal; per-string session cache; `prefetch(texts)`), and `lib/speech/stt.ts` (`listen(language)`: cloud via `/api/stt` first, browser `SpeechRecognition` fallback, typed-fallback signal)
- [X] T017 [P] Implement device storage in `lib/storage/local.ts` (single key `fitornot.v1`, `{version, consentedAt, profile?, reading?, plan?}`, `deleteEverything()`); tests in `tests/unit/storage.test.ts`
- [X] T018 [P] Create UI strings in `lib/i18n/ui.ts` (zh-Hant, zh-Hans, en; includes the disclaimer wording from `rules.md` section 16 and the agent-limits sentence from FR-022), the script converter in `lib/i18n/script.ts` (opencc-js), the data statement fixture in `lib/i18n/data-statement.ts` per research.md R13; test in `tests/unit/ui-copy.test.ts` asserting every UI string passes the banned-term filter
- [X] T019 [P] Build shared components `components/Disclaimer.tsx` (persistent footer), `components/AiLabel.tsx`, `components/AgentLimits.tsx`, `components/ConsentGate.tsx` (simulated-input notice, one-tap consent stored via `lib/storage/local.ts`), and wire them into `app/layout.tsx` with a dialect/script context provider in `components/LocaleProvider.tsx`
- [ ] T020 Run the provider tests and record the decisions: execute `tests/eval/voices.ts` for every configured TTS adapter, play blind to two Cantonese speakers and one Mandarin speaker, record scores and the pick in `tests/eval/voices.md`; execute `tests/eval/stt.ts`, record in `tests/eval/stt.md`; run `tests/eval/reading.ts` (from T031, can be brought forward) for `claude-opus-5` and `claude-sonnet-5` on all three fixtures, record field accuracy, invented items, latency and Cantonese phrasing rating in `tests/eval/reading.md` and `tests/eval/phrasing.md`; set `TTS_PROVIDER`, `STT_PROVIDER`, `MODEL_READ`, `MODEL_ASK` defaults in `.env.example` and `lib/speech/providers/index.ts` accordingly

**Checkpoint**: Schemas, all gates with green tests, adapters, storage, shared UI, and provider picks recorded. Story 1 can start.

---

## Phase 3: User Story 1 - Hear the sheet in her language, then ask it questions (Priority: P1) 🎯 MVP

**Goal**: Photograph a discharge sheet, hear the cards in Cantonese or Mandarin with warning signs first and every card traceable to a source line, then ask questions answered only from the cards, with refusals and crisis referral handled before the model.

**Independent Test**: Quickstart V1 to V7. On the bundled Hong Kong English sheet a Cantonese-speaking tester can restate the three warning signs and the follow-up date after one listen; the ten-question set produces the specified outcomes; every fallback is reachable in two taps.

### Implementation for User Story 1

- [X] T021 [US1] Implement `POST /api/read` in `app/api/read/route.ts` per `specs/001-discharge-sheet-agent/contracts/api-read.md`: accept 1–2 base64 images (8 MB limit, 413 on excess), decode in memory only, call `readSheet` from `lib/model/client.ts`, validate with Zod (one retry, then 422), set `dietLine.recognisedType` via `lib/rules/diet-line.ts`, build cards via `lib/rules/card-order.ts`, run `lib/rules/banned-terms.ts` on every `Speakable` (hit → `phrase` regenerate once → template), stream NDJSON `status`/`card`/`unknown`/`done` events in fixed order, never log bodies, 502 on model failure
- [X] T022 [P] [US1] Implement `POST /api/phrase` in `app/api/phrase/route.ts` per `contracts/api-phrase.md` (facts + avoid list → `phrase` → filter → template fallback with `filtered:true`)
- [X] T023 [P] [US1] Implement `POST /api/tts` in `app/api/tts/route.ts` (text + dialect → audio bytes from the selected provider in `lib/speech/providers/index.ts`; `Cache-Control: private, max-age=3600`; reject bodies over 2 kB; no text logging) and `POST /api/stt` in `app/api/stt/route.ts` (audio clip + language → transcript)
- [X] T024 [US1] Implement `POST /api/ask` in `app/api/ask/route.ts` per `contracts/api-ask.md`: run `lib/rules/crisis.ts` then `lib/rules/refusal.ts` before any model call, call `answer` with the cards, enforce grounding server-side (`grounded:false` or unknown `citedCardId` → `not_on_sheet` template), filter the answer, stream `outcome`/`answer`/`done` events
- [X] T025 [P] [US1] Build `components/Capture.tsx`: `<input type="file" accept="image/*" capture="environment">`, client-side downscale to 1600 px long edge JPEG 0.85 via canvas in `lib/image/downscale.ts`, "add second page", photo-library fallback when the camera is denied, typed-sheet fallback (paste text) as the last resort, and a "use a sample sheet" button that loads `fixtures/sheets/*.expected.json` marked as a sample
- [X] T026 [P] [US1] Build the card UI: `components/Card.tsx` (title, body in the active script, AI label, play button, source link), `components/CardStack.tsx`, `components/SourceSheet.tsx` (bottom sheet showing section, line index, verbatim quote), `components/SpeakButton.tsx` (uses `lib/speech/tts.ts`, shows on-screen-only state when speech is unavailable)
- [X] T027 [US1] Build the read page `app/read/page.tsx`: submit images to `/api/read`, consume the NDJSON stream, render cards as they arrive in fixed order, prefetch TTS for each card on arrival, auto-play the first (warning) card after the user's tap, handle `unknown` with the decline state and retry, handle 422/502 with the sample-sheet offer, keep the reading in memory (and in storage once US2 lands) without ever storing the image
- [X] T028 [P] [US1] Build the ask UI: `components/MicButton.tsx` (push-to-talk via `lib/speech/stt.ts`, interim text, typed box always visible, three-way input language toggle) and `app/ask/page.tsx` (client-side crisis and refusal pre-check mirroring the server, submit to `/api/ask`, render outcome cards: answer with cited card and source sheet, refusal with pharmacist/contact line, not-on-sheet template, referral card; speak the answer via `lib/speech/tts.ts`)
- [X] T029 [US1] Build the home page `app/page.tsx` (consent gate → session dialect pick → capture) and navigation read → ask, with the agent-limits line visible on the read page via `components/AgentLimits.tsx`
- [X] T030 [P] [US1] Write `tests/unit/reading-pipeline.test.ts`: from each `fixtures/sheets/*.expected.json`, run recognise → buildCards → filter and assert card order, `noWarnings` insertion when warnings are empty, unreadable cards present for the photo fixture, zero banned terms
- [X] T031 [P] [US1] Write the reading eval runner `tests/eval/reading.ts` (`npm run eval -- --sheets all --runs N --model <id>`): posts each fixture to `/api/read`, diffs against expected per field, counts invented and missing medicines, records latency to first card and to done, scans all strings with the filter, appends a summary to `tests/eval/results.md`
- [X] T032 [P] [US1] Write `tests/eval/questions.json` (10 questions: 4 Cantonese, 3 Mandarin, 3 English, with expected outcomes) and the runner `tests/eval/questions.ts` posting each to `/api/ask` with the `hk_en` expected reading and asserting outcome and citation
- [X] T033 [P] [US1] Write the Playwright live path `tests/e2e/live-path.spec.ts` at 390×844 with `/api/read` and `/api/ask` mocked from fixtures: consent → sample sheet → cards in order → source sheet opens → decline state for `not_a_sheet` → ask flow shows refusal without a network call → typed fallback when microphone is unavailable
- [ ] T034 [US1] Verify and complete every failure path from quickstart V7 (camera denied → library → typed; STT failure → typed; TTS failure → on-screen text; model 502 → sample sheet) by exercising each on a phone and fixing gaps in `components/Capture.tsx`, `lib/speech/tts.ts`, `lib/speech/stt.ts`, `app/read/page.tsx`

**Checkpoint**: Story 1 is demo-ready on a phone: quickstart V1–V7 pass, `npm test`, `npm run e2e` and `npm run lint` are green, eval results recorded. Only now may Story 2 begin (constitution workflow rule).

---

## Phase 4: User Story 2 - Remember who she cooks for, and confirm the follow-up plan (Priority: P2)

**Goal**: A two-screen profile (relationship label, dialect) stored only on the phone, and a follow-up plan built solely from the sheet's source lines that the user confirms before it is saved, with an expiry notice and a delete-everything control.

**Independent Test**: Quickstart V8 and V9. Setup completes in under 30 seconds; the plan matches the sheet verbatim and saves only on confirm; the expiry notice appears when the device date passes the follow-up date; delete-everything leaves no `fitornot.v1` key; no request carries the label or plan dates.

### Implementation for User Story 2

- [X] T035 [P] [US2] Build the setup flow `app/setup/page.tsx` (screen 1 label with suggested chips 阿媽/阿爸/老豆/家婆, max 12 chars, no name prompt; screen 2 dialect and script; the one-line privacy statement on both screens) saving via `lib/storage/local.ts`; redirect first launches to setup after consent
- [X] T036 [P] [US2] Implement plan derivation in `lib/rules/plan-from-reading.ts` (`draftPlan(reading) → PlanItem[]` from follow-up items and medicines with non-null frequency, each carrying its `SourceReference`; `parseFollowUpDate(when, readAt)` returning a date only for unambiguous forms like "2/52", "2 周后", explicit dates; `isExpired(plan, today)`); tests in `tests/unit/plan-from-reading.test.ts` including ambiguous inputs returning null
- [X] T037 [US2] Build the plan page `app/plan/page.tsx`: draft list with verbatim `when`/`frequency` and source links, nothing persisted until "confirm", confirmed state, expired notice ("the sheet's instructions were written for the period up to that visit, ask at follow-up"), optional "add to calendar" generating an `.ics` file client-side in `lib/plan/ics.ts`
- [X] T038 [US2] Build the settings page `app/settings/page.tsx`: render `lib/i18n/data-statement.ts`, `components/AgentLimits.tsx`, script toggle, and "delete everything" with a confirm step calling `deleteEverything()` and redirecting to setup
- [X] T039 [US2] Personalise Story 1 with the profile: read page and ask page take dialect from storage, spoken sentences address the label (template and prompt variable applied client-side after the response, so the label is never sent), and the most recent reading is persisted under `fitornot.v1`; add `tests/unit/privacy.test.ts` asserting the request bodies built for `/api/read`, `/api/ask`, `/api/tts` contain no `label`, no plan dates and no image after read
- [X] T040 [P] [US2] Write the Playwright flow `tests/e2e/profile-plan.spec.ts`: setup under 30 s of interactions, plan draft → confirm → storage contains plan, date past follow-up → expiry notice, delete everything → key absent → setup shown

**Checkpoint**: Stories 1 and 2 both pass their quickstart scenarios; `npm test`, `npm run e2e`, `npm run lint` green.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Latency, deployment, the venue fallback, the submission pack and the demo rehearsal.

- [ ] T041 [P] Measure and tune the live path: time shutter → first spoken card on the demo phone over mobile data, confirm prompt caching via `usage.cache_read_input_tokens` on the second read, tune TTS prefetch concurrency in `lib/speech/tts.ts` and first-card auto-play in `app/read/page.tsx`; record numbers in `tests/eval/results.md` against SC-001 and SC-006
- [x] T042 [P] Deploy to Vercel (project link, env vars `ANTHROPIC_API_KEY`, provider keys, `MODEL_*`, `TTS_PROVIDER`, `STT_PROVIDER`), verify from a phone on mobile data, generate a QR code to `docs/qr.png`, and document the laptop fallback (`next build && next start`, hotspot, LAN QR) in `README.md`
- [X] T043 [P] Write the submission pack in `docs/submission/`: `project.md` (problem, target user, solution, where AI carries the load, tech stack, team roles), `ethics-compliance.md` (facts-not-verdicts, red flags first, refusal behaviour, no emotional-support surface, crisis referral), `data-statement.md` (copied from `lib/i18n/data-statement.ts`, naming the model, voice and transcription providers and cross-border processing), `originality.md` (open-source components with licences, model providers, nothing reused from a shipped product, synthetic fixtures authored by the team), `model-vs-rules.md` (which outputs are model-generated and which are rules)
- [X] T044 Write the five-minute demo script and backup-video checklist in `docs/demo-script.md` (hook with the unreadable English sheet, live read with Cantonese warning card first, one question answered aloud, one refusal, the "remove the AI" answer, the concession, compliance in one breath; video ≤ 3 minutes with one continuous real run)
- [ ] T045 Run `specs/001-discharge-sheet-agent/quickstart.md` V1–V9 end to end on the demo phone, fix anything that fails, and record the pass table in `tests/eval/results.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T002–T007 can run in parallel after T001
- **Foundational (Phase 2)**: Depends on Phase 1. T008 first (schemas); T009–T013 and T015–T019 in parallel after T008; T014 after T008; T020 last (needs T005–T007, T014, T015 and the reading eval runner from T031, which may be written early)
- **User Story 1 (Phase 3)**: Depends on Phase 2 complete
- **User Story 2 (Phase 4)**: Depends on Story 1 checkpoint (constitution rule), not merely on Phase 2
- **Polish (Phase 5)**: Depends on Story 1; T042–T044 can start once Story 1 is stable, T045 last

### User Story Dependencies

- **User Story 1 (P1)**: Foundational only. Delivers the MVP on its own.
- **User Story 2 (P2)**: Integrates with Story 1 pages (dialect and label) but is testable on its own through setup, plan and settings pages with a fixture reading.

### Within Each User Story

- Routes before pages that consume them (T021/T024 before T027/T028)
- Components before pages (T025/T026 before T027; T028's MicButton before its page)
- Evals and e2e after the pages exist (T030–T033 may be authored early and run late)
- Failure-path verification (T034) closes the story

### Parallel Opportunities

- Phase 1: T002, T003, T004, T005, T006, T007 together after T001
- Phase 2: T009, T010, T011, T012, T013, T015, T016, T017, T018, T019 together after T008
- Story 1: T022, T023, T025, T026 together after T021 is started; T030, T031, T032, T033 together once routes exist
- Story 2: T035, T036, T040 together
- Polish: T041, T042, T043 together

---

## Parallel Example: User Story 1

```bash
# After T021 (read route) is in progress, launch in parallel:
Task: "Implement POST /api/phrase in app/api/phrase/route.ts"
Task: "Implement POST /api/tts and /api/stt in app/api/tts/route.ts and app/api/stt/route.ts"
Task: "Build components/Capture.tsx with downscale and fallbacks"
Task: "Build components/Card.tsx, CardStack.tsx, SourceSheet.tsx, SpeakButton.tsx"

# Once pages exist, launch the checks in parallel:
Task: "tests/unit/reading-pipeline.test.ts"
Task: "tests/eval/reading.ts"
Task: "tests/eval/questions.ts"
Task: "tests/e2e/live-path.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup, including fixtures and the provider-test harness
2. Phase 2 Foundational, ending with the measured picks for voice, transcription and reader model (T020)
3. Phase 3 Story 1: routes → components → pages → evals → failure paths
4. **STOP and VALIDATE**: quickstart V1–V7 on the demo phone; tests and lint green
5. Deploy and rehearse; this alone is a complete, compliant entry

### Incremental Delivery

1. Setup + Foundational → gates proven by tests, providers chosen by ear and by eval
2. Story 1 → demo-ready MVP
3. Story 2 → profile, plan, settings, privacy test
4. Polish → latency numbers, deployment, submission pack, demo script, full quickstart run

### Solo Strategy (one builder with AI assistance)

Work strictly in phase order. Inside a phase, take the parallel groups as batches. Do not open Story 2 files until the Story 1 checkpoint is recorded in `tests/eval/results.md`. If time runs short, the roadmap items in spec.md's "Later" section stay closed; the demo is Story 1 plus whatever of Story 2 is green.

---

## Notes

- [P] tasks = different files, no dependencies
- Every `lib/rules/*` task ships with its unit test in the same task; these are the constitution's gates
- No task may log request bodies, persist the image, or send profile fields to any route (Principle V); T039 adds the test that enforces it
- Commit after each task or parallel batch
- Stop at each checkpoint and validate before continuing
