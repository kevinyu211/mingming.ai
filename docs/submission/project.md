# 聽得明 · Discharge Sheet Agent — Project Description

**Track**: Vital (Soft Healthcare), AIx Origin Summit. **Direction**: A, 健康信息赋能与可及性.
**Team**: Kevin Yue (solo; product/demo lead and compliance lead).

## The problem

A family leaves hospital holding one page: the discharge sheet. In Hong Kong public hospitals it is
usually in English medical shorthand ("HT, T2DM on OHA, FU SOPD 2/52"); on the mainland it is a
dense 出院记录 whose 出院医嘱 lines nobody unpacks. The adult child reads it slowly; the parent, who
has to live by it, cannot read it at all. The Hospital Authority's own discharge checklist expects
patients to leave knowing their medicines and dosage, the warning signs, the follow-up arrangement
and the foods to avoid, and prints that list precisely because families routinely do not.

## Target user

Anyone who walks out of a Hong Kong hospital holding a page they cannot read. In practice that is a
patient in their sixties or seventies, and often the adult child helping them.

There is **one flow, and no modes**. Big type, one action per screen, voice everywhere, nothing to
configure — designed so a 72-year-old can do it alone, and so a daughter doing it for them never
notices it was built for her mother. That is a deliberate answer to the evidence: internet health
information measurably fails to reach elderly, low-education and rural users. This is not reading.
It is one button and a voice.

## What it does

1. **Photograph the sheet.** One or two pages, downscaled on the phone, read by a vision model into
   a fixed structure.
2. **Hear it in her language.** Cards spoken in Cantonese, Mandarin or English, in this fixed order: warning
   signs that mean "go back to hospital now", then each medicine exactly as printed (name, strength,
   amount, frequency), follow-up, the diet line, activity, and anything the app could not read.
3. **Every card points at the page.** A "from the page" link shows the verbatim line and section it
   came from. Unreadable regions are shown as "I couldn't read this part", never guessed.
4. **Ask it questions.** Push-to-talk or type, in Cantonese, Mandarin or English; the answer is
   grounded in one card, cites it, and is spoken in the parent's dialect. Questions the sheet does
   not answer get "the sheet doesn't say". Questions about changing, skipping or adding a medicine
   are refused and routed to the pharmacist or the number on the sheet.
5. **It remembers.** The last few sheets and questions stay on the phone, so re-opening it days later the agent already knows this person's medicines, follow-up and what was asked before. Nothing about who they are is kept, and one button wipes it.
6. **Remember and plan.** A two-field profile (who you cook for, which dialect) and a follow-up plan
   built only from the sheet's own dates and frequencies, saved only after the user confirms, with
   an expiry notice after the follow-up date.

## Where the AI carries the load

Two jobs, both language problems: turning a photographed page of abbreviations into structured,
verbatim fields, and writing what a daughter would say to her mother in colloquial Cantonese or
plain Mandarin. Remove the model and what remains is a rulebook with nothing to read.

Everything that decides what the user is told is deterministic code: the card order, the banned-term
filter, the diet-line recogniser, the medicine-change refusal, the crisis referral, grounding
verification against server-built card ids, and plan derivation. See `model-vs-rules.md`.

## Tech stack

Next.js 16 (App Router) on Node.js; TypeScript; Zod 4 schemas shared by the model's structured output
and the client; Claude Opus 5 through the official Anthropic SDK (vision, structured outputs,
streaming, prompt caching, server-side refusal fallback); Tailwind CSS 4; MiniMax cloud
text-to-speech behind a provider adapter, with the phone's own voice as fallback; speech recognition
with a typed fallback; browser storage only, including the memory. Vitest (802 unit tests),
Playwright (56 phone-viewport tests), and fixture evals run against the live model.

## Team roles

Solo entry. Product and demo lead: Kevin Yue. Compliance lead: Kevin Yue. Engineering was done with
AI-assisted development (Claude Code with subagents implementing tasks and a reviewer pass against
the project constitution); the design brief, spec, plan, constitution and review log are in the
repository.

## Status and honest limits

- Measured against the live model on three synthetic sheets: every printed medicine reproduced
  verbatim, nothing invented, nothing missed; 25–29 s from photo to spoken cards; 12 of 12 questions
  resolved to the right outcome, 3.3 s median; zero banned-term hits across every run. Cantonese,
  Mandarin and English speech render in about two seconds a sentence.
- Still unmeasured: the blind voice listening test, and every on-device check (real camera, real
  playback, speech input on iOS Safari).
- Two sheet formats are supported (Hong Kong English, mainland Chinese 出院记录); other documents are
  roadmap items.
- Cantonese, Mandarin and English output. Other dialects are roadmap items.
- The dish check ("does tonight's meal fit the diet line"), share card, parent-facing voice mode,
  medicine-box reader and lab reports are designed and deliberately not built for the sprint.
