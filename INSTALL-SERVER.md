# Server-Einrichtung (Docker)

## Voraussetzungen

- Docker
- Git

## Installation

### 1. Repo klonen

```bash
git clone https://github.com/intexKluss/otris-docs-web.git
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
  -v otris-docs-codex:/home/node/.codex \
  -v $(pwd)/reports.json:/app/reports.json \
  otris-docs
```

Ersetzen:
- `SERVER-IP` → tatsaechliche IP oder Domain des Servers

Die Volumes sorgen dafuer, dass Codex-Auth und Bug-Reports bei Container-Rebuilds erhalten bleiben.

### 4. Codex Login (einmalig)

Der Web-Chat nutzt die Codex CLI mit ChatGPT-Account (kein API Key noetig). Login per Device-Auth:

```bash
docker exec -it otris-docs codex auth login --device-auth
```

Es erscheint ein Link und ein Code. Den Link im Browser oeffnen, Code eingeben, mit dem OpenAI/ChatGPT-Account einloggen. Fertig.

**Hinweis:** Ohne Login startet der Server, MCP-Tools und REST API funktionieren, aber der Web-Chat kann keine Antworten generieren.

### 5. Testen

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

### 6. Entwickler verbinden

Entwickler verbinden ihren Coding-Agent per MCP. Claude Code (empfohlen):

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

Details: [INSTALL-DEVELOPER.md](INSTALL-DEVELOPER.md)

## Umgebungsvariablen

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `BRIDGE` | `codex` | AI-Bridge: `codex` oder `claude` |
| `PORT` | `3000` | Server-Port |
| `VAULT_PATH` | `/app/vault` | Pfad zum Vault im Container |
| `ALLOWED_ORIGINS` | — | Erlaubte Origins fuer WebSocket (kommasepariert) |
| `CODEX_MODEL` | `gpt-5.4` | Model fuer Codex Bridge |
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
  -v otris-docs-codex:/home/node/.codex \
  -v $(pwd)/reports.json:/app/reports.json \
  otris-docs
```

Die Codex-Auth bleibt im Named Volume `otris-docs-codex` erhalten — kein erneutes Login noetig.

## Troubleshooting

### Container startet, aber Health Check schlaegt fehl

```bash
docker logs otris-docs
```

Der Server sollte `Server läuft auf http://localhost:3000` loggen. Wenn nicht, pruefen ob Port 3000 frei ist.

### WebSocket verbindet nicht

Pruefen ob `ALLOWED_ORIGINS` korrekt gesetzt ist. Fuer REST API und MCP Clients muss `ALLOW_NO_ORIGIN=true` gesetzt sein.

### Chat antwortet nicht / Fehler bei Verarbeitung

Der Server startet, aber Chat-Anfragen schlagen fehl:
- Pruefen ob Codex eingeloggt ist: `docker exec otris-docs codex auth status`
- Neu einloggen: `docker exec -it otris-docs codex auth login --device-auth`
- Container-Logs pruefen: `docker logs otris-docs`
- Die REST API (Suche, Lesen) funktioniert auch ohne Login — nur der Chat braucht ihn.

### MCP Client verbindet nicht

1. Pruefen ob der Server erreichbar ist: `curl http://SERVER-IP:3000/api/health`
2. Pruefen ob SSE funktioniert: `curl -N http://SERVER-IP:3000/sse`
3. Firewall-Regeln pruefen (Port 3000 muss offen sein)
