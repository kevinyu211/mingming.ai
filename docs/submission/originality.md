# Originality and Disclosure

## Open-source components

| Component | Licence | Use |
| --- | --- | --- |
| Next.js, React, React DOM | MIT | Application framework and UI |
| Tailwind CSS, @tailwindcss/postcss | MIT | Styling |
| Zod | MIT | Schemas for the model's structured output and validation |
| @anthropic-ai/sdk | MIT | Model API client |
| opencc-js | MIT | Traditional/Simplified script conversion for on-screen text |
| TypeScript, ESLint, eslint-config-next | Apache-2.0 / MIT | Tooling |
| Vitest | MIT | Unit tests |
| Playwright | Apache-2.0 | End-to-end tests |
| tsx | MIT | Running TypeScript scripts (evals, fixture rendering) |

## Model and service providers

- Reading, answering and phrasing: Anthropic Claude Opus 5 (`claude-opus-5`) via the official SDK,
  with the server-side refusal fallback enabled. Sonnet 5 is a one-line switch if the fixture eval
  shows equal medicine-field accuracy.
- Voice and transcription: chosen by a blind listening test from MiniMax Speech, ElevenLabs v3 and
  Azure Speech (`tests/eval/voices.md` records the choice); browser speech APIs as fallback.

## What was built for this entry

All application code, the extraction schema, the prompts, the rules (banned-term filter, card order,
diet recogniser, refusal and crisis detectors, plan derivation), the speech adapters, the UI, the
three synthetic discharge sheets and their expected readings, the eval runners, the tests, and the
documents (spec, plan, constitution, design brief) were created for this entry. Nothing is a re-skin
of a shipped product.

## Pre-event assets and timeline

Research documents (a literature review on post-discharge medication problems and nutrition, an idea
validation memo, a survey of discharge sheet formats) were prepared before the sprint and are in the
repository. Development with AI assistance began on 2026-09-02. If the hackathon's official online
window opens after that date, the code written before kickoff is a pre-event asset and the git
history is the record of what was added during the event week, as the rules require.

## Demo authenticity

The demo runs the real pipeline on synthetic sheets. The backup video is one continuous real run.
Which outputs are model-generated and which are rule-generated is stated on screen (the AI label)
and in `model-vs-rules.md`.
