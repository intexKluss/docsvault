# MCP mit deinem Coding-Agent nutzen

Wenn der otris-docs-web Server im LAN laeuft, kannst du deinen Coding-Agent direkt damit verbinden — ohne lokale Installation. Der Agent bekommt dann direkten Zugriff auf otris-Dokumentation: suchen, lesen, auflisten.

## Verfuegbare Tools nach der Einrichtung

| Tool | Funktion |
|------|----------|
| `otris_search` | Volltextsuche in der Dokumentation |
| `otris_read` | Einzelnes Dokument lesen |
| `otris_list` | Dokumente auflisten |
| `otris_overview` | Uebersicht ueber verfuegbare Inhalte |
| `otris_status` | Serverstatus pruefen |

## Claude Code

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

Starte Claude Code neu und pruefe mit `/mcp` ob der Server erkannt wird.

## Codex CLI

Fuege den Server zur Codex-Konfiguration hinzu (`~/.codex/config.json`):

```json
{
  "mcpServers": {
    "otris-docs": {
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

Pruefe danach mit `codex mcp list` ob der Server `otris-docs` erscheint.

## Hinweis

Ersetze `<SERVER-IP>` durch die tatsaechliche LAN-IP des Servers, auf dem otris-docs-web laeuft (z.B. `192.168.2.100`).
