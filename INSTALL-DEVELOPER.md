# MCP Tool für Entwickler

Dein Coding-Agent (Claude Code, Codex CLI, VS Code Copilot, etc.) bekommt Zugriff auf alle auf dem Server konfigurierten Wissensbereiche (Vaults) — z.B. die otris DOCUMENTS Dokumentation plus interne Firmenregeln. Die Inhalte liegen auf dem Server, du brauchst keinen eigenen Vault.

Welche Vaults der Server bereitstellt siehst du unter `http://SERVER-IP:3000/api/vaults`. Pro Vault gibt es fünf Tools mit dem `toolPrefix` aus der Vault-Konfiguration (z.B. `otris_search`, `intex_regeln_search`, ...).

## Voraussetzungen

- Ein Coding-Agent der MCP unterstützt
- Netzwerkzugriff zum otris-docs Server

## Option 1: Remote MCP (empfohlen)

Verbinde deinen Agent direkt per MCP-Netzwerkprotokoll mit dem Server. Keine lokale Installation nötig.

### Claude Code

Per CLI (empfohlen):

```bash
claude mcp add --transport sse --scope user otris-docs http://SERVER-IP:3000/sse
```

`--scope user` schreibt in `~/.claude.json` — damit ist der Server global verfügbar, auch in der VS Code Claude Code Extension.

Oder manuell in `.mcp.json` (im Projektordner, nur CLI):

```json
{
  "mcpServers": {
    "otris-docs": {
      "type": "sse",
      "url": "http://SERVER-IP:3000/sse"
    }
  }
}
```

### Codex CLI

Per CLI (empfohlen):

```bash
codex mcp add otris-docs --url http://SERVER-IP:3000/mcp
```

Oder manuell in `~/.codex/config.toml`:

```toml
[mcp_servers.otris-docs]
url = "http://SERVER-IP:3000/mcp"
```

### VS Code (GitHub Copilot)

Voraussetzung: VS Code 1.99+, Copilot Extension, **Agent Mode** im Chat.

Projekt-spezifisch in `.vscode/mcp.json`:

```json
{
  "servers": {
    "otris-docs": {
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
      "otris-docs": {
        "type": "sse",
        "url": "http://SERVER-IP:3000/sse"
      }
    }
  }
}
```

## Option 2: REST API

Für Agents oder Tools die kein MCP unterstützen. Jeder Vault hat seinen eigenen Prefix — welche verfuegbar sind, listet `/api/vaults`:

```bash
# Welche Vaults existieren?
curl "http://SERVER-IP:3000/api/vaults"

# Pro Vault: /api/<toolPrefix>/<aktion>
curl "http://SERVER-IP:3000/api/otris/search?query=DocFile"
curl "http://SERVER-IP:3000/api/otris/read?path=Portalscript%20API/classes/DocFile"
curl "http://SERVER-IP:3000/api/otris/list?section=Portalscript%20API"
curl "http://SERVER-IP:3000/api/otris/overview"
curl "http://SERVER-IP:3000/api/otris/status"

# Falls der Server weitere Vaults anbietet, analog:
curl "http://SERVER-IP:3000/api/intex_regeln/search?query=commit"
```

`SERVER-IP` immer durch die tatsächliche Server-Adresse ersetzen.

## Verfügbare Tools

Pro Vault registriert der Server fünf MCP-Tools mit dem `toolPrefix` aus der Vault-Konfiguration:

| Tool | Beschreibung |
|------|--------------|
| `<prefix>_search` | Volltextsuche in der Dokumentation |
| `<prefix>_read` | Einzelne Dokumentationsseite lesen |
| `<prefix>_list` | Seiten in einem Bereich auflisten |
| `<prefix>_overview` | Übersicht über alle Bereiche und Sektionen |
| `<prefix>_status` | Vault-Status und Aktualität prüfen |

Beispiel: Beim Default-Setup heißt der otris-Vault-Prefix `otris` → Tools `otris_search`, `otris_read`, `otris_list`, `otris_overview`, `otris_status`. Ein zusätzlicher `intex-regeln`-Vault mit `toolPrefix: "intex_regeln"` bringt entsprechend `intex_regeln_search` usw.

## Testen

Agent starten und fragen:

> Welche Klassen gibt es in der PortalScript API?

oder:

> Zeig mir die Dokumentation zu DocFile
