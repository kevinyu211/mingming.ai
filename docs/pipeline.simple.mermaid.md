# Ming Ming · 明明 — the simple set

The same pipeline and flows as `pipeline.mermaid.md`, redrawn for slides: fewer boxes, short
labels, one colour per layer (green = on the phone, white = Vercel, amber = the rules, grey =
outside providers). File names live in the detailed set, not here.

## 1 · What runs where

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "Helvetica Neue, Arial, PingFang HK, sans-serif", "fontSize": "16px", "primaryColor": "#ffffff", "primaryTextColor": "#16201a", "primaryBorderColor": "#5a665e", "lineColor": "#5a665e", "clusterBkg": "#f7f8f5", "clusterBorder": "#d6ddd6", "edgeLabelBackground": "#ffffff"}, "flowchart": {"curve": "basis", "nodeSpacing": 40, "rankSpacing": 70, "padding": 12}}}%%
flowchart LR
  subgraph P["📱 On the phone"]
    direction TB
    Scan(["拍張紙 · scan the sheet"])
    Talk(["傾偈 · talk it through"])
    Track(["跟進 · keep the day"])
    Store[("one key on the phone<br/>reading · thread · counters")]
  end

  subgraph V["☁️ Vercel · stateless functions"]
    direction TB
    Read["/api/read<br/>photo → cards"]
    Ask["/api/ask<br/>question → answer"]
    Speech["/api/tts · /api/stt<br/>voice out · voice in"]
    Rules{{"Rules<br/>order · refusals<br/>filter · citations"}}
    Model["Model client<br/>schemas · prompts"]
  end

  subgraph X["🌐 Providers outside Hong Kong"]
    direction TB
    Claude["Claude Sonnet 5<br/>via Vercel AI Gateway"]
    MiniMax["MiniMax voice"]
    OpenAI["OpenAI transcription"]
  end

  Scan ==> Read ==> Model ==> Claude
  Read --> Rules --> Talk
  Talk ==> Ask --> Rules
  Ask --> Model
  Talk <--> Store --> Track
  Talk --> Speech
  Speech --> MiniMax
  Speech --> OpenAI

  classDef phone fill:#e3f1ea,stroke:#1e7a5a,color:#16201a,stroke-width:1.5px
  classDef server fill:#ffffff,stroke:#5a665e,color:#16201a
  classDef gate fill:#fbeed0,stroke:#e2b646,color:#6a4700,stroke-width:1.5px
  classDef ext fill:#eef0f3,stroke:#9aa69f,color:#16201a
  class Scan,Talk,Track,Store phone
  class Read,Ask,Speech,Model server
  class Rules gate
  class Claude,MiniMax,OpenAI ext
  linkStyle 0,1,2,6 stroke:#1e7a5a,stroke-width:2.5px
```

Thick green arrows are the two main paths: a photo becoming cards, and a question becoming an answer.
Every card and every answer passes the rules box before the phone shows or speaks it.

## 2 · Scan a sheet

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "Helvetica Neue, Arial, PingFang HK, sans-serif", "fontSize": "15px", "actorBkg": "#e3f1ea", "actorBorder": "#1e7a5a", "actorTextColor": "#16201a", "signalColor": "#5a665e", "signalTextColor": "#16201a", "activationBkgColor": "#e3f1ea", "activationBorderColor": "#1e7a5a", "noteBkgColor": "#fbeed0", "noteBorderColor": "#e2b646", "noteTextColor": "#6a4700", "sequenceNumberColor": "#ffffff"}, "sequence": {"mirrorActors": false, "actorMargin": 40, "messageMargin": 44, "boxMargin": 10}}}%%
sequenceDiagram
  autonumber
  actor F as Family
  participant P as Phone
  participant R as /api/read
  participant G as Rules
  participant C as Claude Sonnet 5<br/>(via Gateway)
  participant M as MiniMax

  F->>P: photograph the sheet (up to 6 pages)
  P->>R: send the pages, 2400 px, nothing else
  R->>C: read the page into fields, verbatim
  C-->>R: warning signs stream back first
  R-->>P: first red flag card at ~13 s
  C-->>R: the whole reading
  R->>G: order · banned terms · quote check
  G-->>R: cards that passed
  R-->>P: all cards · done
  P->>P: save on the phone · archive the last sheet
  P->>M: card text → Cantonese audio
  P-->>F: red flags first · one medicine per turn · waits for 明白
```

## 3 · Ask a question

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "Helvetica Neue, Arial, PingFang HK, sans-serif", "fontSize": "15px", "actorBkg": "#e3f1ea", "actorBorder": "#1e7a5a", "actorTextColor": "#16201a", "signalColor": "#5a665e", "signalTextColor": "#16201a", "activationBkgColor": "#e3f1ea", "activationBorderColor": "#1e7a5a", "noteBkgColor": "#fbeed0", "noteBorderColor": "#e2b646", "noteTextColor": "#6a4700", "sequenceNumberColor": "#ffffff"}, "sequence": {"mirrorActors": false, "actorMargin": 40, "messageMargin": 44}}}%%
sequenceDiagram
  autonumber
  actor F as Family
  participant P as Phone
  participant O as OpenAI
  participant G as Rules
  participant A as /api/ask
  participant C as Claude Sonnet 5<br/>(via Gateway)
  participant M as MiniMax

  F->>P: hold the bar and ask
  P->>O: the recording → text
  P->>G: crisis or medicine change? refused on the phone, no network
  P->>A: question + the cards + the last turns
  A->>G: the same gates again
  A->>C: answer only from the cards
  C-->>A: answer · kind · which cards it used
  A->>G: citations must be real cards · banned terms
  A-->>P: first sentence early, then the rest
  P->>M: text → audio
  P-->>F: spoken answer · tap 睇張紙點寫 for the printed line
```

## 4 · Every screen and action

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "Helvetica Neue, Arial, PingFang HK, sans-serif", "fontSize": "15px", "primaryColor": "#ffffff", "primaryTextColor": "#16201a", "primaryBorderColor": "#5a665e", "lineColor": "#5a665e", "edgeLabelBackground": "#ffffff"}, "flowchart": {"curve": "basis", "nodeSpacing": 36, "rankSpacing": 56, "padding": 14}}}%%
flowchart LR
  Open(["Open mingming.app"]) --> Consent(["Consent<br/>pick 繁 / 简 / EN first"]) --> Home(["記錄 · home<br/>this sheet + up to 5 earlier"])

  Home --> Start["Start a sheet<br/>─────────────<br/>拍張紙 · camera<br/>上載相片 · upload<br/>用示範紙 · sample, no model<br/>open an earlier sheet"]
  Start ==> Chat(["傾偈 · 明明 reads<br/>red flags first, then one medicine per turn<br/>waits for 明白 before going on"])
  Chat --> Acts["While he talks<br/>─────────────<br/>明白 → next section<br/>再講一次 → repeat<br/>ask anything → answered from the sheet<br/>睇張紙點寫 → the printed line<br/>食咗 / 未食 → today's counter<br/>↺ 從頭講 → start over, nothing re-read"]
  Chat ==> Track["跟進 · keep the day<br/>─────────────<br/>doses left today · never a clock time<br/>appointment countdown<br/>the warning signs again<br/>我哋講咗嘅 · what we covered<br/>分享俾屋企人 · share"]
  Home -.-> Settings["設定<br/>voice · language · data statement<br/>刪除所有資料 · one tap wipes everything"]

  classDef screen fill:#e3f1ea,stroke:#1e7a5a,color:#16201a,stroke-width:1.5px
  classDef list fill:#ffffff,stroke:#5a665e,color:#16201a,text-align:left
  class Open,Consent,Home,Chat,Track screen
  class Start,Acts,Settings list
  linkStyle 3,5 stroke:#1e7a5a,stroke-width:2.5px
```

Green pills are screens; white cards list what you can do there. Thick arrows are the path
the demo walks: start a sheet, hear it read, keep the day.
