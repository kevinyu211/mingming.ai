# Which outputs are model-generated and which are rules

Required by the track rules ("必须说明哪些步骤由模型自动生成，哪些经模板 / 规则 / 人工编辑").

**The boundary in one sentence:** the model reads the page and phrases sentences; deterministic
code decides everything else — the order things are said in, every refusal, crisis detection, the
banned-term filter, dose counting, the plan's dates, and whether a citation is accepted at all.

Two consequences worth stating before the table:

1. **The two refusals run before any model call.** In `lib/server/ask-pipeline.ts` (`runAsk`), the
   crisis gate (`lib/rules/crisis.ts`) runs first and the medicine-change gate
   (`lib/rules/refusal.ts`) second; only after both pass is a model provider even resolved. The same
   two gates also run on the device in `app/chat/page.tsx` before the request is sent, so a crisis
   question and a "can she skip it?" question reach their fixed answers with **zero network calls**.
   Both eval runs show them answering in 0.0 s for exactly that reason.
2. **A model output never decides whether a card is shown.** ESLint enforces the direction of the
   dependency: `eslint.config.mjs` forbids anything under `lib/rules/**` from importing
   `@/lib/model`, `**/lib/model` or `@anthropic-ai/sdk`. A rule that could ask the model is not a
   rule.

## Reading the page

| Output | Source | Where |
| --- | --- | --- |
| Structured reading of the page — warning signs, medicines (with `status`), follow-up, diet line, activity line, hospital contact, unreadable regions | **Model** (Claude Opus 5, structured output validated by a Zod schema; a schema failure is not retried, it becomes a decline) | `lib/model/client.ts`, `lib/model/prompts.ts`, `lib/domain/schemas.ts` |
| The spoken body of each card, in Cantonese, Mandarin and English | **Model**, then the banned-term filter; on a hit, one model rephrase given only the card's typed facts and its source line; if that fails or fails again, a **fixed template** | `lib/server/reading-pipeline.ts`, `lib/rules/banned-terms.ts`, `lib/rules/template-fallback.ts` |
| Card order — warning signs first, always | **Rules**, a fixed array | `lib/rules/card-order.ts` (`CARD_ORDER`) |
| "This sheet prints no warning signs" card, in the warning slot | **Rules**, fixed text | `lib/rules/card-order.ts` |
| "I couldn't read this part" cards | **Rules** wording wrapped around the model's description of the region and the field it costs | `lib/rules/card-order.ts`, `UnreadableRegionSchema` |
| Decline for a photo that is not a discharge sheet | **Model** flags `sheetType: "unknown"`; **rules** then emit no cards at all | `lib/server/reading-pipeline.ts`, `lib/rules/card-order.ts` |
| Marking a card `unverified` — its typed `name`/`strength` are not findable in its own `source.quote` | **Rules**, a server-side string check on the model's own reply | `lib/server/reading-pipeline.ts` (`verifiedAgainstQuote`) |
| Diet-line type, and the one plain sentence for the four recognised types | **Rules** | `lib/rules/diet-line.ts` |
| Page ceiling: six pages, refused out loud rather than truncated | **Rules**, a pure function, pinned to the same constant on the server | `components/Capture.tsx` (`admitPages`, `MAX_PAGES`), `app/api/read/route.ts`, `tests/unit/page-limit.test.ts` |

## The conversation

| Output | Source | Where |
| --- | --- | --- |
| The order the sheet is spoken in, and the fact that the amber warning block reads itself first | **Rules** — `splitCards` walks the array `buildCards` already ordered; the phase machine only moves forward and a model turn cannot reach it | `components/chat/briefing.ts`, `lib/rules/card-order.ts` |
| 「我睇完你張紙。最緊要嘅先講。」 (intro), 明唔明？ / 再講一次 / 明白, 仲有 N 段, 講完晒…, 睇「跟進」 | **Human-written fixed strings**, one per locale, tested against the banned-term filter | `lib/i18n/ui.ts` (`brief.*`), `components/chat/Prompts.tsx` |
| Clause-by-clause typing of a message | **Rules** — a pure splitter on 「，。、？！：」 that provably never drops or reorders a character, so what appears on screen is exactly the string the filter passed | `components/chat/briefing.ts` (`chunks`) |
| Crisis referral text and its resource list | **Rules**, before any model call | `lib/rules/crisis.ts`, `lib/i18n/referral.ts` |
| Medicine-change refusal and its sentence | **Rules**, before any model call | `lib/rules/refusal.ts`, `lib/rules/template-fallback.ts` |
| Grounded answer to a question | **Model**, accepted only if it cites a card id **the server itself built** from the current sheet; otherwise **rules** produce "the sheet doesn't say" | `lib/server/ask-pipeline.ts` |
| "The sheet doesn't say" | **Rules**, fixed text | `lib/rules/template-fallback.ts` (`NOT_ON_SHEET`) |
| The caution suffix on an `unverified` card | **Rules** | `components/chat/briefing.ts`, `lib/rules/template-fallback.ts` (`CAUTION_SUFFIX`) |
| The AI chip on a message | **Rules** — rendered only where `message.origin === "model"` | `components/chat/ChatMessage.tsx`, `components/AiLabel.tsx` |

## The check-in and 跟進

| Output | Source | Where |
| --- | --- | --- |
| The check-in question 「今日食咗{name}未？張紙寫{printed}。」 | **Template**, with the medicine name and the page's printed frequency clause dropped in **verbatim**. No model turn assembles it | `lib/i18n/ui.ts` (`checkin.*`), `components/chat/briefing.ts` (`fill`) |
| Replies to 食咗 / 未食 | **Template**. 食咗 → 「今日仲有 N 次」 or 「今日食晒喇」; 未食 quotes the printed clause back and stops | `lib/i18n/ui.ts`, `app/chat/page.tsx` |
| Doses remaining today, and the refusal to count | **Rules**, pure, no clock — `today` is always passed in. Recognises only the forms a sheet actually prints (每日 N 次, N times daily, OD/BD/TDS/QID, 一日 N 次); as-needed markers win outright; anything else returns 0 and the card shows the printed clause with **no counter** | `lib/rules/doses.ts` (`timesPerDay`, `remaining`, `localDay`) |
| The clause behind 「張紙寫：」 | **The page**, verbatim. Never reformatted, never a time of day | `lib/rules/doses.ts` (`DoseTarget.printed`), `components/track/DoseCard.tsx` |
| A stopped medicine shown but never counted, never scheduled, no 食咗 button | **Rules**, from `Medicine.status !== "current"` | `lib/rules/doses.ts`, `lib/rules/plan-from-reading.ts`, `components/track/DoseCard.tsx` |
| Follow-up plan items and their `when` | **Rules** — copied verbatim from the source line, never composed | `lib/rules/plan-from-reading.ts` (`draftPlan`) |
| The follow-up date and the countdown | **Rules** — a date appears only for printed forms that can mean exactly one thing; hedged, ambiguous or unrecognised forms give `null`, and the card then shows the printed words and counts nothing | `lib/rules/plan-from-reading.ts` (`parseFollowUpDate`), `components/track/AppointmentCard.tsx` |
| Expiry notice once the visit is past | **Rules**, fixed text; nothing is rescheduled or removed | `lib/rules/plan-from-reading.ts` |
| The calendar file (.ics) | **Rules** — all-day events copied from the plan, no invented times, no alarms, and the relationship label never enters the file | `lib/plan/ics.ts` |

## State, memory and speech

| Output | Source | Where |
| --- | --- | --- |
| The name a sheet is filed under | **Rules** — first printed `followUp[].clinic`, else the first line of `hospitalContact.text` cut at the first punctuation, else the fixed word 出院紙 / 出院纸 / "Discharge sheet". Always a prefix of text the page printed; a hospital or department is never invented | `lib/sheets/title.ts` |
| One active sheet; a new photograph archives the previous one read-only with its counters frozen | **Rules** | `lib/sheets/store.ts` (`startSheet`, `ARCHIVE_LIMIT = 5`) |
| Background brief of past sheets and questions | **Rules** — assembled on the device from fields already extracted, capped at 1200 characters; generated lines are re-checked against the filter, page text is left verbatim | `lib/memory/context.ts` |
| What memory keeps and for how long | **Rules** — last 5 readings, last 50 questions, oldest evicted; crisis questions never recorded | `lib/memory/record.ts`, `lib/memory/types.ts` |
| Disclaimer, AI label, agent limits, consent notice, every fixed interface string | **Human-written**, three locales, tested against the banned-term filter in CI. The disclaimer is the single filter-exempt string because the rulebook mandates its wording | `lib/i18n/ui.ts`, `tests/unit/ui-copy.test.ts` |
| Speech audio | **Voice provider** (MiniMax on the demo build, or the phone's own voice) reading the already-filtered text. It never receives the label, a date or an identifier | `lib/speech/tts.ts`, `lib/speech/providers/*` |
| Transcript of a spoken question | **Transcription provider** (OpenAI `gpt-4o-mini-transcribe` on the demo build, `STT_PROVIDER=openai`) of a clip recorded on the phone, with the browser's own recognition drawing the words live. Shown to the user before it is submitted | `lib/speech/stt.ts`, `lib/speech/providers/openai.ts` |

## Where a model can still be wrong, and what catches it

The model's job is verbatim transcription into fields. `tests/eval/stress.md` records where that
fails on our hard fixtures and which layer catches it: a stopped medicine is caught by
`Medicine.status` plus `draftPlan` (31 of 31 caught, none planned); a covered cell is caught by
`UnreadableRegionSchema.field` (null, never guessed); a rewritten quote is caught by the
`unverified` check; a banned term is caught by the filter (0 hits in 20 API runs after filtering,
against 13–17 in 24 unfiltered direct runs). What is **not** caught is a blurred glyph the model
reads confidently and wrongly — a comma read as a semicolon on `messy`. That is stated in
`project.md` rather than papered over.
