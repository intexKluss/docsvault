# otris-docs-web — Architektur

Web-Chat UI fuer die otris DOCUMENTS Dokumentation. Bot nutzt entweder Claude Agent SDK oder OpenAI Codex SDK. Die MCP-Tools (search, read, list, overview, status) sind direkt im Server internalisiert (`src/tools/`).

## Dateistruktur

```
src/
  server.js              Express + WebSocket Server
  session-manager.js     Session-Lifecycle, Rate Limiting, Validierung
  claude-bridge.js       Bridge zu Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
  codex-bridge.js        Bridge zu OpenAI Codex SDK (@openai/codex-sdk)
  api-routes.js          REST API fuer externe MCP-Clients
  mcp-handler.js         MCP SSE + Streamable HTTP Endpoints
  tools/                 Internalisierte Tool-Handler (vault, search, read, list, overview, status)
public/
  index.html             Landing + Chat UI
  app.js                 WebSocket Client, UI-Logik, Typewriter, Tool-Anzeige
  style.css              Dark Mode Styling
  logo.png               Intex Logo
  help/                  Installationshilfe
```

## Architektur-Ueberblick

```
Browser (app.js)
    | WebSocket (JSON)
    v
server.js (Express + ws)
    |-- SessionManager (1 Session pro Client)
    |-- Message Queue + Rate Limiting
    |-- Bridge Loader (ENV: BRIDGE=claude|codex)
    v
claude-bridge.js               codex-bridge.js
  query() mit resume             thread.runStreamed()
    |                              |
    v                              v
src/tools/ (search, read, list, overview, status)
    |
    v
vault/ (995 Markdown-Dateien)
```

## Bridge-Switching

Per Environment Variable:

```bash
npm run dev           # Claude (default)
npm run dev:codex     # Codex
npm run dev:claude    # Claude (explizit)
```

| | Claude Bridge | Codex Bridge |
|---|---|---|
| SDK | `@anthropic-ai/claude-agent-sdk` | `@openai/codex-sdk` |
| Model (fast) | claude-sonnet-4-6 | gpt-5.4 |
| Model (thorough) | claude-opus-4-6 | gpt-5.4 (Prompt-Prefix) |
| Session | `query()` mit `--resume` | `thread.runStreamed()` (persistent) |
| Mode-Steuerung | Model + maxTurns wechsel | Prompt-Prefix pro Nachricht |
| Tool Events | `message.type === 'assistant'/'tool'/'result'` | `event.type === 'item.started/completed'` |

Beide Bridges exportieren das gleiche Interface:
- `createSession()` → `{ warmUp(), send(content, mode), destroy(), ready, destroyed }`

## WebSocket-Protokoll

### Server → Client

```js
{ type: 'session_init' }                                     // Session wird erstellt
{ type: 'session_ready' }                                    // Warm-up fertig, Input frei
{ type: 'chunk', content: '...' }                            // Text-Stream
{ type: 'tool_use', tool: 'otris_search', status: 'running' } // Tool gestartet
{ type: 'tool_use', tool: 'otris_search', status: 'done' }    // Tool fertig
{ type: 'done' }                                             // Antwort komplett
{ type: 'error', message: '...' }                            // Fehler
{ type: 'report_saved' }                                     // Bug-Report gespeichert
```

### Client → Server

```js
{ type: 'message', content: '...', mode: 'fast'|'thorough' } // Chat-Nachricht
{ type: 'report', description: '...', chatContext: [...] }    // Bug-Report
```

## Session-Lifecycle

1. **Connect**: Client oeffnet WebSocket → Server sendet `session_init`
2. **Warm-Up**: Bridge erstellt Session, sendet Init-Query → Server sendet `session_ready`
3. **Chat**: Client sendet `message` → Server streamt `tool_use`/`chunk`/`done`
4. **Disconnect**: WebSocket schliesst → Session wird sofort destroyed

Kein Reconnect, kein Session-Persist. Jeder Page-Load = neue Session.

## MCP-Integration

Tools sind in `src/tools/` internalisiert und werden ueber drei Wege bereitgestellt:
1. **Intern (Bridges)**: Claude Bridge verbindet sich per MCP SSE zum eigenen Server
2. **MCP SSE** (`/sse` + `/messages`): Fuer externe MCP-Clients (z.B. otris-docs-mcp)
3. **REST API** (`/api/*`): Fuer einfache HTTP-Clients
4. **MCP Streamable HTTP** (`/mcp`): Alternatives MCP-Transportprotokoll

| Tool | Zweck |
|---|---|
| `otris_search` | Dokumentation durchsuchen |
| `otris_read` | Dokument lesen |
| `otris_list` | Verzeichnis durchsuchen |
| `otris_overview` | Uebersicht laden |
| `otris_status` | Status pruefen |

Claude Bridge: Explizit als `allowedTools` + `disallowedTools` (alle Built-in Tools gesperrt).
Codex Bridge: Nutzt MCP ueber Codex CLI Config.

## Environment Variables

| Variable | Default | Beschreibung |
|---|---|---|
| `BRIDGE` | `claude` | `claude` oder `codex` |
| `PORT` | `3000` | Server Port |
| `MAX_SESSIONS` | `50` | Max gleichzeitige Sessions |
| `RATE_LIMIT_PER_MIN` | `10` | Max Messages pro Minute/IP |
| `MAX_MESSAGE_LENGTH` | `2000` | Max Zeichen pro Nachricht |
| `TRUST_PROXY` | — | Express trust proxy (fuer Reverse Proxy) |
| `ALLOW_NO_ORIGIN` | — | WebSocket ohne Origin erlauben |
| `ALLOWED_ORIGINS` | — | Komma-separierte erlaubte Origins |
| `CLAUDE_PATH` | — | Pfad zur Claude Code CLI |
| `CODEX_PATH` | — | Pfad zur Codex CLI |
| `CODEX_MODEL` | `gpt-5.4` | Model fuer Codex Bridge |
| `MCP_CWD` | Projekt-Root | Arbeitsverzeichnis fuer MCP |
| `MCP_SSE_URL` | `http://localhost:$PORT/sse` | SSE-URL fuer Claude Bridge MCP-Verbindung |
| `API_RATE_LIMIT_PER_MIN` | `60` | Max REST API Requests pro Minute/IP |

## Frontend (app.js)

### Features
- **Typewriter-Effekt**: Chunks werden zeichenweise gerendert (3 chars/12ms)
- **Tool-Block**: Klappbarer Fortschrittsblock ("Doku wird durchsucht..." → "X Quellen durchsucht")
- **Auto-Scroll**: Stoppt bei manuellem Hochscrollen (wheel/touch), Scroll-to-Bottom Button
- **Speed Toggle**: Schnell (Lightning) / Gruendlich (Search) — sendet `mode` mit
- **Bug-Report**: Overlay-Modal, sammelt letzte 10 Chat-Messages als Kontext
- **Session-Status**: "Wird vorbereitet..." → "Bereit" mit Fade-Out
- **Markdown**: marked.js + highlight.js + DOMPurify (XSS-Schutz)

### Cancel-Mechanismus
1. Client schliesst WebSocket (`ws.onmessage = null, ws.close()`)
2. Server erkennt `ws.readyState !== 1` → bricht Generator ab
3. Bridge: `AbortController.abort()` killt laufende SDK-Query
4. Client oeffnet neuen WebSocket → neue Session

## Sicherheit

- **Prompt Injection**: System-Prompt mit strikten Regeln, Social-Engineering-Abwehr
- **Tool-Whitelist**: Nur otris-docs MCP Tools erlaubt, alle Built-in Tools gesperrt
- **Rate Limiting**: IP-basiert, proxy-aware via `trust proxy`
- **WebSocket**: Origin-Validierung, 16KB Payload-Limit, Heartbeat
- **XSS**: DOMPurify auf allen Markdown-Outputs, `CSS.escape` in Selektoren
- **Error Filtering**: Generische Messages an Client, keine Internals
- **Bug Reports**: JSONL append-only (keine Race Condition), chatContext sanitized

## Dependencies

| Package | Zweck |
|---|---|
| `express` | HTTP Server |
| `ws` | WebSocket Server |
| `@anthropic-ai/claude-agent-sdk` | Claude Bridge |
| `@openai/codex-sdk` | Codex Bridge |

Frontend (CDN): `marked.js`, `highlight.js`, `dompurify.js`
