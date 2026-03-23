# otris docs web

Web-Chat UI für die otris DOCUMENTS Dokumentation. Nutzt Codex CLI mit der otris-docs-mcp im Hintergrund.

## Voraussetzungen

- Node.js >= 20
- [Codex CLI](https://github.com/openai/codex) mit ChatGPT Business Login
- [otris-docs-mcp](https://github.com/leminkozey/otris-docs-mcp) global installiert

## Setup

```bash
git clone https://github.com/intexKluss/otris-docs-web.git
cd otris-docs-web
git submodule update --init
npm install
```

### Codex CLI einloggen

```bash
codex
# → "Sign in with ChatGPT" auswählen
```

### MCP konfigurieren

In `~/.codex/config.toml`:

```toml
[mcp_servers.otris-docs]
command = "otris-docs-mcp"
```

## Starten

```bash
npm start
```

Oder mit pm2:

```bash
pm2 start src/server.js --name otris-docs-web
```

## Umgebungsvariablen

| Variable | Default | Beschreibung |
|---|---|---|
| `PORT` | 3000 | Server-Port |
| `MAX_SESSIONS` | 50 | Max. gleichzeitige Chat-Sessions |
| `SESSION_TIMEOUT_MIN` | 30 | Inaktivitäts-Timeout in Minuten |
| `RATE_LIMIT_PER_MIN` | 10 | Max. Nachrichten pro Minute pro IP |
| `MAX_MESSAGE_LENGTH` | 2000 | Max. Zeichen pro Nachricht |

## Architektur

```
Browser
  │ WebSocket
Node.js Server (Express)
  ├── Session Manager (1 Session pro Chat)
  ├── Codex CLI Sessions (@openai/codex-sdk)
  └── otris-docs-mcp (Dokumentationssuche)
```

## Tests

```bash
npm test
```
