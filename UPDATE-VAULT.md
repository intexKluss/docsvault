# Vault-Updates

Vaults liegen ausserhalb des Docker-Images auf dem Host. Der Container wird nur neu gestartet, nicht neu gebaut.

Der otris-Vault hat sein eigenes Repo: [otris-docs-vault](https://github.com/intexKluss/otris-docs-vault).

## otris-Vault: Erst-Einrichtung

Verzeichnis anlegen:

```bash
mkdir -p /srv/otris/vaults
```

Repo klonen:

```bash
cd /srv/otris/vaults
```

```bash
git clone https://github.com/intexKluss/otris-docs-vault.git otris
```

Container starten oder neustarten:

```bash
docker restart otris-docs
```

## otris-Vault aktualisieren (neue Doku-Version einspielen)

Auf dem Server:

```bash
cd /srv/otris/vaults/otris
```

```bash
git pull
```

```bash
docker restart otris-docs
```

Fertig — kein Rebuild noetig.

## otris-Vault neu crawlen (Dev-Rechner, Playwright)

Nur wenn eine neue otris-Doku-Version vom Crawler gezogen werden soll:

```bash
cd /path/to/otris-docs-web
```

```bash
npm run crawl
```

Output landet in `./vault/` — das ist ein lokaler Staging-Ordner (in `.gitignore`, wird **nicht** in otris-docs-web committet).

Content ins Vault-Repo spiegeln:

```bash
cp -rf vault/. /path/to/otris-docs-vault/
```

```bash
cd /path/to/otris-docs-vault
```

```bash
git add -A
```

```bash
git commit -m "Update vault: <Datum oder Release-Notes>"
```

```bash
git push
```

Danach auf dem Server `git pull` + `docker restart` (siehe oben).

## Neuen Vault hinzufuegen (z.B. Intex-Regeln)

Verzeichnis anlegen:

```bash
mkdir -p /srv/otris/vaults/<name>
```

`_meta.json` anlegen:

```bash
cat > /srv/otris/vaults/<name>/_meta.json <<'EOF'
{
  "name": "Anzeigename",
  "description": "Wofuer ist dieser Vault da? Landet in Tool-Descriptions.",
  "toolPrefix": "name"
}
EOF
```

Markdown-Dateien reinlegen, dann Container neustarten:

```bash
docker restart otris-docs
```

## Bestehenden Non-otris-Vault aktualisieren

Dateien im Host-Verzeichnis aendern/austauschen, dann:

```bash
docker restart otris-docs
```

## Vault entfernen

```bash
rm -rf /srv/otris/vaults/<name>
```

```bash
docker restart otris-docs
```

## Warum kein Live-Reload?

Mehrere Nutzer koennten sonst unterschiedlichen Tool-Stand sehen. Container-Restart haelt alle Sessions konsistent. Der Restart ist nur ein paar Sekunden.
