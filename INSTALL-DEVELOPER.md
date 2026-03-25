# MCP Tool für Entwickler

Dein Coding-Agent (Claude Code, Codex CLI, Gemini CLI, etc.) bekommt Zugriff auf die gesamte otris DOCUMENTS Dokumentation. Die Doku liegt auf dem Server — du brauchst keinen eigenen Vault.

## Voraussetzungen

- Ein Coding-Agent der MCP unterstützt
- Netzwerkzugriff zum otris-docs Server

## Option 1: Remote MCP (empfohlen)

Verbinde deinen Agent direkt per MCP-Netzwerkprotokoll mit dem Server. Keine lokale Installation nötig.

### Claude Code

Per CLI (empfohlen):

```bash
claude mcp add --transport sse --scope user otris-docs http://SERVER-IP:3000/sse
```

`--scope user` schreibt in `~/.claude.json` — damit ist der Server global verfügbar, auch in der VS Code Claude Code Extension.

Oder manuell in `.mcp.json` (im Projektordner, nur CLI):

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

### Codex CLI

Per CLI (empfohlen):

```bash
codex mcp add otris-docs --url http://SERVER-IP:3000/mcp
```

Oder manuell in `~/.codex/config.toml`:

```toml
[mcp_servers.otris-docs]
url = "http://SERVER-IP:3000/mcp"
```

### VS Code (GitHub Copilot)

Voraussetzung: VS Code 1.99+, Copilot Extension, **Agent Mode** im Chat.

Projekt-spezifisch in `.vscode/mcp.json`:

```json
{
  "servers": {
    "otris-docs": {
      "type": "sse",
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

Oder global in den VS Code User Settings (`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)"):

```json
{
  "mcp": {
    "servers": {
      "otris-docs": {
        "type": "sse",
        "url": "http://SERVER-IP:3000/sse"
      }
    }
  }
}
```

## Option 2: Lokaler MCP-Proxy

Für Agents die kein Remote-MCP unterstützen (z.B. Gemini CLI). Installiert einen lokalen MCP-Server der Anfragen an den otris-docs-web Server weiterleitet.

```bash
npm install -g git+ssh://git@github.com:leminkozey/otris-docs-mcp.git
```

Dann in der Agent-Konfiguration:

```json
{
  "mcpServers": {
    "otris-docs": {
      "command": "otris-docs-mcp",
      "env": {
        "OTRIS_DOCS_URL": "http://SERVER-IP:3000"
      }
    }
  }
}
```

Details: [otris-docs-mcp Repository](https://github.com/leminkozey/otris-docs-mcp)

## Option 3: REST API

Für Agents oder Tools die kein MCP unterstützen:

```bash
curl "http://SERVER-IP:3000/api/search?query=DocFile"
curl "http://SERVER-IP:3000/api/read?path=Portalscript%20API/classes/DocFile"
curl "http://SERVER-IP:3000/api/list?section=Portalscript%20API"
curl "http://SERVER-IP:3000/api/overview"
curl "http://SERVER-IP:3000/api/status"
```

`SERVER-IP` immer durch die tatsächliche Server-Adresse ersetzen.

## Verfügbare Tools

| Tool | Beschreibung |
|------|--------------|
| `otris_search` | Volltextsuche in der Dokumentation |
| `otris_read` | Einzelne Dokumentationsseite lesen |
| `otris_list` | Seiten in einem Bereich auflisten |
| `otris_overview` | Übersicht über alle Bereiche und Sektionen |
| `otris_status` | Vault-Status und Aktualität prüfen |

## Testen

Agent starten und fragen:

> Welche Klassen gibt es in der PortalScript API?

oder:

> Zeig mir die Dokumentation zu DocFile
