# Claude Code

## Konfiguration

Verbinde Claude Code direkt per MCP-Netzwerkprotokoll mit dem otris-docs Server.

### Option A: CLI-Befehl (empfohlen)

```bash
claude mcp add --transport sse otris-docs http://<SERVER-IP>:3000/sse
```

### Option B: Projekt-spezifisch (.mcp.json)

Erstelle eine `.mcp.json` im Projektverzeichnis:

```json
{
  "mcpServers": {
    "otris-docs": {
      "type": "sse",
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

### Option C: Global (~/.claude/settings.json)

```json
{
  "mcpServers": {
    "otris-docs": {
      "type": "sse",
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Verifizierung

Starte Claude Code und prüfe mit `/mcp` ob der Server erkannt wird.

Stelle eine Testfrage: "Suche in der otris Doku nach FileType"
