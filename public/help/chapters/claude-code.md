# Claude Code

## Konfiguration

Verbinde Claude Code direkt per MCP-Netzwerkprotokoll mit dem otris-docs Server.

### Option A: Projekt-spezifisch (.mcp.json)

Erstelle eine `.mcp.json` im Projektverzeichnis:

```json
{
  "mcpServers": {
    "otris-docs": {
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

### Option B: Global (~/.claude/settings.json)

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

Starte Claude Code und pruefe mit `/mcp` ob der Server erkannt wird.

Stelle eine Testfrage: "Suche in der otris Doku nach FileType"
