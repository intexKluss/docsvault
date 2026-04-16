# Multi-Vault Support — Design

**Datum:** 2026-04-16
**Status:** Draft
**Autor:** manu

## Motivation

Der otris-docs-web Container liefert aktuell **einen fest eingebauten Vault** (otris DOCUMENTS Doku). Der Teamleiter will das Tool auch fuer andere Wissensbereiche nutzen (z.B. "Intex Regeln" — interne Richtlinien). Aktuell nicht moeglich: Vault ist hart im Docker-Image (`COPY vault/`), Tools sind hart `otris_*` verdrahtet, System-Prompt beschreibt nur otris.

## Ziele

- **Mehrere Vaults parallel** in einem Container bedienen
- Jeder Vault bekommt **eigene MCP-Tools** mit Vault-spezifischem Prefix (`otris_search`, `intex_regeln_search`, ...)
- **Vaults per Volume-Mount addbar** — kein Image-Rebuild noetig
- LLM weiss ueber Tool-Beschreibung + System-Prompt **welcher Vault was enthaelt**
- **Alle User sehen gleichen State** (Konsistenz wichtiger als Zero-Downtime)

## Non-Ziele

- **Kein Web-UI Update** in diesem Schritt (wird separat geplant)
- **Kein Live-Reload.** Neue Vaults werden per Container-Restart aktiv (bewusste Entscheidung: kein Race-Risiko bei mehreren gleichzeitigen Usern)
- **Kein Admin-Panel/Upload** — Vaults kommen via Filesystem-Mount ins System, nicht ueber UI
- **Kein Auth/Multi-Tenancy** — alle User sehen alle Vaults
- **Keine Backwards-Compat fuer `docker run` ohne Mount** — wer upgraded muss Volume einrichten

## Architektur-Ueberblick

```
Host-Filesystem                     Container
───────────────                     ─────────
/srv/otris/vaults/                  /app/vaults/        (Volume-Mount, read-only)
├── otris/                          ├── otris/
│   ├── _meta.json                  │   └── ...
│   ├── Portalscript API/           ├── intex-regeln/
│   └── HowTos/                     │   └── ...
├── intex-regeln/                   └── ...
│   ├── _meta.json
│   └── Regeln/
```

**Startup-Flow:**

1. Server liest `VAULTS_ROOT` (Default: `/app/vaults`)
2. **Vault-Registry** wird gebaut (neues Modul `src/vault-registry.js`):
   - Jeder Direct-Subdirectory = 1 Vault-Kandidat
   - `_meta.json` lesen (optional, Fallback auf Ordnername)
   - Validierung (Tool-Prefix, Kollisionen, leere Vaults)
   - Ergebnis: `[{ id, name, description, toolPrefix, path }, ...]`
3. MCP-Server registriert **5 Tools pro Vault** mit Prefix
4. Bridges bauen `allowedTools`-Whitelist aus Registry
5. System-Prompt bekommt Vault-Liste injected

**Keine laufenden Aenderungen:** Registry wird einmal beim Boot geladen, lebt im Memory bis Container-Neustart.

## Vault-Format

Pro Vault-Ordner optional eine `_meta.json` im Root:

```json
{
  "name": "Intex Regeln",
  "description": "Interne Regeln und Richtlinien der Intex Informationssysteme GmbH. Enthaelt Entwicklungsrichtlinien, Prozessbeschreibungen und Team-Konventionen.",
  "toolPrefix": "intex_regeln"
}
```

### Felder

| Feld | Pflicht | Default | Bedeutung |
|---|---|---|---|
| `name` | nein | Ordnername | Anzeigename (System-Prompt, Logs) |
| `description` | nein, aber empfohlen | `"Documentation vault '<name>'"` | **Landet in Tool-Description** — entscheidend fuer LLM-Tool-Auswahl |
| `toolPrefix` | nein | `slugify(ordnerName)` | Prefix fuer Tool-Namen (`<prefix>_search` etc.) |

### Slug-Ableitung (`slugify`)

- Lowercase
- Alle Zeichen ausser `[a-z0-9]` zu `_`
- Mehrfache `_` kollabieren zu einem
- Fuehrende/trailing `_` entfernen

**Beispiele:**

| Ordnername | Slug |
|---|---|
| `otris` | `otris` |
| `Intex Regeln` | `intex_regeln` |
| `API v2.0` | `api_v2_0` |
| `Kunden-Projekte` | `kunden_projekte` |
| `---abc---` | `abc` |

### Validierung & Fehler-Handling

Beim Scan werden Vaults unter folgenden Bedingungen **geskipped mit Log-Warning** (Server laeuft weiter):

| Bedingung | Verhalten |
|---|---|
| `_meta.json` existiert aber ungueltiges JSON | Warning, Fallback auf Ordnername-Ableitung |
| `toolPrefix` matcht nicht `/^[a-z][a-z0-9_]*$/` | Vault skipped |
| Zwei Vaults haben gleichen `toolPrefix` | Zweiter (alphabetisch) skipped |
| Vault-Ordner enthaelt keine `.md`-Dateien | Vault skipped |
| `VAULTS_ROOT` existiert nicht oder ist leer | Warning, Server startet trotzdem (aber LLM hat keine Tools) |

## Dynamische Tool-Registration

### `src/mcp-handler.js` — Aenderungen

Heute: 5 Tools hart verdrahtet mit `otris_*` Namen, `vaultPath`-Parameter im Handler-Scope.

Neu: Iteration ueber Registry, 5 Tools pro Vault:

```js
export function createMcpServer(vaultRegistry) {
  const server = new McpServer({ name: 'otris-docs-mcp', version: '0.2.0' });

  for (const vault of vaultRegistry) {
    registerVaultTools(server, vault);
  }
  return server;
}

function registerVaultTools(server, vault) {
  const { toolPrefix, path, description } = vault;

  server.tool(
    `${toolPrefix}_search`,
    `Full-text search across: ${description}. Returns matching files with context lines around each match.`,
    { query: z.string().describe('...'), /* ... */ },
    async (params) => {
      const results = handleSearch(path, params);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }
  );

  // Analog fuer _overview, _read, _list, _status
}
```

**Tool-Handler in `src/tools/*.js`:** unveraendert. Diese nehmen schon `vaultPath` als ersten Parameter.

### Neues Modul `src/vault-registry.js`

```js
export function loadVaultRegistry(vaultsRoot) {
  // 1. Direct-Subdirectories scannen
  // 2. Pro Kandidat: _meta.json lesen, validieren
  // 3. Slug ableiten, Kollisionen pruefen
  // 4. Return: [{ id, name, description, toolPrefix, path }, ...]
}

export function describeVaults(registry) {
  // Fuer System-Prompt + /api/vaults Endpoint
  // Return: human-lesbarer Multi-Line-String
}
```

### REST API `/api/*`

Heute: `/api/search?query=...&vault_path=...` (vault_path war internes Detail).

Neu: Prefix pro Vault, konsistent zum MCP-Tool-Naming:

| Alter Endpoint | Neuer Endpoint |
|---|---|
| `/api/search` | `/api/<toolPrefix>/search` |
| `/api/read` | `/api/<toolPrefix>/read` |
| `/api/list` | `/api/<toolPrefix>/list` |
| `/api/overview` | `/api/<toolPrefix>/overview` |
| `/api/status` | `/api/<toolPrefix>/status` |
| — | `/api/vaults` (neu, listet verfuegbare Vaults) |

`GET /api/vaults` Response:

```json
{
  "vaults": [
    { "toolPrefix": "otris", "name": "otris DOCUMENTS API", "description": "..." },
    { "toolPrefix": "intex_regeln", "name": "Intex Regeln", "description": "..." }
  ]
}
```

### Tool-Count-Warnung

5 Tools × N Vaults. Bei vielen Vaults kann das die Tool-Liste aufblaehen (manche Agents/Modelle haben Context-Limits fuer Tool-Definitionen). Ab **> 20 Vaults** Warning im Log loggen.

## Bridges & System-Prompt

### Bridges (`claude-bridge.js`, `codex-bridge.js`)

Heute: `allowedTools` hart `['mcp__otris-docs__otris_search', ...]`.

Neu: Dynamisch aus Registry:

```js
const allowedTools = vaultRegistry.flatMap(v => [
  `mcp__otris-docs__${v.toolPrefix}_overview`,
  `mcp__otris-docs__${v.toolPrefix}_search`,
  `mcp__otris-docs__${v.toolPrefix}_read`,
  `mcp__otris-docs__${v.toolPrefix}_list`,
  `mcp__otris-docs__${v.toolPrefix}_status`,
]);
```

`disallowedTools` (alle Built-in Tools gesperrt) bleibt unveraendert — Injection-Hardening wichtig.

### System-Prompt (`src/system-prompt.js`)

Heute: Beschreibt fix den otris-Vault.

Neu: Nimmt Registry als Argument und generiert Vault-Liste:

```
Du bist ein Assistent fuer die folgende Dokumentation:

- **otris DOCUMENTS API** — <description aus _meta.json>
  Tools: otris_search, otris_read, otris_list, otris_overview, otris_status

- **Intex Regeln** — <description aus _meta.json>
  Tools: intex_regeln_search, intex_regeln_read, intex_regeln_list, ...

Wenn der User etwas fragt, ueberlege zuerst welcher Wissensbereich passt,
und nutze dann die Tools dieses Bereichs. Wenn unklar, darfst du nachfragen.
```

Der Rest vom System-Prompt (Sicherheit, Tonfall, Injection-Defense) bleibt unveraendert.

## Docker-Setup

### Dockerfile — Diff

```diff
  COPY src/ ./src/
  COPY public/ ./public/
- COPY vault/ ./vault/
  COPY docker-entrypoint.sh ./
  ...
- ENV VAULT_PATH=/app/vault
+ ENV VAULTS_ROOT=/app/vaults

+ RUN mkdir -p /app/vaults && chown node:node /app/vaults
+ VOLUME ["/app/vaults"]
```

Image wird deutlich kleiner (995 MD-Files weg).

### `docker-entrypoint.sh` — Diff

```diff
  [mcp_servers.otris-docs.env]
- VAULT_PATH = "/app/vault"
+ VAULTS_ROOT = "/app/vaults"
```

### `src/mcp-stdio.js`

Bridge-File fuer Codex-interne MCP-Verbindung. Nimmt heute `VAULT_PATH`. Wird auf `VAULTS_ROOT` umgestellt + Registry-Loader nutzt.

### Host-Setup (neu in README dokumentieren)

```bash
# Host-Ordner vorbereiten
mkdir -p /srv/otris/vaults/otris
mkdir -p /srv/otris/vaults/intex-regeln

# otris-Vault bauen (auf Host, nicht im Container)
cd /path/to/otris-docs-web
npm run crawl
cp -r vault/* /srv/otris/vaults/otris/
cat > /srv/otris/vaults/otris/_meta.json <<EOF
{
  "name": "otris DOCUMENTS API",
  "description": "Komplette otris DOCUMENTS API-Dokumentation (Portalscript API, Gadget API, HowTos, Properties). Enthaelt Klassen, Methoden und praktische Beispiele.",
  "toolPrefix": "otris"
}
EOF

# Intex-Regeln-Vault manuell
cat > /srv/otris/vaults/intex-regeln/_meta.json <<EOF
{
  "name": "Intex Regeln",
  "description": "Interne Richtlinien und Team-Konventionen der Intex Informationssysteme GmbH.",
  "toolPrefix": "intex_regeln"
}
EOF
# + MD-Dateien reinkopieren

# Container starten
docker run -d \
  -v /srv/otris/vaults:/app/vaults:ro \
  -p 3000:3000 \
  --name otris-docs \
  otris-docs-web
```

### `crawl.mjs`

Bleibt wie es ist (laeuft auf Host, baut einen Vault). Output-Pfad wird konfigurierbar (aktuell hart `./vault`). Default weiterhin `./vault` damit bestehende Nutzung nicht bricht.

### `UPDATE-VAULT.md`

Komplett neu schreiben — Update-Workflow aendert sich fundamental (war: Vault im laufenden Container austauschen; neu: Host-Ordner updaten + Container-Restart).

## Testing

### Bestehende Tests

Die Handler in `src/tools/*.js` (`handleSearch`, `handleRead`, ...) aendern sich **nicht**. Deren Tests (`test/tools-*.js`) laufen unveraendert gruen.

### Neue Tests

**`test/vault-registry.test.js`** (neu):

- Scan eines Verzeichnisses mit 2 Vaults → korrekte Registry
- Vault ohne `_meta.json` → Fallback-Werte (Name = Ordnername, generic Description)
- Vault mit ungueltigem JSON → skipped, Warning
- Zwei Vaults mit gleichem `toolPrefix` → zweiter (alphabetisch) skipped
- Ungueltiger `toolPrefix` (z.B. `"123"`, `""`, `"with space"`) → skipped
- Leeres Vaults-Root → leere Registry (Warning)
- `VAULTS_ROOT` existiert nicht → leere Registry (Warning, kein Crash)
- Slug-Ableitung: 8+ Test-Cases (siehe Beispieltabelle oben)

**`test/mcp-handler.test.js`** (erweitern):

- Registry mit 2 Vaults → 10 Tools registriert mit korrekten Prefixes
- Tool-Description enthaelt die Vault-Description (`description` aus `_meta.json`)
- Leere Registry → 0 Tools

**`test/integration.test.js`** (neu oder erweitern):

- 2 Temp-Vaults aufsetzen (je ein `_meta.json` + ein paar Test-MDs)
- MCP-Server starten
- `otris_search` findet nur otris-Doku
- `intex_regeln_search` findet nur Intex-Regeln
- Cross-Leak-Check: keine Ergebnisse aus anderem Vault

**Nicht getestet:**

- Docker-Volume-Mount-Verhalten (manuell verifizieren)
- Bridges (werden durch Handler-Tests indirekt abgedeckt; echte SDK-Calls sind e2e-Territorium)

## Breaking Changes / Migration

| Was | Vorher | Nachher | Migration |
|---|---|---|---|
| Vault-Storage | Im Image (`COPY vault/`) | Volume-Mount (`/app/vaults`) | User muss Host-Ordner einrichten + `-v` flag |
| Env-Variable | `VAULT_PATH` | `VAULTS_ROOT` | Deployment-Scripts anpassen |
| MCP-Tool-Namen | `otris_search` etc. (5 Tools) | `<prefix>_search` etc. (5 × N Tools) | **Bleibt kompatibel** wenn otris-Vault mit `toolPrefix: "otris"` gemountet ist |
| REST API | `/api/search` | `/api/<prefix>/search` | API-Clients muessen Pfad anpassen |
| Image-Groesse | Vault im Image (995 MD-Files) | Vault extern, Image deutlich kleiner | Kein Handlungsbedarf |

**Migration-Path fuer bestehende Installationen:**

1. **Bevor** der Container auf die neue Version geht: Host-Ordner anlegen (`/srv/otris/vaults/otris/`)
2. Aus dem noch laufenden alten Container den Vault-Inhalt rauskopieren:
   `docker cp <old-container>:/app/vault/. /srv/otris/vaults/otris/`
3. `_meta.json` mit `toolPrefix: "otris"` in `/srv/otris/vaults/otris/` anlegen
4. Alten Container stoppen, neues Image pullen
5. Neuen Container mit `-v /srv/otris/vaults:/app/vaults:ro` starten
6. Tool-Namen bleiben gleich (`otris_search` etc.) → bestehende MCP-Clients funktionieren ohne Aenderung

## Offene Punkte / Spaeter

- **Web-UI:** Vault-Liste im Chat anzeigen, ggf. Filter. Separater Spec wenn gewuenscht.
- **Admin-API/Upload:** Vaults per HTTP-POST ins Volume bekommen (ohne SSH). Separater Spec.
- **Live-Reload:** `fs.watch` + MCP `tools/list_changed`. Nur wenn der Container-Restart-Flow nervt.
- **Auth/Multi-Tenancy:** Unterschiedliche User sehen unterschiedliche Vaults. Derzeit nicht geplant.
- **otris-docs-mcp Client (Option B aus README):** Der lokale Proxy muss auch umgestellt werden oder der Support fuer Option B wird eingestellt. Entscheidung aufschieben bis Server-Umbau laeuft.

## Implementierungs-Reihenfolge (grob)

1. `vault-registry.js` + Tests
2. `mcp-handler.js` auf Registry umstellen + Tests
3. `system-prompt.js` auf Registry umstellen
4. Bridges auf dynamische `allowedTools` umstellen
5. `mcp-stdio.js` + `api-routes.js` auf Registry umstellen
6. Dockerfile + `docker-entrypoint.sh` anpassen
7. `UPDATE-VAULT.md` + README updaten
8. Integration-Test mit 2 Vaults
9. Manuelles Verify im Docker-Setup

Details kommen in den separaten Implementation-Plan.
