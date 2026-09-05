# Originality and Disclosure

## Open-source components

Licences read from each package's own `package.json` in `node_modules/`, not from memory.

| Component | Licence | Use |
| --- | --- | --- |
| Next.js 16.3, React 19.2, React DOM | MIT | Application framework and UI |
| Tailwind CSS 4, @tailwindcss/postcss | MIT | Styling |
| Zod 4 | MIT | Schemas for the model's structured output and for request validation |
| @anthropic-ai/sdk | MIT | Model API client |
| opencc-js | MIT AND Apache-2.0 | Traditional / simplified script conversion for on-screen text |
| babel-plugin-react-compiler | MIT | Build tooling |
| TypeScript | Apache-2.0 | Language and typecheck |
| ESLint, eslint-config-next | MIT | Linting, including the rules-must-not-import-model boundary |
| Vitest | MIT | Unit tests |
| Playwright | Apache-2.0 | Phone-viewport browser tests |
| tsx | MIT | Running TypeScript scripts (evals, fixture rendering) |
| Instrument Sans (via `next/font/google`, Latin subset) | SIL Open Font License 1.1 | Latin text. Self-hosted at build time, so the phone never contacts Google |

Chinese type uses the system stacks already on the device (PingFang HK / TC / SC, Noto Sans CJK
HK / SC). No CJK webfont is downloaded — a multi-megabyte font download on venue wifi is a failed
demo.

## Model and service providers

- **Reading, answering and phrasing**: Anthropic Claude Sonnet 5 (`anthropic/claude-sonnet-5`)
  through the Vercel AI Gateway (AI SDK 6, structured outputs, prompt caching). The model is one
  environment variable per route; the deployed build runs Sonnet 5 for both since 4 September.
- **Opus 5 was the measured pick; Sonnet 5 is what is deployed, and the gap is on record.** In
  the 44-run comparison Sonnet 5 matched Opus on every medicine field and beat it on two of the
  four hard fixtures, but dropped a warning sign on both of its completed `messy` runs and produced
  the only hard failure. On 4 September the Anthropic organisation's spend cap was reached and
  every model call moved to the Vercel AI Gateway, where the deployed build runs Sonnet 5 for
  reading and answering. Re-measured on that build the same evening (Sonnet 5 through the Gateway):
  the `hk_en` fixture 3/3 medicines verbatim, warning coverage 100%; and all three demo fixtures in
  `fixtures/demo/` clean — `hk_stopped` 8/8 medicines exact with all three withdrawn drugs marked
  stopped, the two-page `hk_stack` 5/5 with both appointments, `cn_zh_clinic` 5/5 with the
  uncountable dose clause left uncounted; warning signs 3/3 on each. **Photographed sheets read again on the deployed build** (`69450f2` and later, promoted 5 September 03:19 UTC): the request goes to the Gateway's Anthropic-compatible endpoint with the same schema-enforced output and `effort: medium` the baselines were measured with (`lib/model/anthropic-compat.ts`). Measured on production from this Mac: the `cn_zh_photo` fixture, which failed 2 of 2 runs on the evening's earlier build, reads in 46–48 s with all three medicines, the warning sign and the one unreadable field matching the answer key; three server-side read completions in the same window at 27.6–43.6 s, none rejected by the schema. The `messy` stress photo — the same page deliberately rotated, blurred, shadowed and with a thumb over two cells — **now completes on the deployed build** (`a08a5ca` and later, 5 September): measured on production alone on the key, 203 s, all four warning signs, every medicine on the truth sheet named with its status right (eight current, four withdrawn marked stopped), and the thumb-covered cell flagged as unreadable rather than guessed. The cause of the earlier failure is on record: at `max_tokens` 16 000 the model's thinking on that photo consumed the whole budget before the reply began (`stop_reason: max_tokens` on a replay of the exact request), so reads now carry a 64 000 cap, a single attempt and a 280 s budget. It is slow — about three and a half minutes for a photograph that bad, against 30–50 s for a clean one — and that is stated, not hidden. On the original direct client the same photo read in 102–111 s with one recorded truncation failure (`tests/eval/stress.md`). The demo does not photograph that sheet. Effort was dropped from `high` to `medium` on
  the original evidence: identical readings,
- **Voice**: MiniMax `speech-2.8-hd` through its international endpoint, behind a provider adapter.
  ElevenLabs and Azure Speech adapters are written and switchable by one environment variable; the
  phone's own `speechSynthesis` is the fallback and the shipped default. **The blind listening test
  has not been run** — `tests/eval/voices.md` still ends "PICK: not decided". MiniMax is verified to
  render Cantonese, Mandarin and English at about 2 s a sentence. MiniMax intermittently refuses a Mandarin request in-band (an HTTP 200 carrying a non-zero `base_resp.status_code` and no audio: 5 of 11 Mandarin calls on the evening of 4 September, Cantonese and English clean); since `a79a6d8` the adapter retries once on such a refusal and logs the numeric code, and the on-screen text is the fallback either way. **MiniMax is prepaid**: an empty balance silences the voice (every request answers `base_resp 1008`, the route answers 502, the phone shows the line as text and says so) and a top-up restores it without a redeploy — this happened on 5 September at about 01:20 and is on the pre-stage checklist; `TTS_PROVIDER=browser` in the deployment's environment is the switch to the phone's own voice if the balance cannot be restored; whether the Cantonese voice sounds
  like a daughter rather than a newsreader has not been judged.
- **Speech input**: one engine per hold. The question is recorded while the bar is held and
  transcribed by OpenAI (`gpt-4o-mini-transcribe`) behind the same adapter pattern; the browser's
  own `SpeechRecognition` is the fallback when recording is unavailable, and typing is always
  there. `STT_PROVIDER=browser` keeps the audio on the phone.

## What was built for this entry

All application code, the extraction schema and prompts, every rule (banned-term filter, card
order, diet recogniser, medicine-change refusal, crisis detector, dose counting, plan derivation,
sheet titling, the sheets store), the speech adapters, the whole interface in three locales, the
three clean synthetic sheets and the four hard stress fixtures with their answer keys, the eval
runners, the 1060 unit tests and 92 browser tests, and the written material (constitution, spec,
plan, design brief, v2 build brief, review log, this pack) were created for this entry. Nothing is
a re-skin of a shipped product, and no part of it existed before the event week.

## Pre-event assets and timeline

Three research documents were prepared before the sprint and are in the repository:
`discharge_sheet_formats.md` (a survey of Hong Kong and mainland discharge-sheet layouts),
`provider_shortlist.md` (model and voice provider candidates) and `design.md` (the interaction
brief). No other pre-existing asset is used.

`docs/real-sheet-evidence.md` and the two PDFs in `docs/reference/` are public Hospital Authority
material and a published open-access study, gathered during the event week and cited, not
reproduced.

Development began on 2026-09-02 and the repository's first commit is 2026-09-03. Commits are
coarse — three of them, in large batches — so the git log shows the shape of the week rather than a
fine-grained trail: the initial build, the move from two screens to one conversation, and the
three-tab rebuild on 2026-09-04. If the hackathon's official online window opens after 2026-09-02,
the code written before kickoff is a pre-event asset and the git history is the record of what was
added during the event week.

## AI-assisted development, disclosed

The code was written with AI assistance — Claude Code, with subagents implementing tasks against
the written constitution and a reviewer pass over each story. That is disclosed here rather than
implied. The specifications, the constitution, the design decisions, the product judgements and
every measurement in this pack are the entrant's own; `docs/review-notes.md` is the running log of
what was found, changed and rejected.

## Demo authenticity

The demo runs the real pipeline against synthetic sheets: real model calls, real rules, real
refusals. No click-through hotspots, no canned output. Which outputs are model-generated and which
are rules is stated on screen (the AI chip, present only on model-written messages) and in full in
`model-vs-rules.md`.

The backup video required by `rules.md` section 9 must be **one continuous real run**, not an
edited montage. One is recorded: `docs/backup-video/mingming-backup-2026-09-05.mp4` (2 min 43 s,
outside the repository, with a README and a timestamped run log) — a single continuous Playwright-
driven run of the deployed app at phone viewport, build `394c0ea`, synthetic sheet, every reader
turn typed, no audio track. A phone recording with the voice, made at the venue, should sit beside it.

Two things about the demo that judges should hear rather than discover:

1. Every sheet shown is one we wrote. The app has never read a real discharge summary.
2. If the model route is unreachable, the app falls back to bundled sample readings, and the banner
   says so on screen. That is the documented failure path (`rules.md` section 8), not a hidden one.
