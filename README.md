# JARVIS PWA

A Jarvis-style, ChatGPT-like assistant that runs entirely on your own machine: an installable,
offline-capable Progressive Web App talking to a local LLM through [Ollama](https://ollama.com).

## Features

- Streaming chat (token-by-token, ChatGPT style) with markdown/code-block rendering
- Voice input via the Web Speech API, plus an optional **"Jarvis …"** wake word for hands-free use
- Spoken replies (speech synthesis), sentence-by-sentence while the answer streams
- Multiple conversations, persisted locally; editable persona / system prompt; model picker
- PWA: installable, standalone window, cached app shell for offline launch, share-target and `?q=` deep links
- 100% local — no cloud API keys, no data leaves the machine

## Requirements

- Node.js 20+
- Ollama with at least one chat model: `ollama pull llama3.2:3b`
- Chrome or Edge for voice features (Web Speech API)

## Run

```bash
npm install
npm start           # http://localhost:8787
```

Environment variables:

| Variable      | Default                  | Purpose                        |
| ------------- | ------------------------ | ------------------------------ |
| `PORT`        | `8787`                   | HTTP port                      |
| `OLLAMA_URL`  | `http://127.0.0.1:11434` | Ollama endpoint                |
| `MODEL`       | `llama3.2:3b`            | Default model                  |

## API

- `GET /api/health` — backend status and installed models
- `POST /api/chat` — `{ messages, model?, system? }`, responds with an SSE stream of `{ token }` / `{ done }`

## Notes

- Service-worker caching covers the app shell only; `/api/*` is always network-first so replies are never stale.
- Installing the PWA requires HTTPS (or `localhost`).
