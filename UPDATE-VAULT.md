# Vault-Updates

Vaults liegen ausserhalb des Docker-Images auf dem Host. Der Container wird nur neu gestartet, nicht neu gebaut.

## Neuen Vault hinzufuegen

```bash
mkdir -p /srv/otris/vaults/<name>
cat > /srv/otris/vaults/<name>/_meta.json <<'EOF'
{
  "name": "Anzeigename",
  "description": "Wofuer ist dieser Vault da? Landet in Tool-Descriptions.",
  "toolPrefix": "name"
}
EOF
# Markdown-Dateien ins Verzeichnis kopieren
docker restart otris-docs
```

## Bestehenden Vault aktualisieren

Einfach die MD-Dateien im Host-Verzeichnis aendern/austauschen:

```bash
# z.B. neue otris-Doku crawlen
cd /path/to/otris-docs-web
npm run crawl
cp -r vault/. /srv/otris/vaults/otris/
docker restart otris-docs
```

Hinweis: Der Crawler schreibt weiterhin in `./vault/` im Repo-Root — das ist nur ein Staging-Bereich. Die eigentliche Live-Quelle ist `/srv/otris/vaults/otris/`. Der `./vault/`-Ordner ist in `.gitignore` und soll nicht mehr committet werden.

## Vault entfernen

```bash
rm -rf /srv/otris/vaults/<name>
docker restart otris-docs
```

## Warum kein Live-Reload?

Mehrere Nutzer koennten sonst unterschiedlichen Tool-Stand sehen. Container-Restart haelt alle Sessions konsistent. Der Restart ist nur ein paar Sekunden.
