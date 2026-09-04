# 聽得明 · Discharge Sheet Agent

Photograph a hospital discharge sheet (Hong Kong English or mainland 出院记录), hear it explained in
Cantonese or Mandarin with the warning signs first, and ask it questions that are answered only from
the page. Built for the Vital (Soft Healthcare) track of the AIx Origin Summit.

- Spec, plan, research and tasks: `specs/001-discharge-sheet-agent/`
- Constitution (the non-negotiable rules): `.specify/memory/constitution.md`
- Design brief: `design.md` · Rulebook: `rules.md` · Provider tests: `provider_shortlist.md`
- Submission pack: `docs/submission/` · Demo script: `docs/demo-script.md`

## Run

```bash
npm install
cp .env.example .env.local   # then `vercel env pull .env.local` for the Gateway token; voice keys optional
npm run dev
```

Open the LAN URL on a phone. Without an API key the model routes return 502 and the app offers the
bundled sample sheets (`/chat?sample=hk_en`), which exercise the whole UI.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Playwright live path and fallbacks on phone viewports (Chrome channel; model routes mocked) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint (includes the rules-must-not-import-model boundary) |
| `npm run eval -- --sheets all --runs 34` | Reading eval against a running server and a real key (SC-002, SC-003) |
| `./node_modules/.bin/tsx tests/eval/questions.ts` | Question eval (SC-006) |
| `./node_modules/.bin/tsx tests/eval/voices.ts` | Renders the listening-test sentences through every configured voice provider |

## Environment

See `.env.example`. Model calls go through the Vercel AI Gateway; `MODEL_READ` / `MODEL_ASK` are
Gateway slugs (`provider/model`) and default to `google/gemini-3.8-flash`. `TTS_PROVIDER` defaults
to `browser` (the phone's own voice); the demo build runs `minimax`. `.env.example` ships
`STT_PROVIDER=openai` with `NEXT_PUBLIC_STT_MODE=cloud`, so a spoken question is recorded and
transcribed by OpenAI; set both to `browser` to keep audio on the phone. What each provider receives
is spelled out in `docs/submission/data-statement.md`.

## Venue fallback

1. Hosted link (Vercel) with a QR code.
2. Laptop: `npm run build && npm start`, phone on the laptop's hotspot, QR to the LAN address.
3. Sample sheets inside the app if the model route is unreachable.

## Known environment quirks (macOS)

Two quirks on this development Mac, and they pull against each other:

1. Any Node process that loads TLS **hangs at exit**. `NODE_OPTIONS=--use-openssl-ca` fixes it,
   and the npm scripts set it.
2. That same flag **breaks outbound HTTPS from Node** — the OpenSSL CA store is empty here, so
   every request fails with `TypeError: fetch failed`. `curl` is unaffected, which makes it look
   like a code problem when it is not.

So: use the flag for anything that does **not** call the network (`vitest`, `tsc`, `eslint`,
`playwright`), and run anything that **does** without it:

```bash
env -u NODE_OPTIONS ./node_modules/.bin/tsx --env-file=.env.local tests/eval/voices.ts
```

The eval runners call `process.exit(0)`, so they do not hang without the flag.
Playwright uses the installed Google Chrome (`channel: "chrome"`); run
`npx playwright install chromium` if you prefer the bundled browser.

## Layout

```
app/            pages (/ 記錄, /chat 傾偈, /track 跟進, /capture, /settings; /read, /ask and /plan redirect) and API routes (read, ask, phrase, tts, stt)
components/     UI
lib/domain/     Zod schemas (single source of truth)
lib/model/      Anthropic client and frozen prompts (server only)
lib/rules/      deterministic gates: card order, banned terms, diet line, refusal, crisis, plan
lib/server/     read and ask pipelines, NDJSON streaming
lib/speech/     TTS/STT provider adapters and the client speech layer
lib/storage/    on-device state (one key, delete-everything)
lib/i18n/       UI strings (hant/hans/en), script conversion, data statement, referral resources
fixtures/       synthetic discharge sheets and expected readings
tests/          unit, e2e, eval
```
