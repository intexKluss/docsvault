# Server-Einrichtung (Docker)

## Voraussetzungen

- Docker
- Git

## Installation

### 1. Repo klonen

```bash
git clone https://github.com/intexKluss/docsvault.git
cd docsvault
```

### 2. Docker Image bauen

```bash
docker build -t docsvault .
```

Das Image ist schlank — der Vault wird nicht mehr mitgebaut, sondern per Volume gemountet.
Der Build dauert unter 30 Sekunden (plus Download beim ersten Mal).

### 3. Vaults vorbereiten

**Das Konzept:** Der Container selbst enthaelt keinen Vault. Er liest sie zur Laufzeit aus einem Verzeichnis auf dem **Host**, das per `-v` in den Container-Pfad `/app/vaults` gemountet wird.

- **Der Host-Pfad ist frei waehlbar.** Auf Linux-Servern ist `/srv/otris/vaults` Konvention. Auf einem Windows-Dev-Rechner kann es z.B. `C:\otris-test\vaults` sein. Wichtig ist nur: derselbe Pfad muss in Schritt 4 beim `docker run -v <HOSTPFAD>:/app/vaults` auftauchen.
- **Kein `mkdir`, kein `cd` noetig.** `git clone URL TARGET-PFAD` legt alle Parent-Ordner automatisch an.
- **`/app/vaults` existiert nur im Container** — vom Dockerfile angelegt, nicht auf deinem Host.

**Empfehlung** — einen Ordner nach oben gehen (raus aus `docsvault/`) und die Vaults als Sibling anlegen. Dann sind Server-Code und Vaults sauber nebeneinander:

```bash
cd ..
```

```bash
git clone https://github.com/intexKluss/otris-docs-vault.git vaults/otris
```

Ergibt folgende Struktur:

```
<dein-arbeitsordner>/
├── docsvault/      <- der gerade geklonte Server-Code
└── vaults/
    └── otris/           <- der Vault mit _meta.json + den Markdown-Seiten
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

**Linux/Mac:**

```bash
docker run -d \
  --name docsvault \
  --restart unless-stopped \
  -p 3000:3000 \
  -e BRIDGE=codex \
  -e ALLOW_NO_ORIGIN=true \
  -v /srv/otris/vaults:/app/vaults:ro \
  -v docsvault-codex:/home/node/.codex \
  docsvault
```

**Windows (PowerShell)** — absolute Pfade, Forward-Slashes fuer Docker:

```powershell
docker run -d --name docsvault --restart unless-stopped -p 3000:3000 -e BRIDGE=codex -e ALLOW_NO_ORIGIN=true -v "C:/dein/pfad/zu/vaults:/app/vaults:ro" -v docsvault-codex:/home/node/.codex docsvault
```

**Dieser Platzhalter muss im `docker run` ersetzt werden:**
- `/srv/otris/vaults` (Linux) bzw. `C:/dein/pfad/zu/vaults` (Windows) — dein Host-Pfad aus Schritt 3, also wohin du den Vault geklont hast

Ein `ALLOWED_ORIGINS` ist **nicht noetig**: der Web-Chat verbindet immer same-origin, und same-origin laesst der Server automatisch durch — egal ueber welche IP, Domain oder welchen Port die Seite aufgerufen wird. `ALLOWED_ORIGINS` braucht man nur, wenn das Frontend von einer **anderen** Origin aus zugreift (z.B. Reverse Proxy, der den `Host`-Header umschreibt).

**Zum Volume-Format `-v ...`:** Docker erwartet drei Teile getrennt mit `:` — `HOSTPFAD:CONTAINERPFAD:OPTIONEN`.

```
-v "C:/otris web test/vaults : /app/vaults : ro"
      └─────────┬──────────┘   └────┬────┘  └┬┘
            Host-Pfad        Container-Pfad  read-only
      (dein Windows-Ordner)  (server liest   (optional)
                              hier die Vaults)
```

Der **Container-Pfad `/app/vaults`** ist fix — der Server sucht dort die Vaults, darf also nicht geaendert werden. Der **Host-Pfad** ist dein frei waehlbarer Ordner aus Schritt 3. Das `:ro` am Ende ist optional (read-only, verhindert dass der Container in deinen Ordner schreibt).

Analog fuer das zweite Volume `-v docsvault-codex:/home/node/.codex`:
- `docsvault-codex` — named volume (Docker verwaltet das automatisch, keine Host-Datei noetig)
- `/home/node/.codex` — Container-Pfad wo Codex seine Auth speichert
- Keine Optionen (read-write)

> **Bug-Reports persistent machen** (optional): Standardmaessig landen Bug-Reports in `/app/reports.json` **im Container** — verschwinden also beim `docker rm`. Wenn du sie ueber Container-Rebuilds erhalten willst, mounte eine Host-Datei drauf:
> - Host-Datei vorher anlegen: Linux `touch /srv/otris/reports.json` bzw. Windows `New-Item -ItemType File "C:\pfad\reports.json" -Force`
> - Beim `docker run` ergaenzen: `-v /srv/otris/reports.json:/app/reports.json` (Linux) bzw. `-v "C:/pfad/reports.json:/app/reports.json"` (Windows)
> - **Wichtig (Linux):** Der Container laeuft als User `node` (uid 1000). Die gemountete Host-Datei muss diesem User gehoeren, sonst kann der Server nicht reinschreiben: `chown 1000:1000 /srv/otris/reports.json`. Sonst landen Reports nur im Container-Log als Fehler.

Die Volumes sorgen dafür, dass Vaults, Codex-Auth und Bug-Reports bei Container-Rebuilds erhalten bleiben.

### 5. Codex Login (einmalig)

Der Web-Chat nutzt die Codex CLI mit ChatGPT-Account (kein API Key nötig). Login per Device-Auth:

```bash
docker exec -it docsvault codex auth login --device-auth
```

So funktioniert es:
1. Es erscheint ein Link: `https://auth.openai.com/codex/device`
2. Diesen Link im Browser öffnen (von jedem Rechner aus, nicht nur vom Server)
3. Den angezeigten Code eingeben (z.B. `G794-T9AN6`, läuft nach 15 Minuten ab)
4. Mit dem OpenAI/ChatGPT-Account einloggen
5. Organisation auswählen falls gefragt
6. In der PowerShell/Terminal erscheint "Login successful"

Der Token wird im Volume `docsvault-codex` gespeichert und überlebt Container-Restarts und Rebuilds. Ein erneutes Login ist nur nötig wenn der Token abläuft.

**Erneut einloggen** (z.B. nach Token-Ablauf):

```bash
docker exec -it docsvault codex auth login --device-auth
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
docker inspect --format='{{.State.Health.Status}}' docsvault
```

### 7. Entwickler verbinden

Entwickler verbinden ihren Coding-Agent per MCP. Claude Code (empfohlen):

```bash
claude mcp add --transport sse docsvault http://SERVER-IP:3000/sse
```

Oder manuell in `.mcp.json`:

```json
{
  "mcpServers": {
    "docsvault": {
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
| `BRIDGE` | `claude` (Code) / `codex` (Image) | AI-Bridge: `codex` oder `claude`. Der Code-Default ist `claude`, das mitgelieferte Docker-Image setzt aber `BRIDGE=codex` (siehe Dockerfile) |
| `PORT` | `3000` | Server-Port |
| `VAULTS_ROOT` | `/app/vaults` (Image) | Wurzel-Verzeichnis der Vaults im Container (Volume-Mount). Ausserhalb von Docker: `./vaults` |
| `ALLOWED_ORIGINS` | — | Zusaetzlich erlaubte Origins für den WebSocket (kommasepariert). Same-origin ist immer erlaubt — nur noetig wenn das Frontend von einer anderen Origin zugreift (z.B. Reverse Proxy mit Host-Rewrite) |
| `CODEX_MODEL` | `gpt-5.4` | Model für Codex Bridge |
| `ALLOW_NO_ORIGIN` | `false` | Verbindungen ohne Origin-Header erlauben (für REST API/MCP Clients nötig) |
| `MAX_SESSIONS` | `50` | Max gleichzeitige Chat-Sessions |
| `RATE_LIMIT_PER_MIN` | `10` | WebSocket-Nachrichten pro Minute pro IP |
| `API_RATE_LIMIT_PER_MIN` | `60` | REST API Requests pro Minute pro IP |
| `TRUST_PROXY` | — | Proxy-Konfiguration (`loopback`, IP, etc.) |
| `MAX_MESSAGE_LENGTH` | `2000` | Max Zeichen pro Chat-Nachricht |
| `API_TOKEN` | — | Wenn gesetzt: erzwingt Bearer-Token-Auth auf `/api`, `/sse`, `/messages`, `/mcp` und dem WebSocket. Unset = offen (Default-Verhalten) |

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

- Container läuft als non-root User (`node`, uid 1000)
- Built-in Health Check (alle 30s)
- Rate Limiting für WebSocket und REST API
- Origin-Validierung **nur** für WebSocket-Verbindungen
- CSP Header auf allen Responses

**Ehrlich, damit keine falschen Annahmen entstehen:** REST API (`/api`) und MCP (`/sse`, `/messages`, `/mcp`) haben **keinen Origin-Check** und sind **standardmaessig ohne Authentifizierung** erreichbar. Origin-Validierung schuetzt nur den WebSocket (Web-Chat). Rate Limiting bremst Missbrauch, ist aber keine Zugriffskontrolle.

**Auth aktivieren (`API_TOKEN`):** Setzt du die ENV-Variable `API_TOKEN` (z.B. `-e API_TOKEN=<geheim>` im `docker run`), verlangen `/api`, `/sse`, `/messages`, `/mcp` und der WebSocket einen Bearer-Token (`Authorization: Bearer <TOKEN>`). Ohne gesetztes `API_TOKEN` bleiben alle Endpoints offen. Fuer oeffentlich erreichbare Deployments unbedingt `API_TOKEN` setzen oder den Port hinter Reverse Proxy / VPN dichtmachen.

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
docker restart docsvault
```

Details zum Neu-Crawlen und Pushen des Vault-Repos: [UPDATE-VAULT.md](UPDATE-VAULT.md).

Kein Rebuild noetig — die Vaults liegen ausserhalb des Images.

### Code-Update / Rebuild

```bash
cd docsvault
git pull
docker build -t docsvault .
docker stop docsvault && docker rm docsvault
docker run -d \
  --name docsvault \
  --restart unless-stopped \
  -p 3000:3000 \
  -e BRIDGE=codex \
  -e ALLOW_NO_ORIGIN=true \
  -v /srv/otris/vaults:/app/vaults:ro \
  -v docsvault-codex:/home/node/.codex \
  docsvault
```

Die Codex-Auth bleibt im Named Volume `docsvault-codex` erhalten — kein erneutes Login nötig. Die Vaults bleiben ebenfalls erhalten, sie liegen auf dem Host.

## Troubleshooting

### Container startet, aber Health Check schlägt fehl

```bash
docker logs docsvault
```

Der Server sollte `Server läuft auf http://localhost:3000` loggen. Wenn nicht, prüfen ob Port 3000 frei ist.

### WebSocket verbindet nicht (Web-Chat tot, Browser-Konsole zeigt "WebSocket connection failed")

Zuerst in die Container-Logs schauen — der Server loggt jede abgelehnte Verbindung mit Grund:

```bash
docker logs docsvault 2>&1 | grep "ws rejected"
```

- `Origin "..." passt nicht zu Host "..."` — die Seite laeuft hinter einem Proxy, der den `Host`-Header umschreibt. Die im Log gezeigte Origin in `ALLOWED_ORIGINS` eintragen (exakter String inkl. Protokoll und Port), oder den Proxy den originalen `Host`-Header durchreichen lassen (nginx: `proxy_set_header Host $host;`).
- `kein Origin-Header` — REST API / MCP Clients brauchen `ALLOW_NO_ORIGIN=true`.

Same-origin-Zugriffe (Seite direkt ueber `http://SERVER:3000` aufgerufen) laufen ohne Konfiguration — wenn es da haengt, liegt es nicht an Origins, sondern an Firewall/Port-Mapping.

### Chat antwortet nicht / Fehler bei Verarbeitung

Der Server startet, aber Chat-Anfragen schlagen fehl:
- Prüfen ob Codex eingeloggt ist: `docker exec docsvault codex auth status`
- Neu einloggen: `docker exec -it docsvault codex auth login --device-auth`
- Container-Logs prüfen: `docker logs docsvault`
- Die REST API (Suche, Lesen) funktioniert auch ohne Login — nur der Chat braucht ihn.

### MCP Client verbindet nicht

1. Prüfen ob der Server erreichbar ist: `curl http://SERVER-IP:3000/api/health`
2. Prüfen ob SSE funktioniert: `curl -N http://SERVER-IP:3000/sse`
3. Firewall-Regeln prüfen (Port 3000 muss offen sein)
