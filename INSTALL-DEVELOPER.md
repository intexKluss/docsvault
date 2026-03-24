# MCP Tool fuer Entwickler

Das `otris-docs-mcp` Tool gibt deinem Coding-Agent Zugriff auf die gesamte otris DOCUMENTS Dokumentation. Die Doku liegt auf dem Server — du brauchst keinen eigenen Vault.

## Voraussetzungen

- Node.js 20+
- Ein Coding-Agent der MCP unterstuetzt (Claude Code, Codex CLI, etc.)
- Netzwerkzugriff zum otris-docs Server

## Installation

```bash
npm install -g otris-docs-mcp
```

## Konfiguration

### Claude Code

In `.mcp.json` (im Projektordner oder global in `~/.claude/.mcp.json`):

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

### Codex CLI

In `~/.codex/config.json` oder `.codex/config.json` im Projektordner:

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

### Andere Agents

Umgebungsvariable setzen und den MCP Server starten:

```bash
export OTRIS_DOCS_URL=http://SERVER-IP:3000
otris-docs-mcp
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
