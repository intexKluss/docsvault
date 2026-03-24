# MCP Tool fuer Entwickler

Dein Coding-Agent (Claude Code, Codex CLI, Gemini CLI, etc.) bekommt Zugriff auf die gesamte otris DOCUMENTS Dokumentation. Die Doku liegt auf dem Server — du brauchst keinen eigenen Vault.

## Voraussetzungen

- Ein Coding-Agent der MCP unterstuetzt
- Netzwerkzugriff zum otris-docs Server

## Option 1: Remote MCP (empfohlen)

Verbinde deinen Agent direkt per MCP-Netzwerkprotokoll mit dem Server.

### Claude Code

In `.mcp.json` (im Projektordner oder global in `~/.claude/.mcp.json`):

```json
{
  "mcpServers": {
    "otris-docs": {
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

### Codex CLI

In `~/.codex/config.json` oder `.codex/config.json` im Projektordner:

```json
{
  "mcpServers": {
    "otris-docs": {
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

## Option 2: REST API

Fuer Agents oder Tools die kein MCP unterstuetzen, gibt es eine REST API:

```bash
# Suchen
curl "http://SERVER-IP:3000/api/search?query=DocFile"

# Dokument lesen
curl "http://SERVER-IP:3000/api/read?path=portalscript-api/classes/DocFile"

# Bereich auflisten
curl "http://SERVER-IP:3000/api/list?section=portalscript-api"

# Uebersicht
curl "http://SERVER-IP:3000/api/overview"

# Status
curl "http://SERVER-IP:3000/api/status"
```

`SERVER-IP` immer durch die tatsaechliche Server-Adresse ersetzen.

## Verfuegbare Tools

| Tool | Beschreibung |
|------|--------------|
| `otris_search` | Volltextsuche in der Dokumentation |
| `otris_read` | Einzelne Dokumentationsseite lesen |
| `otris_list` | Seiten in einem Bereich auflisten |
| `otris_overview` | Uebersicht ueber alle Bereiche und Sektionen |
| `otris_status` | Vault-Status und Aktualitaet pruefen |

## Testen

Agent starten und fragen:

> Welche Klassen gibt es in der PortalScript API?

oder:

> Zeig mir die Dokumentation zu DocFile
