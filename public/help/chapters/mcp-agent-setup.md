# MCP mit deinem Coding-Agent nutzen

Wenn der otris-docs-web Server im LAN läuft, kannst du deinen Coding-Agent direkt damit verbinden — ohne lokale Installation. Der Agent bekommt dann direkten Zugriff auf otris-Dokumentation: suchen, lesen, auflisten.

## Verfügbare Tools nach der Einrichtung

| Tool | Funktion |
|------|----------|
| `otris_search` | Volltextsuche in der Dokumentation |
| `otris_read` | Einzelnes Dokument lesen |
| `otris_list` | Dokumente auflisten |
| `otris_overview` | Übersicht über verfügbare Inhalte |
| `otris_status` | Serverstatus prüfen |

## Claude Code

Füge den MCP Server zur Konfiguration hinzu — entweder projektspezifisch oder global.

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

Starte Claude Code neu und prüfe mit `/mcp` ob der Server erkannt wird.

## Codex CLI

Füge den Server zur Codex-Konfiguration hinzu (`~/.codex/config.json`):

```json
{
  "mcpServers": {
    "otris-docs": {
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

Prüfe danach mit `codex mcp list` ob der Server `otris-docs` erscheint.

## Hinweis

Ersetze `<SERVER-IP>` durch die tatsächliche LAN-IP des Servers, auf dem otris-docs-web läuft (z.B. `192.168.2.100`).
