# Selbst hosten & Quellcode

docsvault ist quelloffen. Wenn du es auf deiner eigenen Infrastruktur betreiben oder den Code anpassen willst, findest du hier den Einstieg.

## Die Repositories

| Repo | Was drin ist |
|------|--------------|
| [docsvault](https://github.com/intexKluss/docsvault) | Der komplette Server: Web-Chat, MCP-Server, Codex-/Claude-Bridge und das Dockerfile. |

Server und Inhalte sind bewusst getrennt: docsvault ist die Engine, deine Dokumentation sind die Daten. Die Vault-Inhalte leben in einem eigenen Repo (oder einfach einem Ordner mit `.md`-Dateien) - docsvault bringt selbst keinen Content mit, du kannst beliebig viele eigene Vaults einhängen.

## Schnellstart mit Docker

```bash
# 1. Server klonen
git clone https://github.com/intexKluss/docsvault.git
cd docsvault

# 2. Vault als Unterordner danebenlegen (dein eigenes Repo oder einfach ein Ordner mit .md-Dateien)
git clone https://github.com/<dein-org>/<dein-vault-repo>.git vaults/docs

# 3. Image bauen und starten
docker build -t docsvault .
docker run -d --name docsvault -p 3000:3000 \
  -v "$(pwd)/vaults:/app/vaults:ro" \
  -v docsvault-codex:/home/node/.codex \
  docsvault
```

Danach läuft die Oberfläche unter `http://localhost:3000`.

## KI-Login nicht vergessen

Der Server startet, aber die KI antwortet erst nach dem Login. Beim Standard-Image (Codex) meldest du dich einmal im laufenden Container an:

```bash
docker exec -it docsvault codex auth login --device-auth
```

Damit der Login einen Neustart übersteht, muss `/home/node/.codex` in einem Volume liegen (siehe das `-v docsvault-codex:...` oben). Welche Modelle dein Account nutzen darf, hängt vom Plan ab.

## Bridge wählen: Codex oder Claude

docsvault läuft mit zwei KI-Backends, gesteuert über die Umgebungsvariable `BRIDGE`:

- `BRIDGE=codex` - OpenAI Codex (Standard im mitgelieferten Image).
- `BRIDGE=claude` - Anthropic Claude.

## Ausführliche Anleitungen

Im docsvault-Repo liegen die vollständigen Docs:

- **`INSTALL-SERVER.md`** - Server produktiv aufsetzen: Docker, Volumes, Umgebungsvariablen, Reverse-Proxy.
- **`INSTALL-DEVELOPER.md`** - Lokal entwickeln, ohne Docker.
- **`UPDATE-VAULT.md`** - Vault-Inhalte aktualisieren.
- **`ARCHITECTURE.md`** - Wie der Server intern aufgebaut ist.
