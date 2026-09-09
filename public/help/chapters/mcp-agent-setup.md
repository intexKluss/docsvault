# MCP mit deinem Coding-Agent nutzen

Wenn der docsvault Server im LAN läuft, kannst du deinen Coding-Agent direkt damit verbinden, ganz ohne lokale Installation. Der Agent bekommt dann direkten Zugriff auf deine Dokumentation: suchen, lesen, auflisten.

## Verfügbare Tools nach der Einrichtung

Pro Wissensbereich (Vault) auf dem Server gibt es fünf Tools mit dem Vault-Prefix. Bei einem Vault mit `toolPrefix: "docs"` sind das diese:

| Tool | Funktion |
|------|----------|
| `docs_search` | Volltextsuche in der Dokumentation |
| `docs_read` | Einzelnes Dokument lesen |
| `docs_list` | Dokumente auflisten |
| `docs_overview` | Übersicht über verfügbare Inhalte |
| `docs_status` | Serverstatus prüfen |

Falls weitere Vaults konfiguriert sind (z.B. `team-notes`), kommen entsprechende Tools wie `team_notes_search` dazu. Die vollständige Liste liefert dir `http://<SERVER-IP>:3000/api/vaults`.

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

Codex nutzt sowieso schon `/mcp` (siehe oben). Hinter HTTPS entsprechend `https://...` statt `http://...`.

## Hinweis

Ersetze `<SERVER-IP>` durch die tatsächliche LAN-IP des Servers, auf dem docsvault läuft (z.B. `192.168.2.100`).
