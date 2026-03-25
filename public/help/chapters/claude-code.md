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

### Option C: Global (CLI → ~/.claude.json)

```bash
claude mcp add --transport sse --scope user otris-docs http://<SERVER-IP>:3000/sse
```

Das schreibt den Server in `~/.claude.json` und ist dann in jedem Projekt und in der VS Code Extension verfügbar.

### Option D: Global (manuell ~/.claude/.mcp.json)

Nur für die CLI, nicht für die VS Code Extension:

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

**Wichtig:** `~/.claude/.mcp.json` wird nur von der CLI gelesen. Für die VS Code Claude Code Extension muss der Server in `~/.claude.json` stehen (Option C per CLI-Befehl).

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Verifizierung

Starte Claude Code und prüfe mit `/mcp` ob der Server erkannt wird.

Stelle eine Testfrage: "Suche in der otris Doku nach FileType"
