<!--
Sync Impact Report
- Version change: (template, unversioned) → 1.0.0
- Modified principles: none (initial ratification)
- Added sections:
  - Core Principles I–VI (Facts Not Verdicts; Red Flags First; Model Reads, Rules Decide;
    Everything Traces to a Line; Nothing Leaves the Phone; Banned Words Are Enforced)
  - Hackathon Compliance Constraints
  - Development Workflow
  - Governance
- Removed sections: none
- Templates requiring updates: none checked in this pass (plan/spec/tasks templates read the
  constitution at runtime; verify the Constitution Check gate in plan-template on first
  /speckit-plan run) ✅ no edits pending
- Follow-up TODOs: none
-->

# Fit or Not Constitution

Working name for a solo hackathon build in the Vital (Soft Healthcare) track of the AIx Origin
Summit, Hong Kong, September 2026. The product is a mobile web app: photograph a hospital
discharge sheet (Hong Kong English or mainland Chinese), hear it explained in the parent's
dialect (Cantonese or Mandarin), red flags first, medicines as printed, follow-up turned into
reminders, the diet line unpacked, and grounded questions about the sheet. This document
governs every spec, plan, task and line of code in the project.

## Core Principles

### I. Facts About the Page, Never Verdicts About the Person

Every card, sentence and spoken line MUST transcribe or rephrase what the discharge sheet says.
The app MUST NOT diagnose, MUST NOT set personal targets (grams, calories, readings, doses),
MUST NOT tell the user what they should do beyond what the sheet already instructs, and MUST
NOT collect a diagnosis as input. The only health input the app accepts is the sheet itself and
the doctor's own instruction line. Rationale: the track rules bar diagnosis, treatment and
prescription language and score compliance as a gate; a verdict about the person is the single
way this product could harm someone.

### II. Red Flags First

On every sheet, the warning signs that mean "return to hospital now" MUST be extracted, shown
and spoken before any other card. If no warning signs are printed, the app MUST say so and show
the hospital contact line instead. Rationale: the one output whose omission can cost a life is
never allowed to sit below the fold.

### III. The Model Reads and Phrases; Rules Decide

Language models MAY be used only for two jobs: extracting structured fields from the photographed
sheet, and phrasing sentences in the target dialect. Every behavior gate MUST be deterministic
code: the specialized-diet lock, the banned-term filter, the unreadable-region handling, the
"no diet line" refusal, and the follow-up date logic. A model output MUST NOT decide whether a
card is shown. Rationale: a hallucinated gate is a safety failure, not a bad answer, and the
pitch must be able to state exactly which outputs are model-generated and which are rules.

### IV. Everything Traces to a Line

Every card and every spoken sentence MUST carry a reference to the source line or region on the
page, and the UI MUST let the user see it. When a region cannot be read, the app MUST output
"I couldn't read this part" for that region and MUST NOT fill the gap with a guess. Sheet types
the app does not recognise MUST produce an explicit "this doesn't look like a discharge sheet"
state, not a best-effort summary. Rationale: provenance is what turns a summarizer into a
product a family can trust, and refusal is the transparency behavior the rules reward.

### V. Nothing Leaves the Phone Except the Question

The kitchen profile (relationship label, doctor's instruction line, follow-up date, chewing
level, foods to avoid, location, dialect) MUST be stored only on the device. The sheet image
MUST be discarded immediately after extraction and MUST NOT be stored or logged. Each model call
MUST carry only the data the current question needs and MUST NOT include the profile label,
dates, or any identifier. There MUST be no accounts and no server-side storage in the sprint
build. A "delete everything" control MUST exist. The submission's data statement MUST name the
model provider, what is sent, and whether it crosses a border. Rationale: the rules require data
minimisation, forbid uploading personal data to unassessed third parties, and require a
cross-border disclosure; on-device storage satisfies all three with one sentence.

### VI. Banned Words Are Enforced, Not Requested

Every generated string MUST pass a banned-term filter before it is shown or spoken. The list
MUST include at minimum: 诊断, 治疗, 处方, 治愈, 能吃, 不能吃, their traditional-character
forms, their English equivalents (diagnose, treat, cure, prescribe), and any numeric target about
the person. On a hit the app MUST regenerate once and then fall back to a fixed template. The
product name, UI copy, marketing copy and pitch script MUST obey the same list. Rationale: the
negative list in the track rules eliminates entries for this language regardless of intent, so
the guarantee has to be structural.

## Hackathon Compliance Constraints

- Demo data MUST be synthetic: fictional patients, fictional hospitals, sheets authored by the
  team. No real discharge sheet, medical record or audience health information may be used,
  stored or shown.
- A simulated-input notice with a one-tap consent MUST appear before any health-related input,
  and a prominent disclaimer MUST be visible on every screen and appended to every spoken
  output, using the wording in `rules.md` section 16.
- AI-generated content MUST be labelled as such with an inaccuracy caution, and generated text
  MUST be editable or discardable before it is spoken.
- Any agent behavior (reminders, schedules) MUST derive every date and time from the sheet, MUST
  require user confirmation before saving, MUST NOT alter doses, and MUST NOT message, book or
  contact anyone. The UI MUST state what the agent can and cannot do.
- The app MUST NOT offer emotional support or invite emotional disclosure; a crisis-keyword
  fallback that shows the organisers' referral resources MAY be added as insurance.
- Open-source components, their licences, the model provider and the food or nutrient data
  sources MUST be disclosed in the submission. Nothing may be a re-skin of a shipped product.
- The rulebook in `rules.md` and `Vital_活域_赛制与评审细则.md` is the authority; where this
  constitution and the rulebook differ, the rulebook wins and this document MUST be amended.

## Development Workflow

- One live path, polished, before any second feature: photograph the sheet → red flags →
  medicines as printed → follow-up → diet line → spoken in the chosen dialect. No second
  feature (food check, share card, medicine-box reader, lab reports) starts until this path is
  demo-ready on a phone over a venue-grade network.
- Every feature spec MUST state which outputs are model-generated and which are rule-generated.
- Every plan MUST pass a Constitution Check against Principles I–VI before tasks are generated.
- Failure paths are features: camera fails → type; speech input fails → type; model API fails →
  bundled sample sheet; speech output fails → on-screen text. Each MUST be demoable.
- Synthetic sheets (Hong Kong English, mainland Chinese, and a badly photographed copy) are
  test fixtures and MUST be kept in the repo with the code that parses them.
- Cantonese and Mandarin output are both first-class from the first working build; other
  dialects are roadmap items.

## Governance

This constitution supersedes every other practice in the project. Principles I–VI are
non-negotiable for the duration of the hackathon sprint and MUST NOT be relaxed to ship a
feature. Amendments are made by editing this file with a version bump: MAJOR for removing or
redefining a principle, MINOR for adding a principle or materially expanding guidance, PATCH for
wording. Any amendment touching Principles I–VI MUST also update the cross-reference in
`rules.md` usage and the submission data statement. Every spec, plan and task list MUST include
a compliance check against this document, and any complexity that violates the Development
Workflow MUST be justified in writing in the plan.

**Version**: 1.0.0 | **Ratified**: 2026-09-02 | **Last Amended**: 2026-09-02
