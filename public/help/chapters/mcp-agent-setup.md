# MCP mit deinem Coding-Agent nutzen

Wenn der docsvault Server im LAN läuft, kannst du deinen Coding-Agent direkt damit verbinden — ohne lokale Installation. Der Agent bekommt dann direkten Zugriff auf otris-Dokumentation: suchen, lesen, auflisten.

## Verfügbare Tools nach der Einrichtung

Pro Wissensbereich (Vault) auf dem Server gibt es fünf Tools mit dem Vault-Prefix. Beim Standard-Setup mit nur dem otris-Vault sind das:

| Tool | Funktion |
|------|----------|
| `otris_search` | Volltextsuche in der Dokumentation |
| `otris_read` | Einzelnes Dokument lesen |
| `otris_list` | Dokumente auflisten |
| `otris_overview` | Übersicht über verfügbare Inhalte |
| `otris_status` | Serverstatus prüfen |

Falls weitere Vaults konfiguriert sind (z.B. `intex-regeln`), kommen entsprechende Tools wie `intex_regeln_search` dazu. Die vollständige Liste liefert `http://<SERVER-IP>:3000/api/vaults`.

## Claude Code

### Option A: CLI-Befehl (empfohlen)

```bash
claude mcp add --transport sse docsvault http://<SERVER-IP>:3000/sse
```

### Option B: Projekt-spezifisch (.mcp.json)

Erstelle eine `.mcp.json` im Projektverzeichnis:

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

### Option C: Global (~/.claude/settings.json)

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

Starte Claude Code neu und prüfe mit `/mcp` ob der Server erkannt wird.

## Codex CLI

Per CLI (empfohlen):

```bash
codex mcp add docsvault --url http://<SERVER-IP>:3000/mcp
```

Oder manuell in `~/.codex/config.toml`:

```toml
[mcp_servers.docsvault]
url = "http://<SERVER-IP>:3000/mcp"
```

Prüfe danach mit `codex mcp list` ob der Server `docsvault` erscheint.

## Hinweis

Ersetze `<SERVER-IP>` durch die tatsächliche LAN-IP des Servers, auf dem docsvault läuft (z.B. `192.168.2.100`).
