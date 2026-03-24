# Codex CLI

## Installation

```bash
npm install -g otris-docs-mcp
```

## Konfiguration

Füge den MCP Server zu `~/.codex/config.toml` hinzu:

```toml
[mcp_servers.otris-docs]
command = "otris-docs-mcp"
```

## Verifizierung

```bash
codex mcp list
```

Der Server `otris-docs` sollte in der Liste erscheinen.
