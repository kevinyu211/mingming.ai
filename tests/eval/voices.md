# Voice test (text-to-speech)

The decision record for research.md R5. Nothing about the voice is decided by spec sheet; it is
decided here, by ear, by people who speak the language.

**Status:** not run yet. `TTS_PROVIDER` stays `browser` until this file ends in a PICK line.

## How to run it

1. Put the keys you have in `.env.local` (see `.env.example`). A provider without keys is
   skipped, so one key is enough to start.
2. `npx tsx tests/eval/voices.ts` (or `--providers minimax,azure`). It renders the six fixed
   sentences from `tests/eval/sentences.json` into `tests/eval/out/voices/<provider>/<id>.mp3`
   and appends a run header below.
3. Play the files **blind** - do not say which provider is which - to **two native Cantonese
   listeners** and **one Mandarin listener**. Cantonese first; it is the hard case.
4. Fill the tables. Then write the PICK line at the bottom.

## The sentences

| id | dialect | what it tests |
| --- | --- | --- |
| `yue-warning` | yue | a warning sign, the card that must be understood on one listen |
| `yue-medicine` | yue | an English drug name and a number inside Cantonese |
| `yue-followup` | yue | a date and a hospital department |
| `cmn-warning` | cmn | same, Mandarin |
| `cmn-medicine` | cmn | a Chinese drug name and a number |
| `cmn-followup` | cmn | a date and a department |

## Scores

1 to 5, one row per listener per provider. **Tones**: does it read Cantonese with Cantonese
tones, or traditional characters with Mandarin phonology (the failure R5 names)? **Drug name**:
is "Amlodipine" recognisable as that word? **Numbers**: 5mg, one tablet, once a day, two weeks -
all correct and natural? **Sounds like a person**: a daughter explaining a piece of paper to her
mother, not a newsreader.

### Cantonese (listener 1, native Cantonese)

| provider | tones | drug name | numbers | sounds like a person | notes |
| --- | --- | --- | --- | --- | --- |
| minimax |  |  |  |  |  |
| elevenlabs |  |  |  |  |  |
| azure |  |  |  |  |  |
| browser (baseline) |  |  |  |  |  |

### Cantonese (listener 2, native Cantonese)

| provider | tones | drug name | numbers | sounds like a person | notes |
| --- | --- | --- | --- | --- | --- |
| minimax |  |  |  |  |  |
| elevenlabs |  |  |  |  |  |
| azure |  |  |  |  |  |
| browser (baseline) |  |  |  |  |  |

### Mandarin (listener 3, native Mandarin)

| provider | tones | drug name | numbers | sounds like a person | notes |
| --- | --- | --- | --- | --- | --- |
| minimax |  |  |  |  |  |
| elevenlabs |  |  |  |  |  |
| azure |  |  |  |  |  |
| browser (baseline) |  |  |  |  |  |

## Latency

From the run header appended by the script (time to the full clip, single request, no cache).

| provider | mean ms | worst ms | notes |
| --- | --- | --- | --- |
| minimax |  |  |  |
| elevenlabs |  |  |  |
| azure |  |  |  |

## Settings that won

Record the exact voice ids and model so the run is reproducible, and copy them into
`.env.example` (T020).

| variable | value |
| --- | --- |
| `TTS_PROVIDER` |  |
| `MINIMAX_TTS_MODEL` / `ELEVENLABS_MODEL` |  |
| voice id (yue) |  |
| voice id (cmn) |  |

The Cantonese winner and the Mandarin winner may be different providers; if they are, note it
here and open a follow-up, because the current adapter selects one provider for both.

## Runs

<!-- tests/eval/voices.ts appends run headers below this line. -->

## Run 2026-09-03T09:22:49.207Z

Providers: minimax
Sentences: yue-warning, yue-medicine, yue-followup, cmn-warning, cmn-medicine, cmn-followup
Audio: tests/eval/out/voices/<provider>/<id>.mp3

- minimax: 6/6 rendered, mean 7127 ms, 376.3 kB total

Score the files with the table above, then set the PICK line at the end of this file.


## Run 2026-09-03T09:20:33.580Z

Providers: minimax
Sentences: yue-warning, yue-medicine, yue-followup, cmn-warning, cmn-medicine, cmn-followup
Audio: tests/eval/out/voices/<provider>/<id>.mp3

- minimax: 3/6 rendered, mean 12554 ms, 167.9 kB total

Score the files with the table above, then set the PICK line at the end of this file.


---

PICK: _(pending)_ because _(pending - one sentence, in the listeners' words)_

## First live render — 2026-09-03

MiniMax `speech-02-hd`, six sentences, all rendered. Two things were wrong in our adapter and are
now fixed; both were invisible until the endpoint was actually called.

| What | Was | Is | Why it mattered |
| --- | --- | --- | --- |
| `language_boost` for Cantonese | `Cantonese` | `Chinese,Yue` | `Cantonese` is rejected outright (`2013 invalid params`) — no audio at all |
| `MINIMAX_GROUP_ID` | required | optional | The international host authenticates on the bearer key alone; the value is not on the console's API-key page, so requiring it blocked the voice for nothing |
| Mandarin voice id | `Chinese_Mandarin_Warm_Girl` | `female-tianmei` | The first does not exist (`2054 voice id not exist`) |

Latency: about 2 seconds per sentence after the first (the first call paid ~33 s of connection
setup on this network).

Cantonese voice under test: `Cantonese_crisp_reporter_vv2`, Kevin's pick. Files in
`tests/eval/out/voices/minimax/`. **Still to do: the blind listening test.** The name says
"reporter" and the brief asks for a daughter talking to her mother, so compare it against a
warmer Cantonese voice before locking it in.

PICK: not decided — needs the listening test.
