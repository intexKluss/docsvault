# Claude Code

## Konfiguration

Claude Code hängst du direkt per MCP-Netzwerkprotokoll an den docsvault Server. Such dir eine der Optionen unten aus.

### Option A: CLI-Befehl (empfohlen)

```bash
claude mcp add --transport sse docsvault http://<SERVER-IP>:3000/sse
```

### Option B: Projekt-spezifisch (.mcp.json)

Leg dir eine `.mcp.json` im Projektverzeichnis an:

```json
{
  "mcpServers": {
    "docsvault": {
      "type": "sse",
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

### Option C: Global (CLI → ~/.claude.json)

```bash
claude mcp add --transport sse --scope user docsvault http://<SERVER-IP>:3000/sse
```

Das schreibt den Server in `~/.claude.json` und damit ist er in jedem Projekt und in der VS Code Extension verfügbar.

### Option D: Global (manuell ~/.claude/.mcp.json)

Nur für die CLI, nicht für die VS Code Extension:

```json
{
  "mcpServers": {
    "docsvault": {
      "type": "sse",
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

**Wichtig:** `~/.claude/.mcp.json` wird nur von der CLI gelesen. Für die VS Code Claude Code Extension muss der Server in `~/.claude.json` stehen (Option C per CLI-Befehl).

Ersetz `<SERVER-IP>` durch die IP deines Servers (z.B. `192.168.2.100`).

## Verifizierung

Start Claude Code und prüf mit `/mcp` ob der Server erkannt wird.

Dann stell eine Testfrage: "Suche in der Doku nach Installation"
