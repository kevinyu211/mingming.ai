# Contract: `POST /api/phrase`

Regenerates the spoken text of **one** card after a banned-term hit. Used internally by
`/api/read` and `/api/ask`; also exposed so the client can request a fresh phrasing when the user
taps "say it differently". Never changes the card's facts.

## Request

```json
{
  "cardType": "medicine",
  "facts": { "name": "Amlodipine", "strength": "5 mg", "amount": "1 tab", "frequency": "daily", "duration": null },
  "source": { "section": "Discharge Medication(s) & Follow-up Plan", "lineIndex": 0, "quote": "Amlodipine 5mg 1 tab daily" },
  "avoid": ["治療"],
  "dialect": "both"
}
```

- `facts` is the typed fact object for the card type (medicine, warning, followUp, diet,
  activity). The model may only restate these.
- `avoid` lists the terms that triggered the filter so the prompt can name them.

## Response

```json
{ "spoken": { "yue": "...", "cmn": "..." }, "filtered": false }
```

- If the regenerated text hits the filter again, the server returns the fixed template for that
  card type instead and sets `"filtered": true`.

## Templates (rule-generated fallbacks, `lib/rules/template-fallback.ts`)

One template per card type in both dialects, built only from the fact fields, for example
(medicine, `cmn`): "药名 {name}，{strength}，每次 {amount}，{frequency}。" and when `frequency` is
null: "…用法上面没有印，请看药袋标签或问药剂师。" Templates are unit-tested against the banned-term
filter so a fallback can never itself be filtered.
