# Gemini CLI

## Konfiguration

Gemini CLI unterstuetzt kein Remote-MCP direkt. Nutze den lokalen MCP-Proxy:

### 1. Proxy installieren

```bash
npm install -g git+ssh://git@github.com:leminkozey/otris-docs-mcp.git
```

### 2. In ~/.gemini/settings.json eintragen

```json
{
  "mcpServers": {
    "otris-docs": {
      "command": "otris-docs-mcp",
      "env": {
        "OTRIS_DOCS_URL": "http://<SERVER-IP>:3000"
      }
    }
  }
}
```

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Verifizierung

Starte Gemini CLI und stelle eine Testfrage zur otris Dokumentation.
