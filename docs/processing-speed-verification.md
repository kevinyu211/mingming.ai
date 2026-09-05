# Ming Ming upload and processing changes — 5 September 2026

Implemented locally on `codex/mingming-processing-speed`, based on `42a993c`. No production deployment or model configuration change was made. The performance task coordinated one implementation team; **Review app architecture and UX** independently reviewed the integrated diff and found no new blockers within the agreed scope. Three lower-cost `gpt-5.6-luna` agents implemented bounded packages, followed by primary-agent correction, integration and verification.

The original performance plan remains a proposal for the broader roadmap. This release implements the bounded upload/reliability package and the minimum authoritative-card contract. Progressive medical-card delivery, model/output experiments, wider tracking and export changes remain separate work.

## Changes and benefits

| Change | Benefit | What it does not establish |
| --- | --- | --- |
| Immediately acknowledge valid input; show submitting, reading and checking stages, elapsed time, slow-read text and cancel | The app responds while the model thinks; no invented completion percentage | Faster model extraction |
| One server processing deadline of 240 seconds; one schema retry only with time remaining; browser submission watchdog of 30 seconds | Bounds stalled work and prevents retries from resetting the clock | That a four-minute scan is suitable for a demo |
| Abort browser request, route work and provider transport; guard the final commit by request identity | Cancel/navigation cannot replace or archive the prior sheet with a late reading | Confirmation of upstream billing cessation after abort |
| Two concurrent wording repairs, sharing at most ten seconds; checked templates for stalled/queued repairs | Reduces excessive delay on repair-heavy scans while preserving card order and safety checks | A live repair-heavy speed comparison; successful smoke runs needed no repairs |
| Persist the complete validated card set; validate identity/order/source/facts and use it in chat/share consumers | Repaired wording and verification/template metadata survive storage and reopening | Full export-warning support: existing text/PNG exporters still omit unverified markers |
| Preflight exact encoded JSON bytes against 8 MiB; retain selected pages after storage failure; align both prompts with six-page input | Avoids futile oversized transmission and recoverable photo loss; removes conflicting page instructions | Real-phone image-preparation performance or six-page extraction accuracy |
| Record body/model/checking timings and terminal failure codes; improve the existing eval runner | Separates model work from checking overhead; an HTTP 200 ending in error is a failure | Full phone-to-audio instrumentation |

The deployed model choice, medium effort, 64,000-token read cap, and 1600-pixel/JPEG 0.85 preparation are unchanged. Cutting image quality or model output without accuracy evidence was deliberately deferred.

## Acceptance and verification

| Criterion | Evidence | Status |
| --- | --- | --- |
| Valid input receives status before model completion; cards wait for full validation | Route stream tests; real candidate acknowledgment about 0.1 seconds or less | Passed locally |
| Stalled model reaches 240-second deadline, aborts transport and emits no final reading | Fake-clock route tests, including a never-resolving provider | Passed |
| Already-cancelled requests never call the provider; late schema failure does not start a retry | Route tests, including invalid output at 236 seconds | Passed |
| Repairs have concurrency at most two, abort at their shared ten-second limit and safely template every pending card | Fault-injection tests with hanging phrase calls; exact call/template counts and cleared timers | Passed |
| Out-of-order repair completion preserves deterministic order, source, stopped status and unverified marker | Reverse-completion repair test | Passed |
| Client settles stalled fetch/body and cancelled reads without late callbacks | Client tests with uncooperative transports, pre-aborted signals and fake clocks | Passed |
| Failed/incomplete/mismatched card sets cannot replace the active sheet | Client/schema/store tests for missing, duplicate and cross-reading cards | Passed |
| Cancel preserves active identity and archive; final authoritative body and flags persist across reload | Browser lifecycle tests inspecting actual localStorage on both viewport profiles | Passed |
| Storage handoff failure keeps selected photos; retry sends exactly one request | Browser fault injection; exact-byte boundary unit tests | Passed |
| Six-page ceiling, order, refusal of excess pages | Existing capture/page-limit tests; prompt contract alignment | Passed mechanically; live six-page accuracy unverified |
| Production compilation and static checks | `npm run build`, `npm run typecheck`, `npm run lint`, `git diff --check` | Passed |
| Exact source and complete warning accuracy, natural Cantonese, actual demo phone/network rehearsal | See live evidence and limitations below | Not fully approved |

Unit suite: **1,370 tests in 51 files passed**. The final suite includes the SDK option forwarding checks, fault injection and reverse-order repair test. Existing privacy mocks were updated to send the current server-stamped schema and complete card stream; privacy assertions were retained.

Browser suite: **118 of 122 passed initially**. Two failures were the new test's ambiguous `role=alert` locator matching Next's route announcer; the selector was corrected. Two were timing-sensitive sample-briefing/check-in cases. All four passed when rerun serially with `--last-failed --workers=1`. This is not a claim that the complete parallel suite was flake-free. Separate strengthened lifecycle tests also passed on the iPhone viewport. Both profiles use Chrome emulation, not physical iPhone/Android hardware or Safari.

The other task independently ran 56 tests covering route, client, repair budgets and canonical cards, plus all three sample fixtures through canonical validation and forced safe fallback.

## Real-model evidence

All inputs were repository synthetic fixtures. Candidate tests used the local optimized production build and the configured Anthropic-compatible Gateway path: `anthropic/claude-sonnet-5`, medium effort, unchanged 64,000-token cap. Network paths differ between the local candidate and hosted baseline, and the sample is too small to establish a latency distribution or successful-scan speedup.

| Build/input | Runs | First reading status | First card / done | Model time | Checking | Repairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Candidate English `hk_en` | 1 | ~0.1 s | 27.0 s | 26.943 s | 4 ms | 0 |
| Candidate Chinese photo `cn_zh_photo` | 1 | <0.1 s | 38.6 s | 38.602 s | 2 ms | 0 |
| Hosted baseline Chinese photo | 1 | 29.9 s | 39.5 s | Not collected in this run | Not collected | 0 |
| Candidate Chinese photo diagnostic repeat | 1 | <0.1 s | 38.9 s | See server log | See server log | 0 |

All four successful runs returned exact expected medicine fields, no invented/missing medicines, and no banned-term hits. They were **not** complete whole-reading accuracy passes:

- Both baseline and candidate aggregate the three warning symptoms into one warning entry, whereas the fixture expects three entries.
- The retained candidate diagnostic quote omitted the space after `7.`. The strict quote matcher therefore reported 0% warning quote coverage. The retained English symptom explicitly contains chest pain, shortness of breath and leg swelling, and the action says to go directly to the emergency room. This diagnostic found a formatting mismatch and aggregation, not an omitted symptom in that retained run.
- The earlier candidate run also failed quote matching, but its raw warning output was not retained; do not assume its difference was identical.
- The hosted baseline diagnostic retained the expected quote spacing but had a diet raw-text mismatch. No matcher or accuracy gate was relaxed to make these runs pass.
- Human review of every offered language and a representative six-page/hard-photo corpus remain outstanding. Medicine/filter pass lines alone are not full accuracy signoff.

Two initial local smoke attempts failed before extraction because `NODE_OPTIONS=--use-openssl-ca` uses an empty certificate store on this Mac. A separate connection probe confirmed `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Restarting the local production server without that flag restored successful calls. The failed attempts remain in the eval record and are excluded from successful latency claims; they incurred no completed model reading. See the existing README's macOS environment guidance.

Detailed run records, including synthetic warning diagnostics: [eval results](../tests/eval/results.md). The runner now records first acknowledgment and failed terminal outcomes, validates complete final cards, and uses the shared request budget.

## Release boundary and next work

This is a local implementation with verified bounded behavior. **It is not a claim of substantially faster successful model extraction or unconditional live-demo readiness.** Do not deploy based on aggregate medicine/filter scores alone. Preserve the strict traceability results above, review the exact intended demo sheet, and rehearse five consecutive scans on the actual phone/network. The original proposed target is each correct scan within 45 seconds with useful Cantonese audio; this rehearsal has not been performed here.

Next performance work should compare a more concise prompt or supported effort setting against the same accuracy/language corpus, then consider reducing multilingual output work. Those experiments address the dominant 27–39-second model phase and need matched trials. A background queue, new image storage service or broad framework migration is not justified by these measurements.

Use an explicitly labelled sample if the live rehearsal is unreliable. Do not represent a sample as a fresh scan. Preserve the prior deployed artifact for rollback when an approved release occurs.

Tooling note: before a future deployment, upgrade the outdated Vercel CLI with `npm i -g vercel@latest` (or `pnpm add -g vercel@latest`) for current compatibility. No global tool or production configuration was changed during this work.
