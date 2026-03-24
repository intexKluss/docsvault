# Gemini CLI

## Installation

```bash
npm install -g otris-docs-mcp
```

## Konfiguration

Füge den MCP Server zu `~/.gemini/settings.json` hinzu:

```json
{
  "mcpServers": {
    "otris-docs": {
      "command": "otris-docs-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

## Verifizierung

Starte Gemini CLI und stelle eine Testfrage zur otris Dokumentation.
