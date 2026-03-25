# otris docs web

Web-Chat UI und MCP-Server für die otris DOCUMENTS Dokumentation. Nutzt Claude Agent SDK oder OpenAI Codex SDK als AI-Backend. Die Dokumentation (995 Markdown-Seiten) ist im Vault enthalten und wird im Docker-Image gebacken.

## Features

- **Web-Chat**: Landing Page + Chat-UI mit Typewriter-Effekt, Tool-Fortschrittsanzeige, Speed-Toggle
- **MCP-Endpoints**: SSE (`/sse`) und Streamable HTTP (`/mcp`) für externe MCP-Clients
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

Siehe [INSTALL-SERVER.md](INSTALL-SERVER.md) für Details.

## Für Entwickler (MCP-Client)

Verbinde deinen Coding-Agent per MCP mit dem Server:

```bash
claude mcp add --transport sse otris-docs http://SERVER-IP:3000/sse
```

Oder manuell in `.mcp.json`:

```json
{
  "mcpServers": {
    "otris-docs": {
      "type": "sse",
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

Siehe [INSTALL-DEVELOPER.md](INSTALL-DEVELOPER.md) für alle Optionen.

## Nützliche Befehle

### Container

```bash
docker logs otris-docs                    # Logs anzeigen
docker logs otris-docs --tail 50          # Letzte 50 Zeilen
docker logs otris-docs -f                 # Logs live verfolgen
docker restart otris-docs                 # Neustart
docker stop otris-docs                    # Stoppen
docker start otris-docs                   # Starten
docker inspect --format='{{.State.Health.Status}}' otris-docs   # Health Status
```

### Codex Auth

```bash
docker exec -it otris-docs codex auth login --device-auth   # Einloggen / Token erneuern
docker exec otris-docs codex auth status                    # Auth-Status prüfen
docker exec otris-docs codex mcp list                       # MCP-Server prüfen
```

### Bug-Reports auslesen

```bash
docker exec otris-docs cat /app/reports.json                # Alle Reports anzeigen
docker exec otris-docs tail -5 /app/reports.json            # Letzte 5 Reports
docker exec otris-docs wc -l /app/reports.json              # Anzahl Reports
```

### REST API testen

```bash
curl http://SERVER-IP:3000/api/health                       # Health Check
curl http://SERVER-IP:3000/api/status                       # Vault-Status
curl "http://SERVER-IP:3000/api/search?query=DocFile"       # Suche testen
curl "http://SERVER-IP:3000/api/overview"                   # Sektionsübersicht
```

### Komplett neu bauen

```bash
docker stop otris-docs; docker rm otris-docs
git pull
docker build -t otris-docs .
docker run -d --name otris-docs --restart unless-stopped \
  -p 3000:3000 -e BRIDGE=codex \
  -e ALLOWED_ORIGINS=http://SERVER-IP:3000 \
  -e ALLOW_NO_ORIGIN=true \
  -v otris-docs-codex:/home/node/.codex \
  -v $(pwd)/reports.json:/app/reports.json \
  otris-docs
```

Die Codex-Auth bleibt im Volume `otris-docs-codex` erhalten.

## Vault aktualisieren

Der Crawler braucht Playwright (Mac, nicht Docker):

```bash
npm run crawl:login   # Einmalig: Browser-Login
npm run crawl         # Vault aktualisieren
```

Siehe [UPDATE-VAULT.md](UPDATE-VAULT.md) für Details.

## Tests

```bash
npm test
```

## Architektur

Siehe [ARCHITECTURE.md](ARCHITECTURE.md).
