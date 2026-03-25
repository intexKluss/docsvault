# VS Code (GitHub Copilot)

## Voraussetzungen

- VS Code **1.99** oder neuer
- GitHub Copilot Extension installiert und eingeloggt
- Copilot Chat im **Agent Mode** (nicht Ask oder Edit)

## Konfiguration

### Option A: Projekt-spezifisch (.vscode/mcp.json)

Erstelle eine `.vscode/mcp.json` im Projektverzeichnis:

```json
{
  "servers": {
    "otris-docs": {
      "type": "sse",
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

### Option B: Global (VS Code User Settings)

`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)" und einfügen:

```json
{
  "mcp": {
    "servers": {
      "otris-docs": {
        "type": "sse",
        "url": "http://<SERVER-IP>:3000/sse"
      }
    }
  }
}
```

So ist der Server in jedem Projekt verfügbar, ohne `.vscode/mcp.json` pro Repo.

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Agent Mode aktivieren

MCP-Tools funktionieren nur im **Agent Mode** von Copilot Chat:

1. Copilot Chat öffnen (`Ctrl+Alt+I`)
2. Oben im Chat-Fenster das Dropdown von "Ask" oder "Edit" auf **"Agent"** umstellen
3. Jetzt hat Copilot Zugriff auf die otris-docs Tools

## Verifizierung

Im Agent Mode eine Testfrage stellen:

> Suche in der otris Doku nach FileType

Copilot sollte die MCP-Tools nutzen und Ergebnisse aus der Dokumentation liefern.
