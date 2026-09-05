# Ming Ming · 明明 — the pipeline and every user flow, as Mermaid

Four diagrams, written from the code on `main` (5 September 2026). Paste any block into
[mermaid.live](https://mermaid.live), a Markdown viewer, or a slide tool that renders Mermaid.
File paths are the real ones so a judge can check any box against the repository.

## 1 · The pipeline: what runs where

```mermaid
flowchart LR
  subgraph Phone["Phone · Next.js web app · the only place anything is kept"]
    Capture["拍張紙 / 上載相片 / 用示範紙<br/>components/Capture.tsx · lib/client/sample.ts<br/>up to 6 pages (admitPages)"]
    Downscale["Downscale on the phone<br/>lib/image/downscale.ts<br/>2400 px long edge · JPEG 0.85 · EXIF dropped"]
    Chat["傾偈 · the conversation<br/>app/chat/page.tsx · components/chat/briefing.ts<br/>phase machine: intro → warnings → 明唔明 → medicines → end"]
    Store[("On-device store<br/>localStorage fitornot.v1<br/>lib/sheets/store.ts · lib/memory")]
    Track["跟進 · follow-up<br/>lib/rules/doses.ts · lib/rules/plan-from-reading.ts<br/>components/track/followup.ts"]
    Speech["Speech on the phone<br/>lib/speech/tts.ts · lib/speech/stt.ts<br/>one engine per hold"]
  end

  subgraph Vercel["Vercel Functions · stateless · nothing stored, nothing logged"]
    Read["POST /api/read<br/>app/api/read/route.ts<br/>240 s deadline · one schema retry · 8 MiB body cap"]
    Early["Early warning cards<br/>lib/server/early-cards.ts<br/>each red flag sent as its JSON closes"]
    Pipeline["Reading pipeline<br/>lib/server/reading-pipeline.ts<br/>card order · banned-term filter · quote check · unverified mark"]
    Phrase["POST /api/phrase<br/>one rephrase for a flagged card<br/>max 2 at a time, 10 s shared cap, then template"]
    Ask["POST /api/ask<br/>lib/server/ask-pipeline.ts<br/>gates → model → citations checked → early sentence"]
    Tts["POST /api/tts"]
    Stt["POST /api/stt"]
    Warm["POST /api/warm<br/>Vercel cron every 4 min + app open<br/>one constant card, nothing from a reader"]
    Rules["lib/rules · pure functions with tests<br/>card-order · banned-terms · refusal · crisis<br/>diet-line · doses · plan-from-reading · template-fallback"]
    Model["Model client<br/>lib/model/client.ts · anthropic-compat.ts<br/>frozen prompts · Zod schemas · 64k tokens · effort medium"]
  end

  subgraph Providers["Providers outside Hong Kong"]
    Gateway["Vercel AI Gateway<br/>Anthropic-compatible endpoint<br/>schema enforced server-side"]
    Claude["Claude Sonnet 5<br/>anthropic/claude-sonnet-5"]
    MiniMax["MiniMax speech-2.8-hd<br/>Cantonese · Mandarin · English"]
    OpenAI["OpenAI gpt-4o-mini-transcribe"]
  end

  Capture --> Downscale --> Read
  Read --> Model --> Gateway --> Claude
  Claude -. "streamed JSON" .-> Read
  Read --> Early --> Chat
  Read --> Pipeline
  Pipeline <--> Rules
  Pipeline -. "flagged sentence" .-> Phrase --> Model
  Pipeline --> Chat
  Chat <--> Store
  Chat --> Ask
  Ask <--> Rules
  Ask --> Model
  Ask --> Chat
  Chat <--> Speech
  Speech --> Tts --> MiniMax
  Speech --> Stt --> OpenAI
  Store --> Track --> Speech
  Warm -.-> Model

  classDef phone fill:#e3f1ea,stroke:#1e7a5a,color:#16201a
  classDef server fill:#ffffff,stroke:#5a665e,color:#16201a
  classDef gate fill:#fbeed0,stroke:#e2b646,color:#6a4700
  classDef ext fill:#eef0f3,stroke:#9aa69f,color:#16201a
  class Capture,Downscale,Chat,Store,Track,Speech phone
  class Read,Early,Pipeline,Phrase,Ask,Tts,Stt,Warm,Model server
  class Rules gate
  class Gateway,Claude,MiniMax,OpenAI ext
```

**Who does what.** The model does two things: read the page into fields, copied verbatim, and write
the sentence a daughter would say, in three languages. Code decides everything else: the order,
every refusal, the filter, whether a citation is accepted, how many doses remain, which dates
reach the plan. ESLint forbids anything under `lib/rules` from importing the model.

## 2 · User flow: scan a sheet

```mermaid
sequenceDiagram
  autonumber
  actor Family as Family (阿媽 + daughter)
  participant Phone as Phone web app
  participant Store as On-device store
  participant Read as /api/read
  participant Rules as lib/rules
  participant Model as Model client
  participant Gateway as Vercel AI Gateway
  participant Claude as Claude Sonnet 5
  participant Speech as /api/tts → MiniMax

  Family->>Phone: 拍張紙 · photograph up to 6 pages (or 上載相片, or 用示範紙 with no model call)
  Phone->>Phone: downscale to 2400 px JPEG, EXIF dropped · pages held in sessionStorage for one navigation
  Phone->>Read: POST /api/read (NDJSON stream opens)
  Read-->>Phone: status: reading (acknowledged in under a second)
  Read->>Model: readSheetStream · Zod schema · 64k tokens · effort medium
  Model->>Gateway: Anthropic-compatible request
  Gateway->>Claude: anthropic/claude-sonnet-5
  Claude-->>Model: streamed JSON, warning signs first
  Note over Read: each warning sign is sent the moment its JSON object closes (early: true)
  Read-->>Phone: card · early warning sign (~13 s on the English stage sheet)
  Model-->>Read: whole reading, validated against the schema (one retry if it fails and time remains)
  Read->>Rules: buildCards · CARD_ORDER (warnings first) · diet line · unreadable regions
  Read->>Rules: banned-term filter on every sentence · quote check · unverified mark
  Rules-->>Read: a flagged sentence gets one rephrase via /api/phrase, then a fixed template
  Read-->>Phone: cards (final set) · done — or retract the early ids if the reading was unusable
  Phone->>Phone: de-duplicate by id · validateReadingCards
  Phone->>Store: startSheet · save reading and cards · archive the previous sheet (keeps 5)
  Phone->>Phone: briefing phase machine: intro → red flags → 明唔明 → waiting
  Phone->>Speech: POST /api/tts · filtered card text → speech-2.8-hd → audio
  Phone-->>Family: red flags spoken first, then one medicine per turn · waits for 明白 / 再講一次 / a question
```

## 3 · User flow: ask a question

```mermaid
sequenceDiagram
  autonumber
  actor Family as Family
  participant Phone as Phone web app
  participant Stt as /api/stt → OpenAI
  participant Rules as lib/rules (phone and server)
  participant Ask as /api/ask
  participant Model as Model client → Gateway → Claude
  participant Speech as /api/tts → MiniMax
  participant Store as On-device store

  Family->>Phone: hold the bar (ChatBar) and speak, or tap and type
  Phone->>Phone: one engine per hold: MediaRecorder clip (fallback: browser SpeechRecognition)
  Phone->>Stt: POST /api/stt · recorded clip
  Stt-->>Phone: transcript · gpt-4o-mini-transcribe · shown before it is sent
  Phone->>Rules: crisis gate (lib/rules/crisis.ts) → referral card, no network
  Phone->>Rules: medicine-change gate (lib/rules/refusal.ts) → fixed refusal, no network
  Phone->>Ask: POST /api/ask · cards + question + inputLanguage + last turns (refused and crisis turns stripped) + memory brief ≤1200 chars
  Ask->>Rules: crisis gate, then medicine-change gate, again on the server
  Ask->>Model: answerStream · answer only from the cards
  Model-->>Ask: JSON: kind (sheet · general · boundary · chat · off_topic · none) · citedCardIds · three spoken forms
  Ask-->>Phone: early: the first spoken sentence, the moment it closes and passes the banned-term filter
  Ask->>Rules: citations must be card ids the server itself built · banned-term filter · quote check
  Rules-->>Ask: pass, or the fixed sentence 張紙冇講呢樣, or a template
  Ask-->>Phone: outcome: answer + sources + kind
  Phone->>Speech: POST /api/tts → speech-2.8-hd → audio
  Phone-->>Family: spoken answer · 睇張紙點寫 opens the printed line · general answers are labelled as general
  Phone->>Store: thread appended · memory appendExchange (last 50 questions · a crisis question is never recorded)
```

## 4 · Every user flow, from opening the app

```mermaid
flowchart TD
  Open["Open mingming.app"] --> Consent["Consent gate · components/ConsentGate.tsx<br/>interface language (繁 / 简 / EN) selectable before consent"]
  Consent -->|明白，開始| Home["記錄 · home<br/>active sheet + archive (up to 5)"]

  Home -->|拍張紙| Capture["Capture · up to 6 pages"]
  Home -->|上載相片| Capture
  Home -->|用示範紙| Sample["bundled sample sheet · lib/client/sample.ts<br/>whole UI, no model call"]
  Home -->|open an earlier sheet| Chat
  Capture --> ReadFlow["/api/read · diagram 2"] --> Chat["傾偈 · conversation"]
  Sample --> Chat

  Chat -->|明白 / 清楚| NextSection["next section · one medicine per turn · check-in wording rotates"] --> Chat
  Chat -->|再講一次| Repeat["repeat the same bubble"] --> Chat
  Chat -->|a question, spoken or typed| AskFlow["/api/ask · diagram 3"] --> Chat
  Chat -->|睇張紙點寫| Source["the printed line behind the sentence"]
  Chat -->|check-in 食咗 / 未食| Checkin["today's counter: 仲有 N 次 · never a clock time"]
  Chat -->|↺ 從頭講| Restart["restart the briefing · same sheet, nothing re-read"] --> Chat
  Chat -->|speaker toggle| Mute["text keeps typing, sound stops"]
  Chat -->|語言 · language| Lang["change dialect or interface language · briefing restarts"]

  Chat --> Track["跟進 · follow-up"]
  Track --> Doses["doses left today · lib/rules/doses.ts<br/>from the printed frequency · stopped medicines never counted"]
  Track --> Appt["appointment countdown · lib/rules/plan-from-reading.ts<br/>a date only when the printed form can mean one thing"]
  Track --> Warn["the warning signs again"]
  Track --> Recap["我哋講咗嘅 · how far, how many 明白, repeats, questions<br/>components/track/followup.ts"]
  Track --> Line["明明's one line · composed by code · spoken via /api/tts"]
  Track --> Share["分享俾屋企人 · plain text built on the phone · lib/share<br/>calendar file · lib/plan/ics.ts · all-day events only"]

  Home --> Settings["設定 · voice · language · data statement"]
  Settings -->|刪除所有資料| Wipe["the one storage key removed · sessionStorage cleared · audio cache dropped"]

  Background["Background · /api/warm · Vercel cron every 4 min and when the app opens<br/>one fixed model call keeps the answering path warm"]

  classDef screen fill:#e3f1ea,stroke:#1e7a5a,color:#16201a
  classDef flow fill:#ffffff,stroke:#5a665e,color:#16201a
  classDef rule fill:#fbeed0,stroke:#e2b646,color:#6a4700
  class Open,Consent,Home,Capture,Sample,Chat,Track,Settings screen
  class ReadFlow,AskFlow,NextSection,Repeat,Source,Restart,Mute,Lang,Share,Line,Recap,Warn,Wipe,Background flow
  class Checkin,Doses,Appt rule
```

**Numbers on the deployed build, 5 September.** English stage sheet: first red flag spoken at 13 s,
full sheet 39 s. Traditional Chinese stage sheet: 49 s and 65 s. Questions 4 to 9 s warm; a refusal
under 1 s because no model is called. 1,405 unit tests, 122 browser tests, live question sets 20/20
in Cantonese and 20/20 in Mandarin with 0 banned terms.
