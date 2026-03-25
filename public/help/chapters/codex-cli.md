# Codex CLI

## Konfiguration

### Option A: CLI-Befehl (empfohlen)

```bash
codex mcp add otris-docs --url http://<SERVER-IP>:3000/mcp
```

### Option B: Manuell in ~/.codex/config.toml

```toml
[mcp_servers.otris-docs]
url = "http://<SERVER-IP>:3000/mcp"
```

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Verifizierung

```bash
codex mcp list
```

Der Server `otris-docs` sollte in der Liste erscheinen mit Status `enabled`.
