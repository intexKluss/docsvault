# VS Code

## Claude Code Extension

Die Claude Code VS Code Extension nutzt MCP-Server aus `~/.claude.json` (User Scope). Am einfachsten per CLI hinzufügen:

```bash
claude mcp add --transport sse --scope user docsvault http://<SERVER-IP>:3000/sse
```

Danach VS Code neu laden. Der Server erscheint in der MCP-Liste der Extension.

**Wichtig:** `~/.claude/.mcp.json` wird nur von der CLI gelesen, nicht von der VS Code Extension. Immer `--scope user` verwenden oder manuell in `~/.claude.json` eintragen.

---

# VS Code (GitHub Copilot)

## Voraussetzungen

- VS Code **1.102** oder neuer (empfohlen)
- GitHub Copilot Extension installiert und eingeloggt
- Copilot Chat im **Agent Mode**

## Konfiguration

### Option A: Projekt-spezifisch (.vscode/mcp.json) — empfohlen

Erstelle eine `.vscode/mcp.json` im Projektverzeichnis:

```json
{
  "servers": {
    "docsvault": {
      "type": "sse",
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

### Option B: Global (User MCP Configuration)

`Ctrl+Shift+P` → **"MCP: Open User Configuration"** und einfügen:

```json
{
  "servers": {
    "docsvault": {
      "type": "sse",
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

So ist der Server in jedem Projekt verfügbar, ohne `.vscode/mcp.json` pro Repo.

> **Hinweis:** Die alte Methode über `settings.json` (`"mcp": { "servers": { ... } }`) wurde ab VS Code 1.102 durch die eigenständige `mcp.json` ersetzt. VS Code erkennt alte Einträge und bietet automatisch eine Migration an.

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Agent Mode aktivieren

MCP-Tools funktionieren nur im **Agent Mode** von Copilot Chat:

1. Copilot Chat öffnen (`Ctrl+Alt+I`)
2. Sicherstellen, dass **Agent** als Modus ausgewählt ist (über den Mode-Picker oben im Chat-Fenster)
3. Jetzt hat Copilot Zugriff auf die docsvault Tools

> **Hinweis:** Die Chat-UI wird regelmäßig aktualisiert. Falls kein Mode-Picker sichtbar ist, ist Agent Mode möglicherweise bereits der Standard. Die MCP-Tools werden im Chat als verfügbare Tools angezeigt, sobald der Server verbunden ist.

## Verifizierung

Im Agent Mode eine Testfrage stellen:

> Suche in der otris Doku nach FileType

Copilot sollte die MCP-Tools nutzen und Ergebnisse aus der Dokumentation liefern.

## Troubleshooting

Falls der Server als "not connected" angezeigt wird:

1. **Server erreichbar?** — Im Browser `http://<SERVER-IP>:3000/sse` aufrufen, es sollte eine SSE-Verbindung starten
2. **VS Code neu laden** — `Ctrl+Shift+P` → "Developer: Reload Window"
3. **MCP Output prüfen** — `Ctrl+Shift+P` → "MCP: List Servers" zeigt den Verbindungsstatus
4. **Firewall** — Port 3000 muss vom Entwicklerrechner aus erreichbar sein
