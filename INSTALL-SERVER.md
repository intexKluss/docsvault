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
# Web UI
curl http://localhost:3000/

# REST API
curl http://localhost:3000/api/status

# MCP Endpoint
curl -N http://localhost:3000/sse
```

## Umgebungsvariablen

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `BRIDGE` | `codex` | AI-Bridge: `codex` oder `claude` |
| `PORT` | `3000` | Server-Port |
| `VAULT_PATH` | `/app/vault` | Pfad zum Vault im Container |
| `ALLOWED_ORIGINS` | — | Erlaubte Origins fuer WebSocket (kommasepariert) |
| `ALLOW_NO_ORIGIN` | `false` | Verbindungen ohne Origin-Header erlauben |
| `MAX_SESSIONS` | `50` | Max gleichzeitige Chat-Sessions |
| `RATE_LIMIT_PER_MIN` | `10` | Nachrichten pro Minute pro IP |
| `TRUST_PROXY` | — | Proxy-Konfiguration (`loopback`, IP, etc.) |

## Update

Siehe [UPDATE-VAULT.md](UPDATE-VAULT.md) fuer Vault-Aktualisierungen.

Fuer Code-Updates:

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
