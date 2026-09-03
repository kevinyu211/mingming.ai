# Data Model: Discharge Sheet Agent

Phase 1 output. Entities from the spec, with fields, validation and state. Shapes are described
in prose and small tables; the machine-readable schema is `contracts/sheet-reading.schema.json`.

## SheetReading

The structured result of reading one submission (one or two photographed pages).

| Field | Type | Rules |
| --- | --- | --- |
| `sheetType` | `hk_en` \| `cn_zh` \| `unknown` | `unknown` means no cards are produced (FR-006) |
| `warningSigns` | `WarningSign[]` | May be empty; the UI then renders the rule-generated "none printed" card |
| `medicines` | `Medicine[]` | Each field verbatim from the page; missing fields are `null`, never inferred (FR-003) |
| `followUp` | `FollowUpItem[]` | Dates and times verbatim; ambiguous → `null` with `unreadable` note |
| `dietLine` | `DietLine \| null` | `null` when nothing about food is printed |
| `activityLine` | `TextLine \| null` | Rest/activity instruction as printed |
| `hospitalContact` | `TextLine \| null` | Phone or ward line as printed |
| `unreadable` | `UnreadableRegion[]` | First-class; each has a section and a description |
| `readAt` | ISO timestamp | Set by the client; not sent to the model |

Model-generated: everything except `readAt`. Rule-generated after the fact: `dietLine.recognisedType`
(see DietLine), the "none printed" card, card order.

### WarningSign

| Field | Type | Rules |
| --- | --- | --- |
| `symptom` | `Speakable` | What to watch for, as printed |
| `action` | `Speakable` | What the sheet says to do (usually "return to A&E") |
| `source` | `SourceReference` | Required |

### Medicine

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | Verbatim, script untouched (English stays English) |
| `strength` | string \| null | e.g. "5 mg" verbatim |
| `amount` | string \| null | e.g. "1 tab" verbatim |
| `frequency` | string \| null | e.g. "daily", "BD", "每日一次" verbatim; `null` if not printed |
| `duration` | string \| null | verbatim |
| `spoken` | `Speakable` | Plain sentence in both dialects that restates the four fields; may not add anything |
| `source` | `SourceReference` | Required |

Validation: `spoken.yue` and `spoken.cmn` must contain `name` verbatim; if `frequency` is null the
spoken text must say it is not printed (checked by a unit test against the template).

### FollowUpItem

| Field | Type | Rules |
| --- | --- | --- |
| `clinic` | string \| null | e.g. "SOPD", "心内科门诊" verbatim |
| `when` | string \| null | verbatim ("2/52", "2 周后", a date) |
| `tests` | string \| null | e.g. "fasting bloods" verbatim |
| `spoken` | `Speakable` | |
| `source` | `SourceReference` | Required |

### DietLine

| Field | Type | Rules |
| --- | --- | --- |
| `raw` | string | Verbatim |
| `recognisedType` | `low_salt` \| `low_fat` \| `diabetic` \| `light` \| `other` | **Rule-generated** by `lib/rules/diet-line.ts` from `raw`; the model does not set it |
| `spoken` | `Speakable` | Raw line read aloud; for recognised types the rules append one fixed plain sentence from a template |
| `source` | `SourceReference` | Required |

### TextLine

`{ text: string, spoken: Speakable, source: SourceReference }`

### UnreadableRegion

| Field | Type | Rules |
| --- | --- | --- |
| `section` | string | Section name as printed, or "unknown" |
| `description` | string | Why unreadable (blur, cut off, handwriting) in plain words |
| `source` | `SourceReference` | `quote` may be empty; `lineIndex` may be null |

### Speakable

`{ yue: string, cmn: string }`. `yue` is colloquial written Cantonese in traditional characters;
`cmn` is Mandarin in simplified characters. Both are model-generated and both pass the
banned-term filter before storage.

### SourceReference

| Field | Type | Rules |
| --- | --- | --- |
| `section` | string | Section heading as printed ("Discharge Medication(s) & Follow-up Plan", "出院医嘱") |
| `lineIndex` | integer \| null | 0-based line within the section |
| `quote` | string | Verbatim source text; exempt from the banned-term filter |

## Card

A displayable, speakable unit derived from the reading by rules (not stored separately; computed
on render).

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | Stable per reading (type + index) |
| `type` | `warning` \| `medicine` \| `followUp` \| `diet` \| `activity` \| `unreadable` \| `noWarnings` \| `referral` | `noWarnings` and `referral` are rule-generated cards |
| `title` | localized string | From UI strings |
| `body` | `Speakable` | From the entity's `spoken`, or a template |
| `source` | `SourceReference \| null` | `null` only for `noWarnings` and `referral` |
| `aiGenerated` | boolean | True for model-generated bodies; drives the AI label |

Ordering rule (`lib/rules/card-order.ts`): `warning*` (or one `noWarnings`) → `medicine*` →
`followUp*` → `diet` → `activity` → `unreadable*`. Fixed; not configurable.

## Question

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | |
| `text` | string | As recognised or typed |
| `inputLanguage` | `yue` \| `cmn` \| `en` | From the toggle |
| `outcome` | `answered` \| `refused_medicine_change` \| `not_on_sheet` \| `crisis_referral` | Rule-determined for the last three; `answered` only when the model cites a card |
| `answer` | `Speakable \| null` | Present only when `answered` |
| `citedCardId` | string \| null | Required when `answered` |
| `source` | `SourceReference \| null` | Copied from the cited card |

State transitions: `submitted` → (crisis check) → `crisis_referral` | → (refusal check) →
`refused_medicine_change` | → model → `answered` (with citation) | `not_on_sheet` (model returned
`grounded: false` or no valid citation). The crisis and refusal checks run before any model call.

## Profile (Story 2)

| Field | Type | Rules |
| --- | --- | --- |
| `label` | string ≤ 12 chars | Relationship label (阿媽, 老豆); free text but the UI suggests labels and never asks for a name |
| `dialect` | `yue` \| `cmn` | Output dialect |
| `script` | `hant` \| `hans` | Defaults from dialect; user-flippable |

Explicitly absent: name, age, diagnosis, weight, readings, medicines, location.

## FollowUpPlan (Story 2)

| Field | Type | Rules |
| --- | --- | --- |
| `items` | `PlanItem[]` | Derived only from `followUp` and `medicines` with non-null `when`/`frequency` |
| `confirmedAt` | ISO timestamp \| null | `null` until the user confirms; nothing persisted before |
| `followUpDate` | ISO date \| null | Parsed by rules from `FollowUpItem.when` only when unambiguous; otherwise `null` |

### PlanItem

`{ kind: "appointment" | "medicineTime", label: string, when: string (verbatim), source: SourceReference }`

State: `draft` (computed, unsaved) → `confirmed` (saved) → `expired` (today > `followUpDate`;
UI shows the "ask at follow-up" notice; nothing auto-changes).

## Stored state (localStorage key `fitornot.v1`)

`{ version: 1, consentedAt, profile?, reading?, plan? }`. `deleteEverything()` removes the key.
Nothing else is persisted anywhere.

## What is never modelled

Diagnoses, procedures, history, allergies, patient particulars. The extraction schema has no fields
for them, so the model has nowhere to put them and the app never holds them (Principle I and V).
