# docsvault: Architektur

Web Chat UI für deine Markdown-Dokumentation. Der Bot läuft entweder über das Claude Agent SDK oder das OpenAI Codex SDK. Die MCP Tools (search, read, list, overview, status) stecken direkt im Server drin, kein externer Tool Server nötig (`src/tools/`).

## Dateistruktur

```
src/
  server.js              Express + WebSocket Server
  session-manager.js     Session-Lifecycle, Rate Limiting, Validierung
  claude-bridge.js       Bridge zu Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
  codex-bridge.js        Bridge zu OpenAI Codex SDK (@openai/codex-sdk)
  api-routes.js          REST API für externe MCP-Clients
  mcp-handler.js         MCP SSE + Streamable HTTP Endpoints (createMcpServer, version 0.2.0)
  mcp-stdio.js           MCP stdio-Transport (lokaler Start ohne HTTP-Server, z.B. für CLI-Clients)
  vault-registry.js      Vault-Discovery, _meta.json, toolPrefix, describeVaults()
  system-prompt.js       System-Prompt mit Safety- + Behavior-Rules
  tools/                 Internalisierte Tool-Handler (vault, search, read, list, overview, status)
  tools/search-index.js  BM25-Index auf Abschnittsebene (MiniSearch), Tokenizer + Umlaut-Folding
  tools/vault-cache.js   Pro-Vault-Cache (Manifest, Sections, Titel-Index, Suchindex), mtime-invalidiert
public/
  index.html             Landing + Chat UI
  app.js                 WebSocket Client, UI-Logik, Typewriter, Tool-Anzeige
  style.css              Dark Mode Styling
  logo.png               Intex Logo
  help/                  Installationshilfe
```

Transporte für die MCP Tools: SSE (`/sse` + `/messages`), Streamable HTTP (`/mcp`) und stdio (`src/mcp-stdio.js`, für lokal gestartete MCP Clients ohne laufenden HTTP Server).

## Architektur Überblick

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
vaults/
  ├── docs/         (via Volume-Mount, _meta.json; Seitenzahl via <prefix>_status)
  ├── team-notes/   (via Volume-Mount, _meta.json)
  └── ...
```

## Bridge Switching

Läuft komplett über eine Environment Variable:

```bash
npm run dev           # Claude (default)
npm run dev:codex     # Codex
npm run dev:claude    # Claude (explizit)
```

| | Claude Bridge | Codex Bridge |
|---|---|---|
| SDK | `@anthropic-ai/claude-agent-sdk` | `@openai/codex-sdk` |
| Model (fast) | claude-sonnet-4-6 | gpt-5.4 |
| Model (thorough) | claude-opus-4-6 | gpt-5.4 (Prompt Prefix) |
| Session | `query()` mit `--resume` | `thread.runStreamed()` (persistent) |
| Mode Steuerung | Model + maxTurns wechseln | Prompt Prefix pro Nachricht |
| Tool Events | `message.type === 'assistant'/'tool'/'result'` | `event.type === 'item.started/completed'` |

Beide Bridges exportieren dasselbe Interface, austauschbar ohne dass der Rest was merkt:
- `createSession()` → `{ warmUp(), send(content, mode), destroy(), ready, destroyed }`

## WebSocket Protokoll

### Server → Client

```js
{ type: 'session_init' }                                     // Session wird erstellt
{ type: 'vaults', list: [{ toolPrefix, name, description }] } // verfügbare Vaults (direkt nach Connect)
{ type: 'session_ready', toolPrefix: 'docs' }                 // Warm-up fertig, Input frei (mit gewähltem Vault)
{ type: 'chunk', content: '...' }                            // Text-Stream
{ type: 'tool_use', tool: 'docs_search', status: 'running' }  // Tool gestartet
{ type: 'tool_use', tool: 'docs_search', status: 'done' }     // Tool fertig
{ type: 'done' }                                             // Antwort komplett
{ type: 'error', message: '...' }                            // Fehler
{ type: 'report_saved' }                                     // Bug-Report gespeichert
```

### Client → Server

```js
{ type: 'select_vault', toolPrefix: 'docs' }                 // Vault wählen (vor erster Nachricht)
{ type: 'message', content: '...', mode: 'fast'|'thorough' } // Chat-Nachricht
{ type: 'report', description: '...', chatContext: [...] }    // Bug-Report
```

## Session Lifecycle

1. **Connect**: Client öffnet WebSocket, Server schickt `session_init` und direkt danach `vaults` (Liste aller verfügbaren Vaults)
2. **Vault Auswahl**: Bei genau 1 Vault wärmt der Server automatisch auf. Bei 2+ Vaults wartet er auf `select_vault` vom Client (das Frontend schickt den Default gleich mit). Sobald die erste `message` durch ist, ist der Vault gelockt, ein späteres `select_vault` wird einfach ignoriert.
3. **Warm Up**: Bridge erstellt die Session, schickt eine Init Query, Server antwortet mit `session_ready` (inkl. `toolPrefix` des gewählten Vaults)
4. **Chat**: Client schickt `message`, Server streamt `tool_use`/`chunk`/`done`
5. **Disconnect**: WebSocket schließt, Session wird sofort destroyed

Kein Reconnect, kein Session Persist. Jeder Page Load ist eine frische Session.

## MCP Integration

Die Tools liegen in `src/tools/` und kommen über drei Wege raus:
1. **Intern (Bridges)**: Claude Bridge verbindet sich per MCP SSE zum eigenen Server
2. **MCP SSE** (`/sse` + `/messages`): Für externe MCP Clients (Claude Code, Codex CLI, VS Code Copilot)
3. **REST API** (`/api/*`): Für simple HTTP Clients
4. **MCP Streamable HTTP** (`/mcp`): Alternatives MCP Transportprotokoll

| Tool | Zweck |
|---|---|
| `<prefix>_search` | Dokumentation durchsuchen |
| `<prefix>_technical_search` | Optionaler Suchpfad für die konfigurierte technische Section |
| `<prefix>_read` | Dokument lesen |
| `<prefix>_list` | Verzeichnis durchsuchen |
| `<prefix>_overview` | Übersicht laden |
| `<prefix>_status` | Status prüfen |

Pro Vault werden fünf Tools mit dem `toolPrefix` aus `_meta.json` registriert. Fehlt das Feld, wird der Prefix aus dem Ordnernamen abgeleitet. Setzt `_meta.json` eine existierende, kanonische `technicalSection` innerhalb des Vaults, kommt `<prefix>_technical_search` hinzu. Ohne Feld wird nur das vorhandene Standardverzeichnis `Scripting/TERAS API` erkannt. Die Toolmenge wird damit vollständig aus den Vault-Daten abgeleitet.

Die Tool-Beschreibungen sind bewusst ein bis zwei Sätze lang: sie liegen dauerhaft im Kontext, einmal pro Vault. Die Recherche-Methodik und der `searchHint` aus `_meta.json` stehen stattdessen einmal pro Server in den `instructions` der `initialize`-Response.

### Suche

`searchDocs()` läuft gegen den BM25-Index aus `tools/search-index.js`. Indexiert wird auf Abschnittsebene: ein Eintrag für den Introbereich und je Überschrift von `##` bis `######` mit den Feldern `title`, `heading`, `path`, `body`.

Gerankt wird in zwei Stufen:
1. **Abschnitt**: BM25-Score, gewichtet mit der IDF-Masse die dieser Abschnitt selbst abdeckt, plus Boost wenn die Überschrift komplett aus Query-Tokens besteht (`## hasInvoicePlugin`).
2. **Datei**: bester Abschnitt mal der quadrierten IDF-Abdeckung der ganzen Datei. Damit schlägt eine Datei die den seltenen Token trifft eine Datei die nur häufige Tokens oft trifft.

Die Registry sortiert Vaults nach `toolPrefix`. HTTP- und stdio-Startup bauen deren Indizes anschließend nacheinander mit `warmSearchIndex()` auf, bevor die Bridge beziehungsweise der Transport verbunden wird. Damit hängt die erste Suche nicht von einem Lazy-Aufbau ab. Der Cache invalidiert über die mtime von `_manifest.json`, ersatzweise über die mtime des Vault-Roots. Ein gemessener Vault mit etwa 1800 Seiten benötigt ungefähr 2 bis 8 Sekunden und 100 MB Heap.

### Antwortbudgets und REST-Kompatibilität

| Pfad | Default | Grenzen und Format |
|---|---|---|
| MCP `search` | 5 Treffer, `concise` | `max_results` 1 bis 100, `max_tokens` 50 bis 50000 |
| REST `search` | 10 Treffer, `detailed` | Gleiche Parameter, bewusst kompatibel zum bisherigen REST-Verhalten |
| MCP `read` | 8000 Zeichen | `max_length` effektiv 200 bis 25000 |
| REST `read` | 8000 Zeichen | `max_length` effektiv 200 bis 200000 |
| MCP `list` | 50 Seiten | `max_results` 1 bis 500 |
| REST `list` | ungekürzt | Gibt weiterhin das vollständige Array zurück |

`max_tokens` wird bei `search` und `read` als `max_tokens * 4` Zeichen angenähert. Die MCP-Read-Schicht begrenzt damit den finalen Text einschließlich Titel und Quelle. Beim REST-Read gilt das Budget für den Dokumentinhalt; der JSON-Umschlag kann größer sein.

Claude Bridge: explizit über `allowedTools` + `disallowedTools` (alle Built-in Tools gesperrt).
Codex Bridge: nutzt MCP über die Codex CLI Config.

## Environment Variables

| Variable | Default | Beschreibung |
|---|---|---|
| `BRIDGE` | `claude` | `claude` oder `codex`. **Achtung:** Das mitgelieferte Docker Image setzt `BRIDGE=codex` (Image Override) |
| `PORT` | `3000` | Server Port |
| `VAULTS_ROOT` | `./vaults` | Wurzel Verzeichnis der Vaults (Volume Mount). Docker Image setzt `/app/vaults`. (`VAULT_PATH` ist deprecated) |
| `MAX_SESSIONS` | `50` | Max gleichzeitige Sessions |
| `RATE_LIMIT_PER_MIN` | `10` | Max WebSocket Messages pro Minute/IP |
| `MAX_MESSAGE_LENGTH` | `2000` | Max Zeichen pro Nachricht |
| `TRUST_PROXY` | kein | Express trust proxy (für Reverse Proxy) |
| `ALLOW_NO_ORIGIN` | `false` | WebSocket ohne Origin Header erlauben (für REST/MCP Clients nötig) |
| `ALLOWED_ORIGINS` | kein | Komma separierte erlaubte WebSocket Origins |
| `CLAUDE_PATH` | kein | Pfad zur Claude Code CLI |
| `CODEX_PATH` | kein | Pfad zur Codex CLI |
| `CODEX_MODEL` | `gpt-5.4` | Model für Codex Bridge |
| `MCP_CWD` | Projekt Root | Arbeitsverzeichnis für MCP |
| `MCP_SSE_URL` | `http://localhost:$PORT/sse` | SSE URL für Claude Bridge MCP Verbindung |
| `API_RATE_LIMIT_PER_MIN` | `60` | Max REST API Requests pro Minute/IP |
| `API_TOKEN` | kein | Wenn gesetzt: erzwingt Bearer Token Auth (`Authorization: Bearer <TOKEN>`) auf `/api`, `/sse`, `/messages`, `/mcp` und dem WebSocket. Unset = offen (Default) |

## Frontend (app.js)

### Features
- **Typewriter Effekt**: Chunks werden zeichenweise gerendert (3 chars/12ms)
- **Tool Block**: Klappbarer Fortschrittsblock ("Doku wird durchsucht..." → "X Quellen durchsucht")
- **Auto Scroll**: Stoppt sobald man manuell hochscrollt (wheel/touch), plus Scroll to Bottom Button
- **Speed Toggle**: Schnell (Lightning) / Gründlich (Search), schickt `mode` mit
- **Bug Report**: Overlay Modal, sammelt die letzten 10 Chat Messages als Kontext
- **Session Status**: "Wird vorbereitet..." → "Bereit" mit Fade Out
- **Markdown**: marked.js + highlight.js + DOMPurify (XSS Schutz)

### Cancel Mechanismus
1. Client schließt den WebSocket (`ws.onmessage = null, ws.close()`)
2. Server merkt `ws.readyState !== 1` und bricht den Generator ab
3. Bridge: `AbortController.abort()` killt die laufende SDK Query
4. Client öffnet einen neuen WebSocket, frische Session

## Sicherheit

- **Prompt Injection**: System Prompt mit strikten Regeln, Social Engineering Abwehr
- **Tool Whitelist**: Nur docsvault MCP Tools erlaubt, alle Built-in Tools gesperrt
- **Rate Limiting**: IP-basiert, proxy-aware via `trust proxy` (WebSocket + REST)
- **WebSocket**: Origin Validierung, 16KB Payload Limit, Heartbeat
- **XSS**: DOMPurify auf allen Markdown Outputs, `CSS.escape` in Selektoren
- **Error Filtering**: generische Messages an den Client, keine Internals
- **Bug Reports**: JSONL append only (keine Race Condition), chatContext sanitized
- **Auth (opt-in)**: `API_TOKEN` schaltet Bearer Token Auth auf `/api`, `/sse`, `/messages`, `/mcp` und dem WebSocket frei. Ohne `API_TOKEN` sind diese Endpoints offen.

> **Wichtig, mach dir keine Illusionen:** Die Origin Validierung schützt **nur den WebSocket**. REST (`/api`) und MCP (`/sse`, `/messages`, `/mcp`) haben **keinen Origin Check** und ohne gesetztes `API_TOKEN` auch **keine Auth**. Wer den Port erreicht, kann den Vault lesen. Rate Limiting bremst Missbrauch, ist aber keine Zugriffskontrolle. Für öffentliche Deployments also `API_TOKEN` setzen oder den Port hinter Reverse Proxy / VPN dichtmachen.

## Dependencies

| Package | Zweck |
|---|---|
| `express` | HTTP Server |
| `ws` | WebSocket Server |
| `@anthropic-ai/claude-agent-sdk` | Claude Bridge |
| `@openai/codex-sdk` | Codex Bridge |
| `minisearch` | BM25-Volltextindex auf Abschnittsebene |

Frontend (CDN): `marked.js`, `highlight.js`, `dompurify.js`
