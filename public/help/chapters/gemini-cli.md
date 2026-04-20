# Gemini CLI

## Konfiguration

Seit Gemini CLI Remote-MCP unterstuetzt, ist kein lokaler Proxy mehr noetig — du verbindest direkt per SSE.

### Option A: CLI-Befehl (empfohlen)

```bash
gemini mcp add --transport sse docsvault http://<SERVER-IP>:3000/sse
```

### Option B: Manuell in ~/.gemini/settings.json

User-Scope (global, in jedem Projekt verfuegbar):

```json
{
  "mcpServers": {
    "docsvault": {
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

Projekt-Scope statt User-Scope: die gleiche Config in `.gemini/settings.json` im Projektordner.

**Wichtig:** Die `url`-Eigenschaft allein markiert den SSE-Transport — kein `"type": "sse"` wie bei Claude Code.

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Verifizierung

```bash
gemini mcp list
```

Der Server `docsvault` sollte in der Liste erscheinen.

Starte Gemini CLI und stelle eine Testfrage zur otris Dokumentation oder Intex-Regeln — die Tools werden automatisch genutzt.
