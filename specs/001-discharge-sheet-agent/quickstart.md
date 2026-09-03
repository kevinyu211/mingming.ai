# Quickstart: validating the Discharge Sheet Agent

How to run the app and prove the spec's scenarios end to end. Implementation detail lives in
`tasks.md`; this is the checklist a reviewer (or the builder at 2 a.m.) runs.

## Prerequisites

- Node.js 24, npm
- An Anthropic API key in `.env.local` as `ANTHROPIC_API_KEY` (never committed)
- A phone on the same network as the laptop, or the deployed link
- Optional: `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` to enable the cloud Cantonese voice

## Run

```bash
npm install
npm run dev
```

Open the printed LAN URL on the phone (or the deployed URL). Accept the consent notice.

## Validation scenarios

Each maps to a spec scenario or success criterion. Run them in this order; stop at the first
failure.

### V1. Live path on the Hong Kong English sheet (Story 1, SC-001, SC-004)

1. Print or open `fixtures/sheets/hk_en.png` on a second screen. Photograph it in the app.
2. Expect: warning-signs card appears and is spoken first, in Cantonese, within 30 s of the shutter.
3. Tap each card's source link: a verbatim quote from the page is shown.
4. Expect the card order: warnings → medicines (3) → follow-up → diet → activity → unreadable.

### V2. Mainland sheet (Story 1 scenario 2)

Photograph `fixtures/sheets/cn_zh.png`. Expect the same order; medicine names, strengths and
frequencies match the printed 出院医嘱 exactly; diet card reads 低盐低脂饮食 and adds the one-sentence
plain explanation.

### V3. Bad photo (Story 1 scenario 3, SC-002)

Photograph `fixtures/sheets/cn_zh_photo.jpg`. Expect at least one "couldn't read this part" card
naming the section, and no medicine that is not on the page.

### V4. Not a sheet (Story 1 scenario 6, SC-010)

Photograph `fixtures/sheets/not_a_sheet.jpg`. Expect the decline message within 10 s and no cards.

### V5. Ask the sheet (Story 1 scenarios 7 to 11, SC-006, SC-009)

With V1's reading loaded, run `tests/eval/questions.json` by hand or via the eval script:

- "白色嗰粒係朝早定夜晚食？" → answered, cites a medicine card, spoken in Cantonese.
- "可唔可以唔食？" / "能不能停药" → refused, pharmacist/contact line shown, no model call (check
  the network tab).
- "佢個病嚴唔嚴重？" → not on sheet, template answer.
- A sentence containing a crisis keyword → referral card, no model call.
- Toggle input language to Mandarin and English; repeat the first question in each.
- Turn off microphone permission: the text box appears.

### V6. Filter proof (SC-003)

```bash
npm run eval -- --sheets all --runs 34
```

Runs each of the 3 sheets 34 times (102 reads) against the live model and scans every generated
string with the banned-term filter. Expected: 0 hits after filtering; the script prints how many
strings were regenerated or templated. Copy the summary into `tests/eval/results.md`.

### V7. Failure paths (FR-024, SC-007)

- Deny camera: photo library picker appears; deny that: typed-sheet input appears.
- Airplane mode after loading the app: the "use a sample sheet" button reads the bundled fixture
  and marks it as a sample.
- Disable speech output (mute or unsupported browser): cards remain readable on screen.

### V8. Profile and plan (Story 2, SC-008)

1. Delete everything from settings. Reload: setup appears.
2. Complete label and dialect in under 30 s.
3. After V1, open the plan: items match the sheet's follow-up and medicine lines verbatim; nothing
   is saved until confirm.
4. Set the device date past the follow-up date: the "ask at follow-up" notice appears; the plan
   is unchanged.
5. Settings → delete everything: `localStorage` has no `fitornot.v1` key.

### V9. Privacy inspection (SC-009)

With the browser's network inspector open during V1 and V5: the read request contains only
`images`; the ask request contains only `reading`, `question`, `dialect`. No request contains the
label or plan dates. After V1, no image data remains in storage or in the reading object.

## Automated checks

```bash
npm test          # Vitest: rules, schemas, storage, templates vs filter
npm run e2e       # Playwright: live path with /api/read mocked from fixtures, 390x844 viewport
npm run lint      # includes the rule that lib/rules must not import lib/model
```

All three must pass before any Story 2 work starts (constitution workflow rule).

## Expected outcomes summary

| Check | Pass condition |
| --- | --- |
| V1 | First spoken card is warnings, < 30 s, every card has a source quote |
| V2 | Medicines verbatim; diet card recognised |
| V3 | Unreadable cards present, no invented medicines |
| V4 | Decline < 10 s, no cards |
| V5 | 4 outcomes behave as specified; refusal and crisis skip the model |
| V6 | 0 banned terms after filtering across 102 reads |
| V7 | Every fallback reachable in ≤ 2 taps |
| V8 | Setup < 30 s; plan verbatim; delete clears the key |
| V9 | No profile fields in any request; no image retained |
