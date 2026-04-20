# Vault-Updates

Vaults liegen ausserhalb des Docker-Images auf dem Host. Der Container wird nur neu gestartet, nicht neu gebaut.

Der otris-Vault hat sein eigenes Repo: [otris-docs-vault](https://github.com/intexKluss/otris-docs-vault).

## otris-Vault: Erst-Einrichtung

Repo klonen (Git legt den `vaults/`-Parent automatisch mit an):

```bash
git clone https://github.com/intexKluss/otris-docs-vault.git /srv/otris/vaults/otris
```

Container starten oder neustarten:

```bash
docker restart docsvault
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
docker restart docsvault
```

Fertig — kein Rebuild noetig.

## otris-Vault neu crawlen (Dev-Rechner, Playwright)

Der Crawler lebt im `otris-docs-vault`-Repo unter `crawl/`. Er schreibt direkt in den Vault-Root.

```bash
cd /path/to/otris-docs-vault/crawl
npm install             # einmalig — zieht playwright
npm run crawl:login     # einmalig — browser-login, legt .auth.json an
npm run crawl           # vault komplett neu scrapen
```

Nach dem Crawl committen und pushen:

```bash
cd ..
git add -A
git commit -m "update vault content"
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
docker restart docsvault
```

## Bestehenden Non-otris-Vault aktualisieren

Dateien im Host-Verzeichnis aendern/austauschen, dann:

```bash
docker restart docsvault
```

## Vault entfernen

```bash
rm -rf /srv/otris/vaults/<name>
```

```bash
docker restart docsvault
```

## Warum kein Live-Reload?

Mehrere Nutzer koennten sonst unterschiedlichen Tool-Stand sehen. Container-Restart haelt alle Sessions konsistent. Der Restart ist nur ein paar Sekunden.
