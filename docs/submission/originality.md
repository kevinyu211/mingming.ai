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
  uncountable dose clause left uncounted; warning signs 3/3 on each. The `messy` fixture's
  warning-sign risk from the original comparison has not been re-run through the Gateway and is
  the one item still open. Effort was dropped from `high` to `medium` on
  the original evidence: identical readings,
- **Voice**: MiniMax `speech-2.8-hd` through its international endpoint, behind a provider adapter.
  ElevenLabs and Azure Speech adapters are written and switchable by one environment variable; the
  phone's own `speechSynthesis` is the fallback and the shipped default. **The blind listening test
  has not been run** — `tests/eval/voices.md` still ends "PICK: not decided". MiniMax is verified to
  render Cantonese, Mandarin and English at about 2 s a sentence; whether the Cantonese voice sounds
  like a daughter rather than a newsreader has not been judged.
- **Speech input**: a hybrid. The browser's own `SpeechRecognition` puts the words on screen while
  the same audio is recorded and transcribed by OpenAI (`gpt-4o-mini-transcribe`) behind the same
  adapter pattern, with a typed fallback. `STT_PROVIDER=browser` keeps the audio on the phone.

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
edited montage. It is not in the repository at the time of writing; recording it is a remaining
task before submission.

Two things about the demo that judges should hear rather than discover:

1. Every sheet shown is one we wrote. The app has never read a real discharge summary.
2. If the model route is unreachable, the app falls back to bundled sample readings, and the banner
   says so on screen. That is the documented failure path (`rules.md` section 8), not a hidden one.
