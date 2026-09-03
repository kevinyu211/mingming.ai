# Speech-to-text clips

Ten recordings of questions a family would ask about a discharge sheet: 4 Cantonese, 3 Mandarin,
3 English. They are the fixed input for the transcription test in `provider_shortlist.md`
section 5 and research.md R6, and they are what `tests/eval/stt.ts` runs through every
configured STT provider.

## Record them once

- **On the demo phone**, in the demo room if possible. Venue noise is part of the test: a
  provider that only works in a quiet room is not the provider for this build.
- **One native speaker per language.** The Cantonese clips must be Hong Kong Cantonese, not
  Mandarin read aloud with Cantonese words.
- **Normal speaking pace**, no announcer voice. The person asking is a daughter holding a piece
  of paper.
- **One question per file**, 2 to 6 seconds, with a beat of silence at each end.
- Voice Memos (`.m4a`) is fine; a `.wav` at 16 kHz mono is better for Azure, which wants PCM.
  The runner accepts `.m4a` and `.wav`.

## File names

The file's base name is the clip id. `tests/eval/stt.ts` matches
`tests/eval/clips/<id>.m4a` or `<id>.wav` against the entry with the same `id` in
`expected.json`, so the names must match exactly:

| File | Language | Question |
| --- | --- | --- |
| `yue-01.m4a` | Cantonese | 呢隻藥係咪一日食三次？ |
| `yue-02.m4a` | Cantonese | 幾時要返去覆診？ |
| `yue-03.m4a` | Cantonese | 如果佢覺得頭暈，係咪要即刻返醫院？ |
| `yue-04.m4a` | Cantonese | 張紙度寫住飲食方面要注意乜嘢？ |
| `cmn-01.m4a` | Mandarin | 这个药一天吃几次？ |
| `cmn-02.m4a` | Mandarin | 什么时候回来复诊？ |
| `cmn-03.m4a` | Mandarin | 出院记录上写的低盐低脂是什么意思？ |
| `en-01.m4a` | English | What does follow up SOPD two weeks mean? |
| `en-02.m4a` | English | How many times a day does she take the Amlodipine? |
| `en-03.m4a` | English | Which warning signs mean we go back to the hospital? |

The set is chosen to cover what actually breaks transcription here: a Cantonese question about a
dose, a date question, a warning-sign question, a diet question, the same shapes in Mandarin, and
in English the two hard cases for a Hong Kong accent - a hospital abbreviation read as letters
(`SOPD`) and an English drug name (`Amlodipine`).

## What counts as a match

`expected.json` holds the reference transcript. The runner strips whitespace and punctuation on
both sides before comparing, so a provider is not punished for writing `?` instead of `？`.
Traditional vs simplified characters ARE counted as errors: the transcript is shown to the user,
and it should come back in the script they spoke.

## Do not commit the audio

These are voice recordings. Keep the `.m4a` / `.wav` files local; only `README.md` and
`expected.json` belong in git. The repo `.gitignore` does not yet exclude them, so check
`git status` before committing (`tests/eval/clips/*.m4a`, `*.wav`, and `tests/eval/out/`).

Nothing here may be a real patient, a real hospital, or a real family's question.
