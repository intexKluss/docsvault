# Codex CLI

## Konfiguration

### Option A: CLI-Befehl (empfohlen)

```bash
codex mcp add docsvault --url http://<SERVER-IP>:3000/mcp
```

### Option B: Manuell in ~/.codex/config.toml

```toml
[mcp_servers.docsvault]
url = "http://<SERVER-IP>:3000/mcp"
```

Ersetze `<SERVER-IP>` durch die IP des Servers (z.B. `192.168.2.100`).

## Verifizierung

```bash
codex mcp list
```

Der Server `docsvault` sollte in der Liste erscheinen mit Status `enabled`.
