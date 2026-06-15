# VS Code

## Claude Code Extension

Die Claude Code VS Code Extension zieht ihre MCP-Server aus `~/.claude.json` (User Scope). Am schnellsten gehts per CLI:

```bash
claude mcp add --transport sse --scope user docsvault http://<SERVER-IP>:3000/sse
```

Danach VS Code einmal neu laden. Der Server taucht dann in der MCP-Liste der Extension auf.

**Wichtig:** `~/.claude/.mcp.json` liest nur die CLI, nicht die VS Code Extension. Also entweder `--scope user` benutzen oder den Eintrag von Hand in `~/.claude.json` setzen.

---

# VS Code (GitHub Copilot)

## Voraussetzungen

- VS Code **1.102** oder neuer (empfohlen)
- GitHub Copilot Extension installiert und eingeloggt
- Copilot Chat im **Agent Mode**

## Konfiguration

### Option A: Projekt-spezifisch (.vscode/mcp.json), empfohlen

Leg dir eine `.vscode/mcp.json` im Projektverzeichnis an:

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

`Ctrl+Shift+P` → **"MCP: Open User Configuration"** und das hier einfügen:

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

So steht der Server in jedem Projekt bereit, ohne dass du pro Repo eine `.vscode/mcp.json` brauchst.

> **Hinweis:** Die alte Methode über `settings.json` (`"mcp": { "servers": { ... } }`) ist ab VS Code 1.102 raus und durch die eigene `mcp.json` ersetzt. VS Code erkennt alte Einträge und bietet dir automatisch eine Migration an.

Ersetz `<SERVER-IP>` durch die IP deines Servers (z.B. `192.168.2.100`).

## Agent Mode aktivieren

Die MCP-Tools laufen nur im **Agent Mode** von Copilot Chat:

1. Copilot Chat öffnen (`Ctrl+Alt+I`)
2. Sicherstellen, dass **Agent** als Modus ausgewählt ist (über den Mode-Picker oben im Chat-Fenster)
3. Jetzt hat Copilot Zugriff auf die docsvault Tools

> **Hinweis:** Die Chat-UI wird regelmäßig umgebaut. Wenn kein Mode-Picker zu sehen ist, ist Agent Mode wahrscheinlich schon der Standard. Die MCP-Tools tauchen im Chat als verfügbare Tools auf, sobald der Server verbunden ist.

## Verifizierung

Im Agent Mode einfach eine Testfrage stellen:

> Suche in der otris Doku nach FileType

Copilot sollte die MCP-Tools ziehen und dir Ergebnisse aus der Dokumentation liefern.

## Troubleshooting

Falls der Server als "not connected" angezeigt wird:

1. **Server erreichbar?** Ruf im Browser `http://<SERVER-IP>:3000/sse` auf, es sollte eine SSE-Verbindung starten
2. **VS Code neu laden** über `Ctrl+Shift+P` → "Developer: Reload Window"
3. **MCP Output prüfen** über `Ctrl+Shift+P` → "MCP: List Servers", das zeigt dir den Verbindungsstatus
4. **Firewall** prüfen: Port 3000 muss vom Entwicklerrechner aus erreichbar sein
