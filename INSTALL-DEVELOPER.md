# MCP Tool fuer Entwickler

Dein Coding-Agent (Claude Code, Codex CLI, Gemini CLI, etc.) bekommt Zugriff auf die gesamte otris DOCUMENTS Dokumentation. Die Doku liegt auf dem Server — du brauchst keinen eigenen Vault.

## Voraussetzungen

- Ein Coding-Agent der MCP unterstuetzt
- Netzwerkzugriff zum otris-docs Server

## Option 1: Remote MCP (empfohlen)

Verbinde deinen Agent direkt per MCP-Netzwerkprotokoll mit dem Server. Keine lokale Installation noetig.

### Claude Code

Per CLI (empfohlen):

```bash
claude mcp add --transport sse otris-docs http://SERVER-IP:3000/sse
```

Oder manuell in `.mcp.json` (im Projektordner oder global in `~/.claude/.mcp.json`):

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

## Option 2: Lokaler MCP-Proxy

Fuer Agents die kein Remote-MCP unterstuetzen (z.B. Gemini CLI). Installiert einen lokalen MCP-Server der Anfragen an den otris-docs-web Server weiterleitet.

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

Fuer Agents oder Tools die kein MCP unterstuetzen:

```bash
curl "http://SERVER-IP:3000/api/search?query=DocFile"
curl "http://SERVER-IP:3000/api/read?path=Portalscript%20API/classes/DocFile"
curl "http://SERVER-IP:3000/api/list?section=Portalscript%20API"
curl "http://SERVER-IP:3000/api/overview"
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
