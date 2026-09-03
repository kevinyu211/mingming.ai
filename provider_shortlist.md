# Provider shortlist and test matrix

Planning document, 2026-09-02. Nothing here is decided; every row is a candidate until the test
in section 5 picks it. Results go in `tests/eval/` once the repo exists.

## 1. Text-to-speech (the most important test)

Must sound like a person talking to a parent. Cantonese is the hard case: many "multilingual"
voices read traditional Chinese with Mandarin tones.

| # | Provider / model | Cantonese | Mandarin | Notes | Access |
| --- | --- | --- | --- | --- | --- |
| T1 | **MiniMax Speech** (speech-2.x HD) | Native voices; Jyutping tone overrides in parentheses | Yes | Best documented Cantonese of the general providers; pronunciation control for drug names and numbers | platform.minimax.io, API key |
| T2 | **ElevenLabs Eleven v3** (Multilingual v2 for Mandarin) | Unclear for speech; reports of Mandarin-tone reading | Excellent | Most natural English/Mandarin; include only if Cantonese passes blind test | elevenlabs.io, API key |
| T3 | **Azure Speech** zh-HK neural (HiuMaan, HiuGaai, WanLung); zh-CN (Xiaoxiao, Yunxi) | Yes | Yes | Reliable, SSML pauses/rates, slightly flat | Azure free tier F0, key + region |
| T4 | **Google Cloud TTS** yue-HK (Standard/WaveNet, newer HD voices if listed) | Yes | Yes | Solid, slightly synthetic | GCP key |
| T5 | **cantonese.ai** | Cantonese-only specialist | No | HK-trained, handles numbers/dates/mixed English | API key |
| T6 | **CantoVoice** | Cantonese-only specialist | No | Same pitch as T5; compare | API key |
| T7 | **Fish Audio** (Fish Speech S1) | Via voice clone/prompt | Yes | Open weights option; quality varies by voice | API key or self-host |
| T8 | **Volcano Engine 豆包 TTS** | Excellent 粤语 voices | Excellent | Needs mainland account; cross-border question for a HK demo | 火山引擎 account |
| T9 | **OpenAI gpt-4o-mini-tts** | Weak | OK | Control sample only | OpenAI key |
| T0 | **Browser speechSynthesis** (iOS Sin-ji zh-HK; Android Google 粤語) | Yes | Yes | The offline fallback and the baseline to beat | none |

## 2. Speech-to-text (questions in Cantonese, Mandarin, English)

Lower stakes: the user sees the transcript before sending.

| # | Provider | Cantonese | Notes | Access |
| --- | --- | --- | --- | --- |
| S1 | **ElevenLabs Scribe** | Documented | Fast, accurate, many languages | ElevenLabs key |
| S2 | **Azure Speech-to-Text** zh-HK | Yes | Mature, streaming | Azure key |
| S3 | **Google Cloud STT** yue-Hant-HK (Chirp) | Yes | Good HK coverage | GCP key |
| S4 | **Deepgram** (Nova) | Check zh-HK support at test time | Very fast if supported | Deepgram key |
| S5 | **OpenAI Whisper / gpt-4o-transcribe** | Whisper lists yue | Batch, not streaming | OpenAI key |
| S6 | **Volcano ASR** (豆包) | Excellent | Mainland account | 火山引擎 |
| S0 | **Browser SpeechRecognition** (webkit) | zh-HK on Chrome; verify iOS Safari | No key; the fallback | none |

## 3. Reading the page (photo → structured cards)

Two approaches: a vision model does everything in one call, or an OCR stage produces verbatim
lines and a text model structures them.

| # | Candidate | Approach | Notes | Access |
| --- | --- | --- | --- | --- |
| R1 | **Claude Opus 5** (`claude-opus-5`) | One vision call, structured output | Accuracy ceiling; ~US$0.06 per page | Anthropic key |
| R2 | **Claude Sonnet 5** (`claude-sonnet-5`) | Same | ~2.5x cheaper, faster; default only if it matches Opus on every medicine field | Anthropic key |
| R3 | **Gemini** (latest Pro and Flash at test time) | Same | Strong document OCR historically; check current model names | Google AI key |
| R4 | **OpenAI GPT-5 family** (vision) | Same | Comparison point | OpenAI key |
| R5 | **Azure Document Intelligence** (Read / Layout) | OCR stage → text model | Deterministic verbatim lines with positions; strong on printed Chinese and English | Azure key |
| R6 | **Google Document AI** | OCR stage | Same idea | GCP key |
| R7 | **PaddleOCR** | OCR stage, open source | Excellent Chinese OCR; self-host | none |
| R8 | **Tesseract** | OCR stage, open source | Control only | none |

## 4. Phrasing: plain language and dialect (cards → 粵語白話文 + 普通话)

Judged by a native speaker for naturalness and by diff for faithfulness (medicine strings must
stay verbatim).

| # | Candidate | Notes | Access |
| --- | --- | --- | --- |
| P1 | **Claude Opus 5** | Same call as reading (R1) or separate | Anthropic key |
| P2 | **Claude Sonnet 5** | Faster; test colloquial Cantonese quality | Anthropic key |
| P3 | **DeepSeek V3.x** | Strong Chinese, very cheap; Cantonese colloquial unverified; mainland provider (disclose cross-border) | platform.deepseek.com |
| P4 | **Qwen3** (Alibaba Model Studio, international region) | Strong Chinese incl. some Cantonese training; HK-reachable | Alibaba Cloud key |
| P5 | **Gemini** (latest) | Comparison | Google AI key |
| P6 | **GPT-5 family** | Comparison | OpenAI key |

## 5. Test protocol (one evening)

**Fixed inputs**
- 3 synthetic sheets: `hk_en`, `cn_zh`, `cn_zh_photo` (bad photo).
- 3 test sentences per dialect for voices: one warning sign, one medicine line with an English drug
  name and a number ("Amlodipine 5 mg, 一粒, 每日一次"), one follow-up date.
- 10 questions for speech-to-text: 4 Cantonese, 3 Mandarin, 3 English, recorded once by a native
  speaker on the demo phone.

**Text-to-speech (T-rows)**: render the 6 sentences with each provider; play blind to two native
Cantonese speakers and one Mandarin speaker; score 1 to 5 on tones, drug name, numbers, and
"sounds like a person"; note latency to first audio byte. Pick the top Cantonese voice and the top
Mandarin voice; they may differ.

**Speech-to-text (S-rows)**: run the 10 clips through each; count word errors; note latency.

**Reading (R-rows)**: run each sheet 5 times per candidate; diff against `expected.json` per field;
count invented items, missed items, unreadable flags; measure time to complete; scan every string
with the banned-term filter. Pass = zero invented medicines and exact medicine fields on all
three sheets.

**Phrasing (P-rows)**: take the reading from the winning R-row; have each P-row phrase the same
cards; native speaker rates Cantonese naturalness 1 to 5; diff medicine strings for verbatim
preservation; banned-term scan.

**Record** in `tests/eval/voices.md`, `tests/eval/stt.md`, `tests/eval/reading.md`,
`tests/eval/phrasing.md`. Each file ends with one line: the pick and why.

## 6. Keys needed to run everything

Anthropic, MiniMax, ElevenLabs, Azure (Speech + Document Intelligence, free tiers exist), Google
Cloud (TTS, STT, Document AI, Gemini), OpenAI, DeepSeek, Alibaba Model Studio, cantonese.ai,
CantoVoice, Fish Audio. Volcano Engine only if a mainland account is available. Minimum viable set
for a good decision: Anthropic + MiniMax + ElevenLabs + Azure.
