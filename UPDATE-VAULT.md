# Vault aktualisieren

Der Vault enthaelt die gecrawlte otris DOCUMENTS Dokumentation als Markdown-Dateien. Das Crawlen passiert auf dem Mac (braucht Playwright/Browser), nicht auf dem Server.

## Voraussetzungen

- Node.js 20+
- Playwright installiert: `npm install` im Repo (installiert Playwright als devDependency)
- Playwright Browser: `npx playwright install chromium`
- Zugang zur otris DOCUMENTS Instanz

## Schritte

### 1. Repo aktuell halten

```bash
cd otris-docs-web
git pull
```

### 2. Einmalig: Login-Session erstellen

Oeffnet einen Chromium-Browser zur manuellen Anmeldung:

```bash
npm run crawl:login
```

Nach dem Login schliesst sich der Browser automatisch. Die Session wird gespeichert.

### 3. Crawler starten

```bash
npm run crawl
```

Optional nur eine bestimmte Sektion crawlen:

```bash
node crawl.mjs --section portalscript-api
```

### 4. Aenderungen committen und pushen

```bash
git add vault/
git commit -m "Update vault"
git push
```

### 5. Server aktualisieren

Auf dem Server:

```bash
cd otris-docs-web
git pull
docker build -t otris-docs .
docker stop otris-docs && docker rm otris-docs
docker run -d \
  --name otris-docs \
  --restart unless-stopped \
  -p 3000:3000 \
  -e BRIDGE=codex \
  -e ALLOWED_ORIGINS=http://SERVER-IP:3000 \
  -e ALLOW_NO_ORIGIN=true \
  otris-docs
```

## Hinweise

- Der Crawler braucht Playwright (einen echten Browser). Das funktioniert nur auf dem Mac, nicht im Docker-Container.
- Die Login-Session (`vault/.auth.json`) wird NICHT committet (in `.gitignore`).
- Nach dem Update sehen alle Nutzer (Web UI + MCP Clients) sofort die neue Doku.
