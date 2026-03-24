# Claude Code

## Installation

```bash
npm install -g otris-docs-mcp
```

## Konfiguration

Füge den MCP Server zu deiner Claude Code Konfiguration hinzu.

### Option A: Projekt-spezifisch (.mcp.json)

Erstelle eine `.mcp.json` im Projektverzeichnis:

```json
{
  "mcpServers": {
    "otris-docs": {
      "command": "otris-docs-mcp"
    }
  }
}
```

### Option B: Global (~/.claude/settings.json)

```json
{
  "mcpServers": {
    "otris-docs": {
      "command": "otris-docs-mcp"
    }
  }
}
```

## Verifizierung

Starte Claude Code und prüfe mit `/mcp` ob der Server erkannt wird.

Stelle eine Testfrage: "Suche in der otris Doku nach FileType"
