# docsvault

Web-Chat UI und MCP-Server für die otris DOCUMENTS Dokumentation. Nutzt Claude Agent SDK oder OpenAI Codex SDK als AI-Backend. Die Dokumentation (995 Markdown-Seiten) ist im Vault enthalten und wird im Docker-Image gebacken.

## Features

- **Web-Chat**: Landing Page + Chat-UI mit Typewriter-Effekt, Tool-Fortschrittsanzeige, Speed-Toggle
- **MCP-Endpoints**: SSE (`/sse`) und Streamable HTTP (`/mcp`) für externe MCP-Clients
- **REST API**: `/api/vaults` (Liste), `/api/<prefix>/{search,read,list,overview,status}` pro Vault
- **Bridge-Switching**: Claude oder Codex per `BRIDGE` ENV Variable
- **Sicherheit**: Rate Limiting, Origin-Validation, DOMPurify, Tool-Whitelisting, Prompt-Injection-Schutz

## Quick Start

```bash
npm install
npm run dev           # Claude Bridge (default)
npm run dev:codex     # Codex Bridge
```

## Deployment (Docker)

Image bauen:

```bash
docker build -t docsvault .
```

otris-Vault aufs Host-System klonen (Zugriff aufs [otris-docs-vault](https://github.com/intexKluss/otris-docs-vault) Repo noetig):

```bash
git clone https://github.com/intexKluss/otris-docs-vault.git /srv/otris/vaults/otris
```

Git legt `vaults/` automatisch mit an.

Container starten:

```bash
docker run -d \
  -v /srv/otris/vaults:/app/vaults:ro \
  -p 3000:3000 \
  --name docsvault \
  docsvault
```

Siehe [INSTALL-SERVER.md](INSTALL-SERVER.md) für Details.

## Vault-Format: `_meta.json`

Jeder Vault-Ordner kann (sollte!) eine `_meta.json` im Root haben. Der Server liest sie beim Start und nutzt die Werte fuer Tool-Namen und -Beschreibungen:

```json
{
  "name": "Anzeigename",
  "description": "Worum geht's im Vault? Landet in der Tool-Description die der LLM sieht.",
  "toolPrefix": "mein_vault"
}
```

| Feld | Pflicht | Default | Effekt |
|---|---|---|---|
| `name` | nein | Ordnername | Anzeigename im System-Prompt und `/api/vaults` |
| `description` | nein, aber empfohlen | `"Documentation vault '<name>'"` | **Geht in die Tool-Description** — davon haengt ab ob der LLM den Vault richtig auswaehlt |
| `toolPrefix` | nein | `slugify(Ordnername)` | Prefix fuer Tool-Namen (`<prefix>_search` etc.), muss `/^[a-z][a-z0-9_]*$/` matchen |

Ohne `_meta.json` laeuft der Vault trotzdem, kriegt aber nur generische Defaults — der LLM weiss dann nicht worum's im Vault geht. Deshalb immer dranbauen.

Der otris-Vault hat seine `_meta.json` schon im [otris-docs-vault Repo](https://github.com/intexKluss/otris-docs-vault) drin, da musst du nichts anlegen.

## Weitere Vaults hinzufuegen

Jeder Unterordner unter dem gemounteten Vaults-Verzeichnis wird zu einem eigenen Vault mit eigenen MCP-Tools (`<prefix>_search`, `<prefix>_read`, `<prefix>_list`, `<prefix>_overview`, `<prefix>_status`).

Verzeichnis anlegen:

```bash
mkdir -p /srv/otris/vaults/intex-regeln
```

`_meta.json` anlegen (Linux / bash):

```bash
cat > /srv/otris/vaults/intex-regeln/_meta.json <<'EOF'
{
  "name": "Intex Regeln",
  "description": "Interne Richtlinien und Team-Konventionen.",
  "toolPrefix": "intex_regeln"
}
EOF
```

Markdown-Dateien reinkopieren, dann Container neustarten:

```bash
docker restart docsvault
```

## Für Entwickler (MCP-Client)

Verbinde deinen Coding-Agent per MCP mit dem Server:

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

Siehe [INSTALL-DEVELOPER.md](INSTALL-DEVELOPER.md) für alle Optionen.

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

### Bug-Reports auslesen

```bash
docker exec docsvault cat /app/reports.json                # Alle Reports anzeigen
docker exec docsvault tail -5 /app/reports.json            # Letzte 5 Reports
docker exec docsvault wc -l /app/reports.json              # Anzahl Reports
```

### REST API testen

```bash
curl http://SERVER-IP:3000/api/health                       # Health Check + Vault-Anzahl
curl http://SERVER-IP:3000/api/vaults                       # Konfigurierte Vaults auflisten
curl http://SERVER-IP:3000/api/otris/status                 # Vault-Status (otris)
curl "http://SERVER-IP:3000/api/otris/search?query=DocFile" # Suche im otris-Vault
curl "http://SERVER-IP:3000/api/otris/overview"             # Sektionsuebersicht des otris-Vaults
```

### Komplett neu bauen

```bash
docker stop docsvault; docker rm docsvault
git pull
docker build -t docsvault .
docker run -d --name docsvault --restart unless-stopped \
  -p 3000:3000 -e BRIDGE=codex \
  -e ALLOWED_ORIGINS=http://SERVER-IP:3000 \
  -e ALLOW_NO_ORIGIN=true \
  -v /srv/otris/vaults:/app/vaults:ro \
  -v docsvault-codex:/home/node/.codex \
  docsvault
```

Die Codex-Auth bleibt im Volume `docsvault-codex` erhalten. Die Vaults liegen auf dem Host (siehe `-v /srv/otris/vaults`).

## Vault aktualisieren

docsvault selbst hat keinen Crawler. Content wird in einem separaten Vault-Repo gepflegt (z.B. [otris-docs-vault](https://github.com/intexKluss/otris-docs-vault)). Wie man das updated steht dort in `crawl/README.md`.

Siehe [UPDATE-VAULT.md](UPDATE-VAULT.md) fuer den Deployment-Flow (Pull im Vault-Repo → Container sieht neue Version sofort).

## Tests

```bash
npm test
```

## Architektur

Siehe [ARCHITECTURE.md](ARCHITECTURE.md).
