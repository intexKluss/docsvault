# Codex CLI

## Konfiguration

Fuege den MCP Server zu `~/.codex/config.json` hinzu:

```json
{
  "mcpServers": {
    "otris-docs": {
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Verifizierung

```bash
codex mcp list
```

Der Server `otris-docs` sollte in der Liste erscheinen.
