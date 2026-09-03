# Which outputs are model-generated and which are rules

Required by the track rules ("必须说明哪些步骤由模型自动生成，哪些经模板 / 规则 / 人工编辑").

| Output | Source | Where |
| --- | --- | --- |
| Structured reading of the page (warning signs, medicines, follow-up, diet line, activity, contact, unreadable regions) | **Model** (Claude Opus 5, structured output validated by a Zod schema) | `lib/model/client.ts`, `lib/model/prompts.ts` |
| Spoken sentence for each card, in Cantonese, Mandarin and English | **Model**, then the banned-term filter; one model rephrase on a hit; then a **template** | `lib/server/reading-pipeline.ts`, `lib/rules/template-fallback.ts` |
| Card order, warning signs first | **Rules** | `lib/rules/card-order.ts` |
| "No warning signs printed" card | **Rules** (fixed text) | `lib/rules/card-order.ts` |
| Diet line type and the one plain sentence for recognised types | **Rules** | `lib/rules/diet-line.ts` |
| "I couldn't read this part" cards | **Rules** wording around a model-provided description | `lib/rules/card-order.ts` |
| Decline for a photo that is not a discharge sheet | **Model** flags `unknown`; **rules** produce no cards | `lib/rules/card-order.ts` |
| Banned-term filter | **Rules** | `lib/rules/banned-terms.ts` |
| Medicine-change refusal and its sentence | **Rules** | `lib/rules/refusal.ts`, `lib/rules/template-fallback.ts` |
| Crisis referral card and resources | **Rules** | `lib/rules/crisis.ts`, `lib/i18n/referral.ts` |
| Grounded answer to a question | **Model**, accepted only if it cites a card id the server built; otherwise **rules** ("the sheet doesn't say") | `lib/server/ask-pipeline.ts` |
| Follow-up plan items and the follow-up date | **Rules** (verbatim from source lines; date parsed only from unambiguous forms) | `lib/rules/plan-from-reading.ts` |
| Expiry notice after the follow-up date | **Rules** (fixed text) | `lib/rules/plan-from-reading.ts` |
| Disclaimer, AI label, agent limits, all interface copy | **Human-written**, tested against the filter | `lib/i18n/ui.ts` |
| Background brief of past sheets and questions | **Rules** (assembled on the device from fields already extracted; generated lines re-checked against the filter, page text left verbatim) | `lib/memory/context.ts` |
| What the memory keeps, and for how long | **Rules** (last 5 sheets, last 50 questions, oldest evicted; crisis questions never recorded) | `lib/memory/record.ts` |
| Speech audio | **Voice provider** (or the phone's built-in voice) from the filtered text | `lib/speech/*` |

The AI label on screen marks exactly the rows above whose source is the model.
