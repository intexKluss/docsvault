# Codex CLI

## Konfiguration

### Option A: Über die CLI (der einfache Weg)

```bash
codex mcp add docsvault --url http://<SERVER-IP>:3000/mcp
```

### Option B: Von Hand in ~/.codex/config.toml eintragen

```toml
[mcp_servers.docsvault]
url = "http://<SERVER-IP>:3000/mcp"
```

Ersetz `<SERVER-IP>` durch die IP deines Servers (z.B. `192.168.2.100`).

## Kurz prüfen ob alles läuft

```bash
codex mcp list
```

Der Server `docsvault` sollte jetzt in der Liste auftauchen, mit Status `enabled`. Wenn ja, passt alles.
