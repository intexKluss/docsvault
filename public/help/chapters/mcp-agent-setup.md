# MCP mit deinem Coding-Agent nutzen

Wenn der docsvault Server im LAN läuft, kannst du deinen Coding-Agent direkt damit verbinden, ganz ohne lokale Installation. Der Agent bekommt dann direkten Zugriff auf die otris-Dokumentation: suchen, lesen, auflisten.

## Verfügbare Tools nach der Einrichtung

Pro Wissensbereich (Vault) auf dem Server gibt es fünf Tools mit dem Vault-Prefix. Beim Standard-Setup mit nur dem otris-Vault sind das diese:

| Tool | Funktion |
|------|----------|
| `otris_search` | Volltextsuche in der Dokumentation |
| `otris_read` | Einzelnes Dokument lesen |
| `otris_list` | Dokumente auflisten |
| `otris_overview` | Übersicht über verfügbare Inhalte |
| `otris_status` | Serverstatus prüfen |

Falls weitere Vaults konfiguriert sind (z.B. `intex-regeln`), kommen entsprechende Tools wie `intex_regeln_search` dazu. Die vollständige Liste liefert dir `http://<SERVER-IP>:3000/api/vaults`.

## Claude Code

### Option A: CLI-Befehl (empfohlen)

```bash
claude mcp add --transport sse docsvault http://<SERVER-IP>:3000/sse
```

### Option B: Projekt-spezifisch (.mcp.json)

Leg eine `.mcp.json` im Projektverzeichnis an:

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

Danach Claude Code neu starten und mit `/mcp` prüfen, ob der Server erkannt wird.

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

Danach mit `codex mcp list` prüfen, ob der Server `docsvault` auftaucht.

## Verbindung bricht weg? Dann auf Streamable HTTP (`/mcp`) umsteigen

SSE (`/sse`, `type: sse`) ist der Legacy-Transport und braucht eine dauerhaft offene Verbindung. Hinter einem Reverse-Proxy (z.B. auf einem Docker-Dev-Server) wird diese Verbindung oft schon nach kurzer Idle-Zeit gekappt. Typisches Symptom: der Client zeigt kurz die Tools an, dann ist der Server wieder weg.

Lösung: statt `/sse` den moderneren Streamable-HTTP-Endpunkt `/mcp` nutzen (`type: http`). Der hängt nicht an einer Dauerverbindung und kommt mit Proxies deutlich besser klar.

**Claude Code (CLI):**

```bash
claude mcp add --transport http docsvault http://<SERVER-IP>:3000/mcp
```

**Claude Code (.mcp.json / settings.json):**

```json
{
  "mcpServers": {
    "docsvault": {
      "type": "http",
      "url": "http://<SERVER-IP>:3000/mcp"
    }
  }
}
```

Codex nutzt sowieso schon `/mcp` (siehe oben). Hinter HTTPS entsprechend `https://...` statt `http://...`.

## Hinweis

Ersetze `<SERVER-IP>` durch die tatsächliche LAN-IP des Servers, auf dem docsvault läuft (z.B. `192.168.2.100`).
