# NovaChat

A personal, ChatGPT-style AI assistant — streaming chat, voice-to-voice
conversation, Google Search grounding, and multi-conversation memory.
**Phase 2: fully wired to real APIs** — Groq (LLM), Cartesia (voice), SerpApi
(search) — all proxied through local Next.js API routes so keys never touch
the browser.

## Quick start

```bash
npm install
cp .env.local.example .env.local   # fill in your keys
npm run dev    # http://localhost:3000
npm run build  # production build
```

### Keys

| Env var | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Chat completions — `openai/gpt-oss-120b` (default), `openai/gpt-oss-20b` selectable in Settings (Groq retired the llama-3.3/3.1 IDs on current accounts) |
| `CARTESIA_API_KEY` | TTS (`sonic-latest`, `/tts/bytes`) + STT (`ink-whisper`, `/stt`) |
| `SERPAPI_API_KEY` | Google Search grounding via [SerpApi](https://serpapi.com) (`/search.json?engine=google`) |

Env vars are server-side only and take precedence. If a key is blank in
`.env.local`, the app falls back to the same key entered in **Settings →
API keys** (held in memory for the session, sent only to NovaChat's own
`/api/*` routes, cleared on reload). Missing keys produce actionable toast
errors — nothing crashes.

## Architecture

Every external call goes through a Next.js API route. Client components never
talk to Groq/Cartesia/SerpApi directly.

| Route | Upstream | Notes |
| --- | --- | --- |
| `POST /api/chat` | `https://api.groq.com/openai/v1/chat/completions` via `groq-sdk`, `stream: true` | Optional SerpApi grounding first; streams SSE (`phase` / `meta` / `delta` / `error` / `done`); system prompt carries today's date + web results |
| `POST /api/search` | `https://serpapi.com/search.json` | Top 5 organic results (title, snippet, link) for grounding + citation chips |
| `POST /api/tts` | `https://api.cartesia.ai/tts/bytes` | Returns `audio/mpeg`; voice ID from Settings; `Cartesia-Version` pinned |
| `POST /api/stt` | `https://api.cartesia.ai/stt` | Multipart audio (webm/wav/…) → `ink-whisper` transcript |

Supporting modules:

- `lib/server/search.ts` — SerpApi client shared by `/api/search` and `/api/chat`
- `lib/client.ts` — browser transport (SSE parser, single audio element for TTS
  with barge-in support, STT upload)
- `lib/data.ts` — static config: Groq models, Cartesia voices, suggestion cards
- `/lib/mock` was **deleted** in Phase 2 — nothing imports it
- `/store` — Zustand stores; chat history persists in `localStorage`
  (`novachat-chat`); API keys are never persisted

Voice mode runs a real state machine (`listening → transcribing → thinking →
speaking → listening`) with energy-based VAD endpointing (~1.4s silence ends a
turn) and barge-in: sustained user speech during Nova's playback cuts the
Cartesia TTS and starts a new utterance. Voice exchanges are appended to your
chat history when the conversation settles.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn-style primitives ·
Zustand (persisted) · Framer Motion · groq-sdk · react-markdown +
react-syntax-highlighter · lucide-react

## Layout

- `/app` — routes (`/` shell + `/api/*` routes)
- `/components/chat` — sidebar, transcript, composer, welcome, code blocks
- `/components/voice` — full-screen voice mode (orb + live captions)
- `/components/settings` — slide-over settings (model, voice + preview, theme, keys)
- `/lib/server` — server-side upstream clients
- `/lib/client.ts` — browser transport for the API routes

## Design notes

- **Accent "Ember"** (`#b44a26` light / `#e08a54` dark): warm clay, deliberately
  not the default blue/purple AI gradient; pairs with warm paper/ink neutrals.
- Dark mode is the default; `light` / `dark` / `system` are all first-class.
- Responsive: desktop rail (collapsible to icon-only), tablet, mobile drawer;
  voice mode is a full-screen takeover.

## Keyboard shortcuts

- `Alt+N` — new chat · `Enter` — send · `Shift+Enter` — newline
- `Esc` — close settings / sidebar drawer

## Known limits

- Attachment button is a UI-only stub (clips never leave the device).
- Seeded demo conversations were removed in Phase 2; history accumulates from
  real usage. Clear `novachat-chat` in localStorage to reset.
- Cartesia voice IDs in `lib/data.ts` are library IDs — the first entry is the
  docs-canonical example; verify the rest against your account's voice list at
  play.cartesia.ai/voices and swap IDs freely (they are just strings).
- No automated tests yet; verified manually against dev server.
