# docsvault

Web Chat UI und MCP Server für deine Markdown-Dokumentation. Als AI Backend läuft entweder das Claude Agent SDK oder das OpenAI Codex SDK. Die Dokumentation selbst liegt in einem separaten Vault Repo (oder einfach einem Ordner mit `.md`-Dateien) und wird zur Laufzeit als Volume gemountet, also nicht ins Docker Image gebacken. Die aktuelle Seitenanzahl liefert dir das `<prefix>_status` Tool bzw. `GET /api/<prefix>/status`.

## Features

- **Web Chat**: Landing Page + Chat UI mit Typewriter Effekt, Tool Fortschrittsanzeige, Speed Toggle
- **MCP Endpoints**: SSE (`/sse`) und Streamable HTTP (`/mcp`) für externe MCP Clients
- **REST API**: `/api/vaults` (Liste), `/api/<prefix>/{search,read,list,overview,status}` pro Vault
- **Bridge Switching**: Claude oder Codex per `BRIDGE` ENV Variable (Code Default `claude`, das mitgelieferte Docker Image setzt `BRIDGE=codex`)
- **Volltextsuche**: nutzt [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) für schnelle Suche, mit reinem Node Fallback falls `rg` fehlt
- **Sicherheit**: Rate Limiting, DOMPurify, Tool Whitelisting, Prompt Injection Schutz. Die Origin Validierung schützt allerdings nur den WebSocket. Optionale Bearer Token Auth für REST/MCP per `API_TOKEN` (siehe unten)

## Volltextsuche

`<prefix>_search` durchsucht den Vault mit **ripgrep** (`rg`), sofern es im `PATH` liegt. Das ist deutlich schneller als der Node Fallback, der greift nur wenn `rg` fehlt. Deshalb installiert das Docker Image `ripgrep` gleich mit (siehe `Dockerfile`). Lokal (Dev) ohne installiertes `rg` läuft automatisch der Fallback. Das Suchergebnis ist identisch, nur langsamer.

## Quick Start

```bash
npm install
npm run dev           # Claude Bridge (Code-Default)
npm run dev:codex     # Codex Bridge
```

> **Windows Hinweis:** `dev:codex` und `dev:claude` nutzen die bash-typische `BRIDGE=... node ...` Inline Syntax und laufen so nur unter bash/WSL/Git Bash. Auf nativer PowerShell stattdessen:
> ```powershell
> $env:BRIDGE="codex"; node --watch src/server.js
> ```
> (`npm run dev` ohne ENV läuft überall und nutzt den Code Default `claude`.)

## Deployment (Docker)

Image bauen:

```bash
docker build -t docsvault .
```

Vault aufs Host System klonen (dein eigenes Repo mit der Dokumentation):

```bash
git clone https://github.com/<dein-org>/<dein-vault-repo>.git /srv/docsvault/vaults/docs
```

Git legt `vaults/` automatisch mit an.

Container starten:

```bash
docker run -d \
  -v /srv/docsvault/vaults:/app/vaults:ro \
  -p 3000:3000 \
  --name docsvault \
  docsvault
```

Details stehen in [INSTALL-SERVER.md](INSTALL-SERVER.md).

## Vault Format: `_meta.json`

Jeder Vault Ordner kann (und sollte!) eine `_meta.json` im Root haben. Der Server liest sie beim Start und nutzt die Werte für Tool Namen und Beschreibungen:

```json
{
  "name": "Anzeigename",
  "description": "Worum geht's im Vault? Landet in der Tool-Description die der LLM sieht.",
  "toolPrefix": "mein_vault"
}
```

| Feld | Pflicht | Default | Effekt |
|---|---|---|---|
| `name` | nein | Ordnername | Anzeigename im System Prompt und `/api/vaults` |
| `description` | nein, aber empfohlen | `"Documentation vault '<name>'"` | **Geht in die Tool Description.** Davon hängt ab ob der LLM den Vault richtig auswählt |
| `toolPrefix` | nein | `slugify(Ordnername)` | Prefix für Tool Namen (`<prefix>_search` etc.), muss `/^[a-z][a-z0-9_]*$/` matchen |

Ohne `_meta.json` läuft der Vault trotzdem, kriegt aber nur generische Defaults. Der LLM weiß dann nicht worum's im Vault geht. Also immer dranbauen.

Bringt dein Vault Repo schon eine `_meta.json` mit, musst du selbst nichts anlegen.

## Weitere Vaults hinzufügen

Jeder Unterordner unter dem gemounteten Vaults Verzeichnis wird zu einem eigenen Vault mit eigenen MCP Tools (`<prefix>_search`, `<prefix>_read`, `<prefix>_list`, `<prefix>_overview`, `<prefix>_status`).

Verzeichnis anlegen:

```bash
mkdir -p /srv/docsvault/vaults/team-notes
```

`_meta.json` anlegen (Linux / bash):

```bash
cat > /srv/docsvault/vaults/team-notes/_meta.json <<'EOF'
{
  "name": "Team Notes",
  "description": "Interne Richtlinien und Team-Konventionen.",
  "toolPrefix": "team_notes"
}
EOF
```

Markdown Dateien reinkopieren, dann Container neustarten:

```bash
docker restart docsvault
```

## Für Entwickler (MCP Client)

Verbinde deinen Coding Agent per MCP mit dem Server:

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

**Bricht die Verbindung weg?** SSE (`type: sse`) braucht eine dauerhaft offene Verbindung, und die kappt ein Reverse Proxy gern nach kurzer Idle Zeit (typisches Symptom: der Client zeigt kurz die Tools, dann ist der Server weg). Nutze dann den Streamable HTTP Endpunkt `/mcp` (`type: http`), der ist proxy-robust:

```bash
claude mcp add --transport http docsvault http://SERVER-IP:3000/mcp
```

Alle Optionen findest du in [INSTALL-DEVELOPER.md](INSTALL-DEVELOPER.md).

## Sicherheit & Auth

Ehrlich gesagt, damit niemand falsche Annahmen trifft:

- **REST API (`/api`) und MCP (`/sse`, `/messages`, `/mcp`) sind standardmäßig ohne Authentifizierung erreichbar.** Es gibt dort weder Origin Check noch (ohne Token) eine Zugriffskontrolle. Wer den Port erreicht, kann lesen.
- **Origin Validierung greift nur für den WebSocket** (Web Chat), nicht für REST/MCP.
- **Rate Limiting** (`RATE_LIMIT_PER_MIN` für WebSocket, `API_RATE_LIMIT_PER_MIN` für REST) bremst Missbrauch, ist aber keine Auth.

**Opt-in Auth via `API_TOKEN`:** Setzt du die ENV Variable `API_TOKEN`, verlangen `/api`, `/sse`, `/messages`, `/mcp` und der WebSocket einen Bearer Token (`Authorization: Bearer <TOKEN>`). Ist `API_TOKEN` nicht gesetzt, bleiben alle Endpoints offen (aktuelles Default Verhalten). Für öffentlich erreichbare Deployments solltest du das dringend setzen oder den Port hinter einem Reverse Proxy / VPN dichtmachen.

## Nützliche Befehle

### Container

```bash
docker logs docsvault                    # Logs anzeigen
docker logs docsvault --tail 50          # Letzte 50 Zeilen
docker logs docsvault -f                 # Logs live verfolgen
docker restart docsvault                 # Neustart
docker stop docsvault                    # Stoppen
docker start docsvault                   # Starten
docker inspect --format='{{.State.Health.Status}}' docsvault   # Health Status
```

### Codex Auth

```bash
docker exec -it docsvault codex auth login --device-auth   # Einloggen / Token erneuern
docker exec docsvault codex auth status                    # Auth-Status prüfen
docker exec docsvault codex mcp list                       # MCP-Server prüfen
```

### Bug Reports auslesen

```bash
docker exec docsvault cat /app/reports.json                # Alle Reports anzeigen
docker exec docsvault tail -5 /app/reports.json            # Letzte 5 Reports
docker exec docsvault wc -l /app/reports.json              # Anzahl Reports
```

### REST API testen

```bash
curl http://SERVER-IP:3000/api/health                       # Health Check + Vault-Anzahl
curl http://SERVER-IP:3000/api/vaults                       # Konfigurierte Vaults auflisten
curl http://SERVER-IP:3000/api/docs/status                  # Vault-Status (docs)
curl "http://SERVER-IP:3000/api/docs/search?query=Installation" # Suche im docs-Vault
curl "http://SERVER-IP:3000/api/docs/overview"               # Sektionsübersicht des docs-Vaults
```

### Komplett neu bauen

```bash
docker stop docsvault; docker rm docsvault
git pull
docker build -t docsvault .
docker run -d --name docsvault --restart unless-stopped \
  -p 3000:3000 -e BRIDGE=codex \
  -e ALLOW_NO_ORIGIN=true \
  -v /srv/docsvault/vaults:/app/vaults:ro \
  -v docsvault-codex:/home/node/.codex \
  docsvault
```

Die Codex Auth bleibt im Volume `docsvault-codex` erhalten. Die Vaults liegen auf dem Host (siehe `-v /srv/docsvault/vaults`).

## Vault aktualisieren

docsvault selbst hat keinen Crawler. Der Content wird in einem separaten Vault Repo gepflegt. Wie du den aktualisierst, hängt von diesem Repo ab (z.B. eigener Generator, manuelles Editieren, oder ein Crawler falls dein Repo einen mitbringt).

Den kompletten Deployment Flow (Pull im Vault Repo, Container sieht neue Version sofort) findest du in [UPDATE-VAULT.md](UPDATE-VAULT.md).

## Tests

```bash
npm test
```

## Architektur

Siehe [ARCHITECTURE.md](ARCHITECTURE.md).
