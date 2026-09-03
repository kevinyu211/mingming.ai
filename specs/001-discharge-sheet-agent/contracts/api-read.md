# Contract: `POST /api/read`

Reads one or two photographed pages into a `SheetReading`. **Model-generated** output, validated
and filtered by rules before it is returned.

## Request

`Content-Type: application/json`

```json
{
  "images": [
    { "mediaType": "image/jpeg", "base64": "..." }
  ]
}
```

- 1 to 2 images, each downscaled client-side (max 1600 px long edge). Request body limit 8 MB.
- No other fields. The profile, dialect and any identifiers are never sent (Principle V).

## Response

Streamed as newline-delimited JSON events so the client can speak the first card early:

```
{"event":"status","phase":"reading"}
{"event":"card","card":{ ...Card... }}
{"event":"card","card":{ ...Card... }}
{"event":"done","reading":{ ...SheetReading with recognisedType added... },"filter":{"regenerated":1,"templated":0}}
```

- Cards are emitted in the fixed order (warning signs first). If the model returns no warning signs,
  the server emits the rule-generated `noWarnings` card first.
- `sheetType: "unknown"` → a single event `{"event":"unknown"}` and no cards (FR-006).
- Every `Speakable` string in every card has passed the banned-term filter; on a hit the server
  regenerated that card once via the phrase prompt, then substituted the template. `filter` reports
  how many strings were regenerated or templated, for the eval log.

## Errors

| Status | Body | Client behaviour |
| --- | --- | --- |
| 400 | `{ "error": "bad_request", "detail": "..." }` | Show "try another photo" |
| 413 | `{ "error": "too_large" }` | Client re-downscales and retries once |
| 422 | `{ "error": "invalid_reading" }` (schema validation failed after one retry) | Show "couldn't read this sheet" state, offer sample sheet |
| 502 | `{ "error": "model_unavailable" }` | Offer bundled sample sheet (FR-024) |

## Server guarantees

- Image bytes exist only in the request handler's memory and are not written, cached or logged.
- Request and response bodies are not logged; only timing, status and `filter` counts are.
- Output validated against `sheet-reading.schema.json` (as a Zod schema) before any event is sent
  except `status`.
- `dietLine.recognisedType` is set by `lib/rules/diet-line.ts`, not by the model.
