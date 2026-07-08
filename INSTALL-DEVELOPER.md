# MCP Tool für Entwickler

Dein Coding Agent (Claude Code, Codex CLI, Gemini CLI, VS Code Copilot, etc.) bekommt Zugriff auf alle Wissensbereiche (Vaults) die auf dem Server konfiguriert sind. Also z.B. Produktdokumentation, interne Richtlinien oder API-Referenzen. Die Inhalte liegen auf dem Server, du brauchst keinen eigenen Vault.

Welche Vaults der Server gerade bereitstellt siehst du unter `http://SERVER-IP:3000/api/vaults`. Pro Vault gibt es fünf Tools, benannt nach dem `toolPrefix` aus der Vault Konfiguration (z.B. `docs_search`, `team_notes_search`, ...).

## Voraussetzungen

- Ein Coding Agent der MCP unterstützt
- Netzwerkzugriff zum docsvault Server

## Option 1: Remote MCP (empfohlen)

Du verbindest deinen Agent direkt per MCP Netzwerkprotokoll mit dem Server. Keine lokale Installation nötig.

### Claude Code

Per CLI (empfohlen):

```bash
claude mcp add --transport sse --scope user docsvault http://SERVER-IP:3000/sse
```

`--scope user` schreibt in `~/.claude.json`. Damit ist der Server global da, auch in der VS Code Claude Code Extension.

Oder manuell in `.mcp.json` (im Projektordner, nur CLI):

```json
{
  "mcpServers": {
    "docsvault": {
      "type": "sse",
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

### Codex CLI

Per CLI (empfohlen):

```bash
codex mcp add docsvault --url http://SERVER-IP:3000/mcp
```

Oder manuell in `~/.codex/config.toml`:

```toml
[mcp_servers.docsvault]
url = "http://SERVER-IP:3000/mcp"
```

### Gemini CLI

Per CLI (empfohlen):

```bash
gemini mcp add --transport sse docsvault http://SERVER-IP:3000/sse
```

Oder manuell in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "docsvault": {
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

### VS Code (GitHub Copilot)

Brauchst du: VS Code 1.99+, Copilot Extension, **Agent Mode** im Chat.

Projekt-spezifisch in `.vscode/mcp.json`:

```json
{
  "servers": {
    "docsvault": {
      "type": "sse",
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

Oder global in den VS Code User Settings (`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)"):

```json
{
  "mcp": {
    "servers": {
      "docsvault": {
        "type": "sse",
        "url": "http://SERVER-IP:3000/sse"
      }
    }
  }
}
```

## Option 2: REST API

Für Agents oder Tools die kein MCP können. Jeder Vault hat seinen eigenen Prefix, und welche verfügbar sind listet dir `/api/vaults`:

```bash
# Welche Vaults existieren?
curl "http://SERVER-IP:3000/api/vaults"

# Pro Vault: /api/<toolPrefix>/<aktion>
curl "http://SERVER-IP:3000/api/docs/search?query=Installation"
curl "http://SERVER-IP:3000/api/docs/overview"
curl "http://SERVER-IP:3000/api/docs/list?section=Setup"
curl "http://SERVER-IP:3000/api/docs/status"
# read: immer den exakten Pfad aus search/list nehmen (URL-encoded), nie selbst zusammenbauen
curl "http://SERVER-IP:3000/api/docs/read?path=<exakter%20pfad%20aus%20search>"

# Falls der Server noch weitere Vaults anbietet, analog:
curl "http://SERVER-IP:3000/api/team_notes/search?query=commit"
```

`SERVER-IP` natürlich immer durch die echte Server Adresse ersetzen.

## Verfügbare Tools

Pro Vault registriert der Server fünf MCP Tools, benannt nach dem `toolPrefix` aus der Vault Konfiguration:

| Tool | Beschreibung |
|------|--------------|
| `<prefix>_search` | Volltextsuche in der Dokumentation |
| `<prefix>_read` | Einzelne Dokumentationsseite lesen |
| `<prefix>_list` | Seiten in einem Bereich auflisten |
| `<prefix>_overview` | Übersicht über alle Bereiche und Sektionen |
| `<prefix>_status` | Vault Status und Aktualität prüfen |

Beispiel: Ein Vault mit `toolPrefix: "docs"` bringt die Tools `docs_search`, `docs_read`, `docs_list`, `docs_overview`, `docs_status`. Ein zusätzlicher `team-notes`-Vault mit `toolPrefix: "team_notes"` bringt entsprechend `team_notes_search` usw.

## Testen

Agent starten und fragen:

> Welche Themen deckt die Dokumentation ab?

oder:

> Zeig mir die Dokumentation zur Installation
