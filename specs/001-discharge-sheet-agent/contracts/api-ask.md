# Contract: `POST /api/ask`

Answers one question using only the cards of the current reading. Two rule checks run on the
client **and** on the server before any model call; the model is only reached for questions that
pass both.

## Request

```json
{
  "reading": { ...SheetReading... },
  "question": { "text": "白色嗰粒係朝早定夜晚食？", "inputLanguage": "yue" },
  "dialect": "yue"
}
```

- `reading` is the current reading as returned by `/api/read` (already filtered).
- `dialect` selects the output form; it is the only profile-derived value sent, and it is not an
  identifier.
- `memory` (optional) is the on-device brief built by `lib/memory/context.ts`: plain text, at most
  1200 characters, made only of fields off sheets this app already read and questions already
  asked. Omitted entirely when the phone has nothing to say. Longer than the cap → 400.
- Not sent: relationship label, plan, dates, anything else from storage. The body is strict, so any
  other key is a 400.

## Rule checks (before the model, in this order)

Both run before `memory` is looked at, and neither reads it: a crisis question and a medicine-change
question reach their fixed answers on the question text alone, with no model call and so no brief on
the wire.

1. **Crisis** (`lib/rules/crisis.ts`): keyword hit → respond `{"outcome":"crisis_referral"}`; the
   client renders the referral card with the organisers' resources. No model call.
2. **Medicine change** (`lib/rules/refusal.ts`): patterns for skip / stop / double / add / change
   dose in the three input languages → respond `{"outcome":"refused_medicine_change",
   "answer":{template}}` pointing to the pharmacist and the sheet's contact line. No model call.

## Model call (grounded answer)

System prompt (frozen, cacheable) instructs: answer only from the supplied cards; return
`grounded: false` if the cards do not contain the answer; cite exactly one card id; write the
answer in the requested dialect form; never add advice.

When `memory` is present it is placed ahead of the cards as a `BACKGROUND` block, labelled
uncitable. The prompt states that it is context, never evidence: an answer that appears only in the
background and not on the cards is `grounded: false`. The server enforces the same thing
structurally — the citation must be a card id it built from the CURRENT reading, so a memory-only
answer becomes `not_on_sheet` whatever the model claims. `memory` is never passed to `/api/read` or
to the rephrase call.

Structured output:

```json
{ "grounded": true, "citedCardId": "medicine-1", "answer": { "yue": "...", "cmn": "..." } }
```

## Response

Streamed newline-delimited JSON:

```
{"event":"outcome","outcome":"answered","citedCardId":"medicine-1","source":{...}}
{"event":"answer","answer":{"yue":"...","cmn":"..."}}
{"event":"done"}
```

- `grounded: false` or a `citedCardId` that does not exist in the reading → outcome
  `not_on_sheet` with the fixed template answer (FR-013). The server enforces this; the client
  never trusts the model's grounding claim on its own.
- The answer strings pass the banned-term filter; hit → one regenerate → template.

## Errors

| Status | Body | Client behaviour |
| --- | --- | --- |
| 400 | `{ "error": "bad_request" }` | Show retry |
| 502 | `{ "error": "model_unavailable" }` | Show "can't answer right now; the cards above are still correct" |
