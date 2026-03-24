# otris docs web

Web-Chat UI und MCP-Server fuer die otris DOCUMENTS Dokumentation. Nutzt Claude Agent SDK oder OpenAI Codex SDK als AI-Backend. Die Dokumentation (995 Markdown-Seiten) ist im Vault enthalten und wird im Docker-Image gebacken.

## Features

- **Web-Chat**: Landing Page + Chat-UI mit Typewriter-Effekt, Tool-Fortschrittsanzeige, Speed-Toggle
- **MCP-Endpoints**: SSE (`/sse`) und Streamable HTTP (`/mcp`) fuer externe MCP-Clients
- **REST API**: `/api/search`, `/api/read`, `/api/list`, `/api/overview`, `/api/status`
- **Bridge-Switching**: Claude oder Codex per `BRIDGE` ENV Variable
- **Sicherheit**: Rate Limiting, Origin-Validation, DOMPurify, Tool-Whitelisting, Prompt-Injection-Schutz

## Quick Start

```bash
npm install
npm run dev           # Claude Bridge (default)
npm run dev:codex     # Codex Bridge
```

## Deployment (Docker)

```bash
docker build -t otris-docs .
docker run -d \
  --name otris-docs \
  --restart unless-stopped \
  -p 3000:3000 \
  -e BRIDGE=codex \
  -e ALLOWED_ORIGINS=http://SERVER-IP:3000 \
  -e ALLOW_NO_ORIGIN=true \
  otris-docs
```

Siehe [INSTALL-SERVER.md](INSTALL-SERVER.md) fuer Details.

## Fuer Entwickler (MCP-Client)

Verbinde deinen Coding-Agent per MCP mit dem Server:

```json
{
  "mcpServers": {
    "otris-docs": {
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

Siehe [INSTALL-DEVELOPER.md](INSTALL-DEVELOPER.md) fuer alle Optionen.

## Vault aktualisieren

Der Crawler braucht Playwright (Mac, nicht Docker):

```bash
npm run crawl:login   # Einmalig: Browser-Login
npm run crawl         # Vault aktualisieren
```

Siehe [UPDATE-VAULT.md](UPDATE-VAULT.md) fuer Details.

## Tests

```bash
npm test
```

## Architektur

Siehe [ARCHITECTURE.md](ARCHITECTURE.md).
