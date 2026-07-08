# Gemini CLI

## Konfiguration

Gemini CLI kann mittlerweile Remote-MCP, du brauchst also keinen lokalen Proxy mehr. Du verbindest dich direkt per SSE.

### Option A: CLI-Befehl (empfohlen)

```bash
gemini mcp add --transport sse docsvault http://<SERVER-IP>:3000/sse
```

### Option B: Manuell in ~/.gemini/settings.json

User-Scope (global, in jedem Projekt verfügbar):

```json
{
  "mcpServers": {
    "docsvault": {
      "url": "http://<SERVER-IP>:3000/sse"
    }
  }
}
```

Wenn du es lieber pro Projekt willst statt global: die gleiche Config in `.gemini/settings.json` im Projektordner ablegen.

**Wichtig:** Allein die `url`-Eigenschaft markiert schon den SSE-Transport. Du brauchst hier kein `"type": "sse"` wie bei Claude Code.

Ersetze `<SERVER-IP>` durch die IP deines Servers (z.B. `192.168.2.100`).

## Verifizierung

```bash
gemini mcp list
```

Der Server `docsvault` sollte jetzt in der Liste auftauchen.

Starte Gemini CLI und stell eine Testfrage zu deiner Dokumentation. Die Tools werden automatisch genutzt.
