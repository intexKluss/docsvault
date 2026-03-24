# Gemini CLI

## Konfiguration

Fuege den MCP Server zu `~/.gemini/settings.json` hinzu:

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

Starte Gemini CLI und stelle eine Testfrage zur otris Dokumentation.
