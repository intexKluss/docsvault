# Claude Code

Claude Code kann die Vaults als MCP Client durchsuchen. Der Web Chat des Servers läuft unabhängig davon mit Codex.

## Für alle Projekte einrichten

```bash
claude mcp add --transport http --scope user docsvault http://<SERVER-IP>:3000/mcp
```

Der Eintrag wird in `~/.claude.json` gespeichert und steht auch der Claude Code Extension in VS Code zur Verfügung.

## Nur für ein Projekt

```bash
claude mcp add --transport http --scope project docsvault http://<SERVER-IP>:3000/mcp
```

Alternativ eine `.mcp.json` im Projektverzeichnis anlegen:

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

## SSE als Alternative

```bash
claude mcp add --transport sse --scope user docsvault http://<SERVER-IP>:3000/sse
```

Nimm genau eine Variante. Für Verbindungen über einen Reverse Proxy ist `/mcp` der bevorzugte Endpunkt.

## Verbindung prüfen

Ersetze `<SERVER-IP>` durch die Adresse deines Servers und starte Claude Code neu. Mit `/mcp` prüfst du die Verbindung, danach kannst du nach einer Seite aus der Doku fragen.

Weitere Details stehen in der [offiziellen MCP Anleitung](https://code.claude.com/docs/en/mcp).
