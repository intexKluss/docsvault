# MCP Server Deployment Design

Server-Deployment fuer otris-docs-web: Web-UI + Remote-MCP-Endpunkt in einem Docker-Container.

## Ziel

Ein einzelnes Docker Image das auf dem Pi laeuft und zwei Dinge bietet:
1. **Web-UI** (Chat) — wie bisher, Browser-basiert
2. **MCP-Netzwerk-Endpunkt** — Entwickler verbinden ihren Coding-Agent (Claude Code, Codex CLI, etc.) per MCP-Protokoll mit dem Server und koennen die Doku durchsuchen, lesen, listen — ohne lokal irgendwas zu installieren

## Architektur

```
=== Pi (Docker Container, Port 3000) ===

Express Server
    |
    |-- GET /              Web-UI (Static Files)
    |-- WebSocket /        Chat (Claude/Codex Bridge)
    |-- GET /sse           MCP SSE Endpunkt (Remote-Clients)
    |-- POST /message      MCP Streamable HTTP (Remote-Clients)
    |
    |-- SessionManager     Chat-Session-Lifecycle
    |-- Bridges            Claude/Codex SDK → otris-docs-mcp (Stdio Child-Process)
    |
    +-- Vault              Markdown-Dateien (im Image gebaked)


=== Entwickler (lokal) ===

Claude Code / Codex CLI / beliebiger MCP-Client
    |
    +-- MCP Config: { url: "http://<server-ip>:3000/sse" }
        (keine lokale Installation, nur URL eintragen)
```

## Entscheidungen

| Thema | Entscheidung | Begruendung |
|-------|-------------|-------------|
| Transport | SSE + Streamable HTTP | Maximale Client-Kompatibilitaet |
| Zugang | Nur LAN | Interne Entwickler, kein Auth noetig |
| Deployment | Einzelnes Docker Image | Pi ist reiner Docker-Server, kein Node/npm |
| Architektur | Ein Prozess | Ein Port, ein Container, einfachstes Setup |
| Vault | Im Image gebaked | Reproduzierbar, keine externen Abhaengigkeiten |
| Vault-Update | Crawl lokal (Mac) → commit → push → pull + rebuild auf Pi | Crawler braucht Playwright, Pi hat keinen Browser |

## Komponenten

### 1. MCP-Netzwerk-Endpunkt (neu)

Neue Datei `src/mcp-handler.js`: Erstellt einen `McpServer` (aus `@modelcontextprotocol/sdk/server`) und registriert die 5 Tools. Die Tool-Funktionen (search, read, list, overview, status) werden direkt aus dem `otris-docs-mcp` Package importiert — kein Child-Process fuer den Netzwerk-Endpunkt.

Neue Routen in `server.js`:

- **`GET /sse`** — SSE-Transport via `SSEServerTransport` (aus `@modelcontextprotocol/sdk/server/sse.js`). Deprecated aber breit unterstuetzt.
- **`POST /message`** — Streamable HTTP via `StreamableHTTPServerTransport` (aus `@modelcontextprotocol/sdk/server/streamableHttp.js`, falls verfuegbar).

Beide Endpunkte stellen dieselben 5 Tools bereit:
- `otris_search` — Volltext-Suche im Vault
- `otris_read` — Dokument lesen (Markdown + Metadaten)
- `otris_list` — Verzeichnis/Section auflisten
- `otris_overview` — Vault-Uebersicht
- `otris_status` — Vault-Freshness (letzter Crawl-Zeitpunkt)

**Multi-Session:** Jeder MCP-Client bekommt eine eigene Transport-Instanz. Der `mcp-handler.js` verwaltet eine Session-Map fuer parallele Verbindungen.

**Kein Auth, kein Rate-Limiting** auf dem MCP-Endpunkt (LAN-only, nur interne Entwickler).

### 2. Vault im Repo (neu)

Der Vault (995 Markdown-Seiten) wird ins `otris-docs-web` Repo kopiert.

**Update-Workflow:**
1. Auf dem Mac: `otris-docs-mcp crawl` (Playwright crawlt die otris-Doku)
2. Vault-Dateien ins Repo kopieren
3. `git add vault/ && git commit && git push`
4. Auf dem Pi: `git pull && docker build -t otris-docs . && docker stop otris-docs && docker rm otris-docs && docker run -d --name otris-docs -p 3000:3000 otris-docs`

### 3. Dockerfile (neu)

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

- Base: `node:20-slim` (minimal, ~50MB)
- Vault wird ueber `COPY . .` mit reinkopiert
- `otris-docs-mcp` ist npm-Dependency → CLI verfuegbar unter `node_modules/.bin/otris-docs-mcp`
- Bridges nutzen den vollen Pfad zum Binary statt globales `otris-docs-mcp`

### 4. .dockerignore (neu)

```
.git
node_modules
docs
test
*.md
!vault/**/*.md
!vault/**/*.json
```

### 5. Bridge-Anpassung (minimal)

Die Bridges (`claude-bridge.js`, `codex-bridge.js`) aendern den MCP-Server-Pfad:

Vorher:
```javascript
const MCP_SERVERS = {
  'otris-docs': { command: 'otris-docs-mcp' }
};
```

Nachher:
```javascript
const MCP_SERVERS = {
  'otris-docs': {
    command: path.join(__dirname, '..', 'node_modules', '.bin', 'otris-docs-mcp')
  }
};
```

Die Bridges nutzen weiterhin Stdio (Child-Process) fuer die Chat-Sessions. Das ist unabhaengig vom MCP-Netzwerk-Endpunkt.

### 6. Help-Page Anpassung (minimal)

Die bestehende Install-Doku unter `/help/` bekommt einen neuen Abschnitt:

**"MCP mit deinem Coding-Agent nutzen"**

Erklaert wie man die Server-URL in die MCP-Config seines Agents eintraegt. Beispiel-Configs fuer Claude Code und Codex CLI als Copy-Paste Snippets. Keine IDE-Integration, nur Agent-Config.

### 7. Dependencies (neu)

In `package.json` hinzufuegen:
- `otris-docs-mcp` — als Git-Dependency (`"otris-docs-mcp": "github:user/otris-docs-mcp"`) oder lokaler Pfad fuer Dev. Stellt CLI + Tool-Logik + Vault-Reader bereit.
- `@modelcontextprotocol/sdk` — MCP Server + Transports

### 8. Environment-Variablen (Ergaenzung)

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `VAULT_PATH` | `./vault` | Pfad zum Vault-Verzeichnis. Wird an die Tool-Funktionen aus otris-docs-mcp uebergeben und von mcp-handler.js beim Setup gelesen. |

Alle bestehenden Env-Variablen bleiben unveraendert.

## Was sich NICHT aendert

- **Web-UI Frontend** (`app.js`, `index.html`, `style.css`) — unveraendert
- **Chat-Funktionalitaet** — unveraendert
- **Session-Management** — unveraendert
- **WebSocket-Protokoll** — unveraendert
- **Sicherheit** (Rate-Limiting, Origin-Check, DOMPurify) — unveraendert

## Dateistruktur (nach Umsetzung)

```
otris-docs-web/
  src/
    server.js              + MCP-Routen (/sse, /message)
    mcp-handler.js         NEU: McpServer Setup, Tool-Registration, Session-Map
    session-manager.js     unveraendert
    claude-bridge.js       MCP-Pfad angepasst
    codex-bridge.js        MCP-Pfad angepasst
  public/                  unveraendert
    help/                  + MCP-Setup-Abschnitt in der Doku
  vault/                   NEU: gecrawlte Markdown-Dateien
  Dockerfile               NEU
  .dockerignore            NEU
  package.json             + otris-docs-mcp + @modelcontextprotocol/sdk
```

## Risiken

| Risiko | Mitigation |
|--------|-----------|
| SDK-API aendert sich (SSE deprecated, neue Packages) | Zur Implementierung aktuelle SDK-Docs pruefen, SSE als Fallback behalten |
| otris-docs-mcp exportiert Tool-Logik nicht als Module | Tool-Handler ggf. in mcp-handler.js duplizieren oder otris-docs-mcp anpassen |
| Vault wird gross (aktuell ~995 Seiten) | .dockerignore fuer dev-files, Image bleibt trotzdem klein (~100MB) |
| Container-Restart bei Vault-Update | Akzeptabel fuer internes Tool, kein HA noetig |
| MCP-Client-Kompatibilitaet (Remote SSE/HTTP) | Vor Implementierung testen ob Claude Code und Codex CLI Remote-MCP per URL unterstuetzen |
