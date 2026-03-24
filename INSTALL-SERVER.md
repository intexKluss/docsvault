# Server-Einrichtung (Docker)

## Voraussetzungen

- Docker
- Git

## Installation

### 1. Repo klonen

```bash
git clone <repo-url>
cd otris-docs-web
```

### 2. Docker Image bauen

```bash
docker build -t otris-docs .
```

Das Image ist ca. 1 GB gross (Node.js + 995 Markdown-Seiten Dokumentation).
Der Build dauert unter 30 Sekunden (plus Download beim ersten Mal).

### 3. Container starten

```bash
docker run -d \
  --name otris-docs \
  --restart unless-stopped \
  -p 3000:3000 \
  -e BRIDGE=codex \
  -e ALLOWED_ORIGINS=http://SERVER-IP:3000 \
  -e ALLOW_NO_ORIGIN=true \
  otris-docs
```

`SERVER-IP` durch die tatsaechliche IP oder Domain des Servers ersetzen.

### 4. Testen

```bash
# Health Check (sollte {"status":"ok"} zurueckgeben)
curl http://localhost:3000/api/health

# Vault-Status (zeigt Seitenanzahl, Sektionen, Aktualitaet)
curl http://localhost:3000/api/status

# Suche testen
curl "http://localhost:3000/api/search?query=DocFile&max_results=3"

# Web UI im Browser oeffnen
open http://localhost:3000

# MCP SSE Endpoint (Ctrl+C zum Beenden)
curl -N http://localhost:3000/sse

# Docker Health Status
docker inspect --format='{{.State.Health.Status}}' otris-docs
```

### 5. Entwickler verbinden

Entwickler verbinden ihren Coding-Agent (Claude Code, Codex CLI, etc.) per MCP:

```json
{
  "mcpServers": {
    "otris-docs": {
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

Details: [INSTALL-DEVELOPER.md](INSTALL-DEVELOPER.md)

## Umgebungsvariablen

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `BRIDGE` | `codex` | AI-Bridge: `codex` oder `claude` |
| `PORT` | `3000` | Server-Port |
| `VAULT_PATH` | `/app/vault` | Pfad zum Vault im Container |
| `ALLOWED_ORIGINS` | — | Erlaubte Origins fuer WebSocket (kommasepariert) |
| `ALLOW_NO_ORIGIN` | `false` | Verbindungen ohne Origin-Header erlauben (fuer REST API/MCP Clients noetig) |
| `MAX_SESSIONS` | `50` | Max gleichzeitige Chat-Sessions |
| `RATE_LIMIT_PER_MIN` | `10` | WebSocket-Nachrichten pro Minute pro IP |
| `API_RATE_LIMIT_PER_MIN` | `60` | REST API Requests pro Minute pro IP |
| `TRUST_PROXY` | — | Proxy-Konfiguration (`loopback`, IP, etc.) |
| `MAX_MESSAGE_LENGTH` | `2000` | Max Zeichen pro Chat-Nachricht |

## Endpoints

| Pfad | Typ | Beschreibung |
|------|-----|--------------|
| `/` | Web UI | Chat-Oberflaeche |
| `/help/` | Web UI | Installationshilfe fuer Entwickler |
| `/api/health` | REST | Health Check |
| `/api/status` | REST | Vault-Status |
| `/api/search?query=...` | REST | Volltextsuche |
| `/api/read?path=...` | REST | Dokument lesen |
| `/api/list?section=...` | REST | Dateien auflisten |
| `/api/overview` | REST | Uebersicht aller Sektionen |
| `/sse` | MCP | SSE-Transport fuer MCP-Clients |
| `/mcp` | MCP | Streamable HTTP-Transport |

## Sicherheit

- Container laeuft als non-root User (`node`)
- Built-in Health Check (alle 30s)
- Rate Limiting fuer WebSocket und REST API
- Origin-Validierung fuer WebSocket-Verbindungen
- CSP Header auf allen Responses

## Update

### Vault aktualisieren (neue Doku-Version)

Siehe [UPDATE-VAULT.md](UPDATE-VAULT.md). Kurzfassung:
1. Auf dem Mac: `npm run crawl` (Playwright)
2. `git add vault/ && git commit -m "Update vault" && git push`
3. Auf dem Server: Rebuild (siehe unten)

### Code-Update / Rebuild

```bash
cd otris-docs-web
git pull
docker build -t otris-docs .
docker stop otris-docs && docker rm otris-docs
docker run -d \
  --name otris-docs \
  --restart unless-stopped \
  -p 3000:3000 \
  -e BRIDGE=codex \
  -e ALLOWED_ORIGINS=http://SERVER-IP:3000 \
  -e ALLOW_NO_ORIGIN=true \
  otris-docs
```

## Troubleshooting

### Container startet, aber Health Check schlaegt fehl

```bash
docker logs otris-docs
```

Der Server sollte `Server läuft auf http://localhost:3000` loggen. Wenn nicht, pruefen ob Port 3000 frei ist.

### WebSocket verbindet nicht

Pruefen ob `ALLOWED_ORIGINS` korrekt gesetzt ist. Fuer REST API und MCP Clients muss `ALLOW_NO_ORIGIN=true` gesetzt sein.

### MCP Client verbindet nicht

1. Pruefen ob der Server erreichbar ist: `curl http://SERVER-IP:3000/api/health`
2. Pruefen ob SSE funktioniert: `curl -N http://SERVER-IP:3000/sse`
3. Firewall-Regeln pruefen (Port 3000 muss offen sein)
