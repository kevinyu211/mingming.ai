# Contract: `POST /api/read`

Reads one to six photographed pages into a `SheetReading`. **Model-generated** output, validated
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

- 1 to 6 images, each downscaled client-side (max 1600 px long edge). Request body limit 8 MB.

  Six, not two, because a Hong Kong patient is discharged with a stack rather than a sheet. The
  Hospital Authority's own HKWC discharge checklist tells the patient to carry 出院紙, 覆診紙,
  繳費單, 病假紙, 抽血紙 and 治療處方 out of the ward, and the follow-up date is printed on a
  different page from the medicines (`docs/real-sheet-evidence.md`). Reading two pages of that
  reads a third of the discharge.

  The ceiling is `MAX_PAGES` in both `app/api/read/route.ts` and `components/Capture.tsx`, pinned
  equal by `tests/unit/page-limit.test.ts`. A client that accepted more pages than the route does
  would silently truncate a medical document, which the capture screen must never do — it refuses
  the seventh page out loud instead.

  At 1600 px and quality 0.85 a page lands at roughly 200–400 KB, so six encode to about
  1.6–3.2 MB, well inside the 8 MB body limit. `maxDuration` is 300 s: a single dense page measured
  45–105 s in the live stress runs, so a full stack needs the headroom.
- No other fields. The profile, dialect and any identifiers are never sent (Principle V).

## Response

Valid input receives HTTP 200 and a `reading` status before waiting for the model. Progress is
streamed as newline-delimited JSON; all cards are withheld until extraction and safety checks finish:

```
{"event":"status","phase":"reading"}
{"event":"status","phase":"checking"}
{"event":"card","card":{ ...Card... }}
{"event":"card","card":{ ...Card... }}
{"event":"done","reading":{ ...StoredReading with recognisedType and readAt added... },"filter":{"regenerated":1,"templated":0}}
```

- Cards are emitted in the fixed order (warning signs first). If the model returns no warning signs,
  the server emits the rule-generated `noWarnings` card first.
- `sheetType: "unknown"` → a single event `{"event":"unknown"}` and no cards (FR-006).
- Every `Speakable` string in every card has passed the banned-term filter; on a hit the server
  attempts one regeneration via the phrase prompt, then uses a checked template if needed. `filter` reports
  how many strings were regenerated or templated, for the eval log.

## Errors

| Status | Body | Client behaviour |
| --- | --- | --- |
| 400 | `{ "error": "bad_request", "detail": "..." }` | Show "try another photo" |
| 413 | `{ "error": "too_large" }` | Client re-downscales and retries once |

After acceptance, errors are terminal NDJSON events on the HTTP 200 response:

| Error event code | Meaning | Client behaviour |
| --- | --- | --- |
| `invalid_reading` | Schema invalid, including after the one permitted retry | Offer another photo or sample |
| `model_unavailable` | Provider failed or refused | Offer retry or sample |
| `timed_out` | Processing deadline reached | Offer retry or sample |
| `cancelled` | Request cancelled | Stop processing without saving a reading |

The client also accepts legacy JSON 422/502 errors. It checks the final card set against the
reading (IDs, types, order, sources and facts) before persisting it. An incomplete, mismatched or
failed read never replaces or archives the active sheet. Final validated cards are saved alongside
the reading so repaired wording and warning markers survive reopening and sharing.

## Time and cancellation budgets

- Client submission/acknowledgment: 30 seconds. After the first `reading` event, one 240-second
  processing budget plus 10 seconds of response grace; later heartbeats do not reset this clock.
- Server extraction, optional schema retry and safety checks share 240 seconds, within the route's
  300-second platform allowance. A schema retry needs at least 5 seconds remaining.
- Repairs run at most two at a time and share a 10-second budget, also bounded by the server
  deadline. Pending and failed repairs use checked deterministic templates; order is unchanged.
- A deadline aborts the underlying model transport. A client disconnect or explicit cancellation
  aborts active model/repair work. Request identity guards prevent late callbacks from saving data.
- Capture checks the exact encoded JSON body against 8 MB before submission. Storage and size
  failures retain the selected photos so the user can retry.

## Server guarantees

- Image bytes exist only in the request handler's memory and are not written, cached or logged.
- Request and response bodies are not logged; only numeric stage timing, page/byte counts, status, fixed error codes and `filter` counts are.
- Output validated against `sheet-reading.schema.json` (as a Zod schema) before any event is sent
  except `status`.
- `dietLine.recognisedType` is set by `lib/rules/diet-line.ts`, not by the model.
