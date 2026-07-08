# Vault Updates

Die Vaults liegen außerhalb des Docker Images auf dem Host. Der Container wird nur neu gestartet, nicht neu gebaut.

Am saubersten hat jeder Vault sein eigenes Git Repo, dann läuft ein Update über `git pull`. Ein Vault kann aber genauso gut einfach ein Ordner mit Markdown Dateien ohne Git sein, dann ersetzt du die Dateien direkt.

## Vault: Erst Einrichtung

Repo klonen (Git legt den `vaults/`-Parent automatisch mit an):

```bash
git clone https://github.com/<dein-org>/<dein-vault-repo>.git /srv/docsvault/vaults/docs
```

Container starten oder neustarten:

```bash
docker restart docsvault
```

## Vault aktualisieren (neue Doku Version einspielen)

Auf dem Server:

```bash
cd /srv/docsvault/vaults/docs
```

```bash
git pull
```

```bash
docker restart docsvault
```

Fertig, kein Rebuild nötig.

## Content erzeugen (Dev Rechner)

Wie die Markdown Dateien im Vault Repo entstehen, ist docsvault egal: von Hand geschrieben, aus einer bestehenden Doku exportiert, oder mit einem eigenen Crawler/Generator erzeugt. Falls dein Vault Repo so ein Tooling mitbringt, liegt es meist in einem eigenen Unterordner (z.B. `crawl/`) mit eigenem `README.md`, das den Ablauf beschreibt.

Nach der Content Erzeugung committen und pushen:

```bash
git add -A
git commit -m "update vault content"
git push
```

Danach auf dem Server `git pull` + `docker restart` (siehe oben).

## Neuen Vault hinzufügen

Verzeichnis anlegen:

```bash
mkdir -p /srv/docsvault/vaults/<name>
```

`_meta.json` anlegen:

```bash
cat > /srv/docsvault/vaults/<name>/_meta.json <<'EOF'
{
  "name": "Anzeigename",
  "description": "Wofür ist dieser Vault da? Landet in Tool-Descriptions.",
  "toolPrefix": "name"
}
EOF
```

Markdown Dateien reinlegen, dann Container neustarten:

```bash
docker restart docsvault
```

## Bestehenden Vault aktualisieren

Dateien im Host Verzeichnis ändern oder austauschen, dann:

```bash
docker restart docsvault
```

## Vault entfernen

```bash
rm -rf /srv/docsvault/vaults/<name>
```

```bash
docker restart docsvault
```

## Warum kein Live Reload?

Sonst könnten mehrere Nutzer unterschiedlichen Tool Stand sehen. Der Container Restart hält alle Sessions konsistent und dauert eh nur ein paar Sekunden.
