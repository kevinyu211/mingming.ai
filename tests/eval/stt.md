# Transcription test (speech-to-text)

The decision record for research.md R6. Lower stakes than the voice - the user sees the
transcript and can correct it before sending - so the browser API may well win on effort.

**Status:** not run yet. `STT_PROVIDER` stays `browser` until this file ends in a PICK line.

## How to run it

1. Record the ten clips described in `tests/eval/clips/README.md` (4 Cantonese, 3 Mandarin,
   3 English) on the demo phone.
2. Put the keys you have in `.env.local`. A provider without keys is skipped.
3. `npx tsx tests/eval/stt.ts` (or `--providers elevenlabs`). It prints each transcript against
   the expected text with a character error rate and appends a run table below.
4. Test the browser path by hand on the demo phone - it cannot be scripted. **iOS Safari with
   `zh-HK` is the one to check**; R6 flags it as the least certain thing in this whole area.

## Scores

CER comes from the script. The three judgement columns are filled by the same native speakers
who scored the voices.

| provider | mean CER | worst clip | Cantonese usable? | Mandarin usable? | English usable? | mean ms |
| --- | --- | --- | --- | --- | --- | --- |
| elevenlabs (Scribe) |  |  |  |  |  |  |
| azure (zh-HK) |  |  |  |  |  |  |
| browser (by hand) |  |  |  |  |  |  |

"Usable" means: the user would tap send without editing, or with one obvious fix. A transcript
that is wrong in a way the user will not notice is worse than one that is obviously garbled.

## Per-device notes for the browser path

| device / browser | Cantonese zh-HK | Mandarin zh-CN | English en-HK | interim text? |
| --- | --- | --- | --- | --- |
| iOS Safari (demo phone) |  |  |  |  |
| Android Chrome |  |  |  |  |
| Desktop Chrome |  |  |  |  |

## Settings that won

| variable | value |
| --- | --- |
| `STT_PROVIDER` |  |
| `NEXT_PUBLIC_STT_MODE` |  |
| `ELEVENLABS_STT_MODEL` |  |

## Runs

<!-- tests/eval/stt.ts appends run tables below this line. -->

---

PICK: _(pending)_ because _(pending)_
