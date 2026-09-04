# docsvault

Web Chat UI und MCP Server für deine Markdown-Dokumentation. Als AI Backend läuft entweder das Claude Agent SDK oder das OpenAI Codex SDK. Die Dokumentation selbst liegt in einem separaten Vault Repo (oder einfach einem Ordner mit `.md`-Dateien) und wird zur Laufzeit als Volume gemountet, also nicht ins Docker Image gebacken. Die aktuelle Seitenanzahl liefert dir das `<prefix>_status` Tool bzw. `GET /api/<prefix>/status`.

## Features

- **Web Chat**: Landing Page + Chat UI mit Typewriter Effekt, Tool Fortschrittsanzeige, Speed Toggle
- **MCP Endpoints**: SSE (`/sse`) und Streamable HTTP (`/mcp`) für externe MCP Clients
- **REST API**: `/api/vaults` (Liste), `/api/<prefix>/{search,read,list,overview,status}` pro Vault
- **Bridge Switching**: Claude oder Codex per `BRIDGE` ENV Variable (Code Default `claude`, das mitgelieferte Docker Image setzt `BRIDGE=codex`)
- **Volltextsuche**: BM25 Index auf Abschnittsebene, beim Start im Speicher aufgebaut
- **Sicherheit**: Rate Limiting, DOMPurify, Tool Whitelisting, Prompt Injection Schutz. Die Origin Validierung schützt allerdings nur den WebSocket. Optionale Bearer Token Auth für REST/MCP per `API_TOKEN` (siehe unten)

## Volltextsuche

`<prefix>_search` läuft gegen einen **BM25 Index** ([MiniSearch](https://github.com/lucaong/minisearch)), der pro Vault beim Start im Speicher gebaut wird. Indexiert wird auf **Abschnittsebene**: ein Eintrag für den Introbereich und je Überschrift von `##` bis `######`, nicht pro Datei. Jeder Treffer liefert seine kompatiblen `headings` und einen eindeutigen `locator`. Ein Folge-`read` mit `file` als `path` und diesem `locator` holt auch bei doppelten Überschriften exakt den gefundenen Abschnitt. `heading` bleibt als Fallback unterstützt.

Gerankt wird primär nach der abgedeckten **IDF Masse** der Query, nicht nach der rohen BM25 Summe. Eine Seite die den seltenen Begriff trifft schlägt damit eine Seite die nur die häufigen Wörter der Query oft enthält. Umlaute werden symmetrisch gefaltet (`ue`/`ü`, `ae`/`ä`, `ss`/`ß`).

Der Startup ist deterministisch: Die Vault Registry ist nach `toolPrefix` sortiert, danach werden die Indizes nacheinander und vollständig aufgebaut, bevor HTTP-Server beziehungsweise stdio-Transport bereit sind. Ein gemessener Vault mit etwa 1800 Seiten braucht dafür ungefähr 2 bis 8 Sekunden und 100 MB Heap. Externe Suchbinaries braucht der Server nicht mehr.

### Antwortgröße im Griff behalten

- MCP `search` liefert standardmäßig 5 Treffer im kompakten Format. `response_format: "detailed"` liefert zusätzlich die bisherigen Trefferzeilen. `max_results` liegt zwischen 1 und 100.
- MCP `read` liefert standardmäßig 8000 Zeichen. `max_length` ist bei MCP auf 25000 begrenzt. Werte unter 200 werden intern auf 200 angehoben.
- MCP `list` liefert standardmäßig 50 und höchstens 500 Seiten.
- `search` und `read` akzeptieren `max_tokens` von 50 bis 50000. Das wird als hartes Zeichenbudget von `max_tokens * 4` umgesetzt, nicht mit einem Modell-Tokenizer.

Bei der REST API bleiben die bisherigen Verträge für `search` und `list` erhalten: `search` liefert standardmäßig 10 Treffer im `detailed`-Format und `list` bleibt ungekürzt. Der REST-`read`-Default sinkt von effektiv 25000 auf 8000 Zeichen. Dafür wird die Unterstützung für ein explizites `read.max_length` von bisher effektiv 25000 auf 200000 Zeichen erweitert. `response_format`, `max_tokens`, `heading` und `locator` funktionieren als Query-Parameter. Bei REST begrenzt `read.max_tokens` den Dokumentinhalt; das JSON mit Titel, Quelle und Metadaten kann entsprechend etwas größer sein.

```bash
curl "http://localhost:3000/api/docs/search?query=Installation&max_tokens=300"
curl "http://localhost:3000/api/docs/read?path=api/DocFile&locator=L12"
```

Beim Update sinkt der MCP-Default von `search` von 10 auf 5 Treffer. Der `read`-Default sinkt bei MCP von 20000 und bei REST von effektiv 25000 auf 8000 Zeichen. Die maximale REST-Leselänge steigt gleichzeitig von effektiv 25000 auf 200000 Zeichen. Wer mehr braucht, setzt `max_results` beziehungsweise `max_length` explizit.

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
  "toolPrefix": "mein_vault",
  "technicalSection": "Reference/API"
}
```

| Feld | Pflicht | Default | Effekt |
|---|---|---|---|
| `name` | nein | Ordnername | Anzeigename im System Prompt und `/api/vaults` |
| `description` | nein, aber empfohlen | `"Documentation vault '<name>'"` | **Geht in die Tool Description.** Davon hängt ab ob der LLM den Vault richtig auswählt |
| `toolPrefix` | nein | `slugify(Ordnername)` | Prefix für Tool Namen (`<prefix>_search` etc.), muss `/^[a-z][a-z0-9_]*$/` matchen |
| `technicalSection` | nein | vorhandenes `Scripting/TERAS API`, sonst keine | Registriert `<prefix>_technical_search` für genau diesen Unterordner. Der Pfad muss kanonisch sein, im Vault liegen und existieren |

Ohne `_meta.json` läuft der Vault trotzdem, kriegt aber nur generische Defaults. Der LLM weiß dann nicht worum's im Vault geht. Also immer dranbauen.

Bringt dein Vault Repo schon eine `_meta.json` mit, musst du selbst nichts anlegen.

## Weitere Vaults hinzufügen

Jeder Unterordner unter dem gemounteten Vaults Verzeichnis wird zu einem eigenen Vault mit eigenen MCP Tools (`<prefix>_search`, `<prefix>_read`, `<prefix>_list`, `<prefix>_overview`, `<prefix>_status`). Vaults mit gültiger `technicalSection` bekommen zusätzlich `<prefix>_technical_search`.

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
