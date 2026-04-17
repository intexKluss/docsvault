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

Das Image ist schlank — der Vault wird nicht mehr mitgebaut, sondern per Volume gemountet.
Der Build dauert unter 30 Sekunden (plus Download beim ersten Mal).

### 3. Vaults vorbereiten

**Das Konzept:** Der Container selbst enthaelt keinen Vault. Er liest sie zur Laufzeit aus einem Verzeichnis auf dem **Host**, das per `-v` in den Container-Pfad `/app/vaults` gemountet wird.

- **Der Host-Pfad ist frei waehlbar.** Auf Linux-Servern ist `/srv/otris/vaults` Konvention. Auf einem Windows-Dev-Rechner kann es z.B. `C:\otris-test\vaults` sein. Wichtig ist nur: derselbe Pfad muss in Schritt 4 beim `docker run -v <HOSTPFAD>:/app/vaults` auftauchen.
- **Kein `mkdir`, kein `cd` noetig.** `git clone URL TARGET-PFAD` legt alle Parent-Ordner automatisch an.
- **`/app/vaults` existiert nur im Container** — vom Dockerfile angelegt, nicht auf deinem Host.

**Empfehlung** — einen Ordner nach oben gehen (raus aus `otris-docs-web/`) und die Vaults als Sibling anlegen. Dann sind Server-Code und Vaults sauber nebeneinander:

```bash
cd ..
```

```bash
git clone https://github.com/intexKluss/otris-docs-vault.git vaults/otris
```

Ergibt folgende Struktur:

```
<dein-arbeitsordner>/
├── otris-docs-web/      <- der gerade geklonte Server-Code
└── vaults/
    └── otris/           <- der Vault mit _meta.json + 995 MDs
```

> **Server-Setup (Linux-Konvention):** Vaults oft unter `/srv/otris/vaults/` — ausfuehrbar aus beliebigem Arbeitsverzeichnis:
> ```bash
> git clone https://github.com/intexKluss/otris-docs-vault.git /srv/otris/vaults/otris
> ```
> Falls `/srv/` root gehoert: `sudo git clone ...` oder ein anderes Verzeichnis waehlen (z.B. `/home/<user>/otris-vaults/otris`).
>
> **Windows-Variante** (PowerShell):
> ```powershell
> git clone https://github.com/intexKluss/otris-docs-vault.git C:\otris-test\vaults\otris
> ```
> Im `docker run -v` in Schritt 4 dann `C:/otris-test/vaults:/app/vaults` (Forward-Slashes).

**Weitere Vaults hinzufuegen** — manuell, z.B.:

```bash
mkdir -p /srv/otris/vaults/intex-regeln
```

```bash
cat > /srv/otris/vaults/intex-regeln/_meta.json <<'EOF'
{
  "name": "Intex Regeln",
  "description": "Interne Richtlinien und Team-Konventionen.",
  "toolPrefix": "intex_regeln"
}
EOF
```

Markdown-Dateien ins Verzeichnis legen — siehe [README.md](README.md#vault-format-_metajson) fuer Details zum `_meta.json`-Format.

### 4. Container starten

**Linux/Mac** — `$(pwd)` = aktuelles Arbeitsverzeichnis (Bash expandiert das vor dem `docker run`):

```bash
docker run -d \
  --name otris-docs \
  --restart unless-stopped \
  -p 3000:3000 \
  -e BRIDGE=codex \
  -e ALLOWED_ORIGINS=http://SERVER-IP:3000 \
  -e ALLOW_NO_ORIGIN=true \
  -v /srv/otris/vaults:/app/vaults:ro \
  -v otris-docs-codex:/home/node/.codex \
  -v $(pwd)/reports.json:/app/reports.json \
  otris-docs
```

**Windows (PowerShell)** — keine `$(pwd)`-Syntax, hier absolute Pfade und Forward-Slashes fuer Docker:

```powershell
docker run -d --name otris-docs --restart unless-stopped -p 3000:3000 -e BRIDGE=codex -e ALLOWED_ORIGINS=http://SERVER-IP:3000 -e ALLOW_NO_ORIGIN=true -v "C:/dein/pfad/zu/vaults:/app/vaults:ro" -v otris-docs-codex:/home/node/.codex -v "C:/dein/pfad/zu/reports.json:/app/reports.json" otris-docs
```

Vorher `reports.json` als leere Datei anlegen (sonst mountet Docker es als Ordner):

```powershell
New-Item -ItemType File "C:\dein\pfad\zu\reports.json" -Force
```

**Diese Platzhalter musst du im `docker run` ersetzen:**
- `SERVER-IP` — tatsaechliche IP oder Domain des Servers (bei Lokal-Test: `localhost`)
- `/srv/otris/vaults` (Linux) bzw. `C:/dein/pfad/zu/vaults` (Windows) — dein Host-Pfad aus Schritt 3, also wohin du den Vault geklont hast
- `$(pwd)/reports.json` (Linux) bzw. `C:/dein/pfad/zu/reports.json` (Windows) — Pfad zur reports.json-Datei (irgendwo schreibbar)

`/app/vaults` und `/app/reports.json` (der Teil **nach** dem `:`) sind Container-intern und bleiben wie sie sind.

Die Volumes sorgen dafür, dass Vaults, Codex-Auth und Bug-Reports bei Container-Rebuilds erhalten bleiben.

### 5. Codex Login (einmalig)

Der Web-Chat nutzt die Codex CLI mit ChatGPT-Account (kein API Key nötig). Login per Device-Auth:

```bash
docker exec -it otris-docs codex auth login --device-auth
```

So funktioniert es:
1. Es erscheint ein Link: `https://auth.openai.com/codex/device`
2. Diesen Link im Browser öffnen (von jedem Rechner aus, nicht nur vom Server)
3. Den angezeigten Code eingeben (z.B. `G794-T9AN6`, läuft nach 15 Minuten ab)
4. Mit dem OpenAI/ChatGPT-Account einloggen
5. Organisation auswählen falls gefragt
6. In der PowerShell/Terminal erscheint "Login successful"

Der Token wird im Volume `otris-docs-codex` gespeichert und überlebt Container-Restarts und Rebuilds. Ein erneutes Login ist nur nötig wenn der Token abläuft.

**Erneut einloggen** (z.B. nach Token-Ablauf):

```bash
docker exec -it otris-docs codex auth login --device-auth
```

Gleicher Befehl wie beim ersten Mal.

**Hinweis:** Ohne Login startet der Server, MCP-Tools und REST API funktionieren, aber der Web-Chat kann keine Antworten generieren.

### 6. Testen

```bash
# Health Check (zeigt Status + Anzahl Vaults)
curl http://localhost:3000/api/health

# Liste der konfigurierten Vaults
curl http://localhost:3000/api/vaults

# Vault-Status des otris-Vaults (Seitenanzahl, Sektionen, Aktualität)
curl http://localhost:3000/api/otris/status

# Suche testen (Pfad = /api/<toolPrefix>/search)
curl "http://localhost:3000/api/otris/search?query=DocFile&max_results=3"

# Web UI im Browser öffnen
open http://localhost:3000

# MCP SSE Endpoint (Ctrl+C zum Beenden)
curl -N http://localhost:3000/sse

# Docker Health Status
docker inspect --format='{{.State.Health.Status}}' otris-docs
```

### 7. Entwickler verbinden

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
| `VAULTS_ROOT` | `/app/vaults` | Wurzel-Verzeichnis der Vaults im Container (Volume-Mount) |
| `ALLOWED_ORIGINS` | — | Erlaubte Origins für WebSocket (kommasepariert) |
| `CODEX_MODEL` | `gpt-5.4` | Model für Codex Bridge |
| `ALLOW_NO_ORIGIN` | `false` | Verbindungen ohne Origin-Header erlauben (für REST API/MCP Clients nötig) |
| `MAX_SESSIONS` | `50` | Max gleichzeitige Chat-Sessions |
| `RATE_LIMIT_PER_MIN` | `10` | WebSocket-Nachrichten pro Minute pro IP |
| `API_RATE_LIMIT_PER_MIN` | `60` | REST API Requests pro Minute pro IP |
| `TRUST_PROXY` | — | Proxy-Konfiguration (`loopback`, IP, etc.) |
| `MAX_MESSAGE_LENGTH` | `2000` | Max Zeichen pro Chat-Nachricht |

## Endpoints

| Pfad | Typ | Beschreibung |
|------|-----|--------------|
| `/` | Web UI | Chat-Oberfläche |
| `/help/` | Web UI | Installationshilfe für Entwickler |
| `/api/health` | REST | Health Check + Vault-Anzahl |
| `/api/vaults` | REST | Liste aller konfigurierten Vaults |
| `/api/<prefix>/status` | REST | Vault-Status |
| `/api/<prefix>/search?query=...` | REST | Volltextsuche im Vault |
| `/api/<prefix>/read?path=...` | REST | Dokument lesen |
| `/api/<prefix>/list?section=...` | REST | Dateien auflisten |
| `/api/<prefix>/overview` | REST | Übersicht aller Sektionen |
| `/sse` | MCP | SSE-Transport für MCP-Clients |
| `/mcp` | MCP | Streamable HTTP-Transport |

`<prefix>` ist der `toolPrefix` aus der `_meta.json` des jeweiligen Vaults (Default-Setup: `otris`).

## Sicherheit

- Container läuft als non-root User (`node`)
- Built-in Health Check (alle 30s)
- Rate Limiting für WebSocket und REST API
- Origin-Validierung für WebSocket-Verbindungen
- CSP Header auf allen Responses

## Update

### Vault aktualisieren (neue Doku-Version)

Der otris-Vault liegt im [otris-docs-vault](https://github.com/intexKluss/otris-docs-vault) Repo. Update-Workflow auf dem Server:

```bash
cd /srv/otris/vaults/otris
```

```bash
git pull
```

```bash
docker restart otris-docs
```

Details zum Neu-Crawlen und Pushen des Vault-Repos: [UPDATE-VAULT.md](UPDATE-VAULT.md).

Kein Rebuild noetig — die Vaults liegen ausserhalb des Images.

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
  -v /srv/otris/vaults:/app/vaults:ro \
  -v otris-docs-codex:/home/node/.codex \
  -v $(pwd)/reports.json:/app/reports.json \
  otris-docs
```

Die Codex-Auth bleibt im Named Volume `otris-docs-codex` erhalten — kein erneutes Login nötig. Die Vaults bleiben ebenfalls erhalten, sie liegen auf dem Host.

## Troubleshooting

### Container startet, aber Health Check schlägt fehl

```bash
docker logs otris-docs
```

Der Server sollte `Server läuft auf http://localhost:3000` loggen. Wenn nicht, prüfen ob Port 3000 frei ist.

### WebSocket verbindet nicht

Prüfen ob `ALLOWED_ORIGINS` korrekt gesetzt ist. Für REST API und MCP Clients muss `ALLOW_NO_ORIGIN=true` gesetzt sein.

### Chat antwortet nicht / Fehler bei Verarbeitung

Der Server startet, aber Chat-Anfragen schlagen fehl:
- Prüfen ob Codex eingeloggt ist: `docker exec otris-docs codex auth status`
- Neu einloggen: `docker exec -it otris-docs codex auth login --device-auth`
- Container-Logs prüfen: `docker logs otris-docs`
- Die REST API (Suche, Lesen) funktioniert auch ohne Login — nur der Chat braucht ihn.

### MCP Client verbindet nicht

1. Prüfen ob der Server erreichbar ist: `curl http://SERVER-IP:3000/api/health`
2. Prüfen ob SSE funktioniert: `curl -N http://SERVER-IP:3000/sse`
3. Firewall-Regeln prüfen (Port 3000 muss offen sein)
