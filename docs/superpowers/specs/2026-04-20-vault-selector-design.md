# Vault-Selector im Frontend

## Kontext

Der Backend-Teil unterstuetzt mehrere Vaults (ein Unterordner je `VAULTS_ROOT` = ein Vault mit eigenen MCP-Tools und Beschreibung). Das Frontend ignoriert das komplett: Landing-Page hat eine einzige Fragebox, Tool-Progress zeigt "Durchsuche Dokumentation" — egal welcher Vault gerade getroffen wird. Der User weiss weder welche Vaults verfuegbar sind, noch kann er einen gezielt ansprechen.

Neu: Der User soll auf der Landing einen Vault auswaehlen und die gesamte Session ist dann auf diesen Vault beschraenkt.

## Anforderungen

- **Vault-Auswahl auf Landing** per Segmented-Selector (iOS-Style, zentriert oberhalb der Ueberschrift).
- **Default = erster Vault** in der Registry-Reihenfolge (alphabetisch nach `toolPrefix`).
- **Nur 1 Vault aktiv** gleichzeitig.
- **Hart eingeschraenkt**: LLM bekommt ausschliesslich die Tools des ausgewaehlten Vaults, System-Prompt beschreibt auch nur diesen Vault.
- **Chat = locked**: nach der ersten Nachricht laesst sich der Vault nicht mehr wechseln. Im Chat-Header wird der aktive Vault als Read-only-Badge angezeigt. Wechsel nur via "Neuer Chat".
- **Single-Vault-Fall (heute Default)**: kein Selector, kein Verhaltensunterschied zum Status quo.

## Architektur

### Datenfluss

```
Browser                                    Server
   |                                          |
   |--- WebSocket connect -------------------→|
   |                                          |  session_init (wie bisher)
   |                                          |  + vaults event (NEU)
   |←--- { type: 'session_init' } ------------|
   |←--- { type: 'vaults', list: [...] } -----|
   |                                          |
   | Client rendert Selector (oder nicht,     |
   | wenn list.length === 1)                  |
   |                                          |
   |--- { type: 'select_vault',               |
   |       toolPrefix: 'otris' } ------------→|
   |                                          |  SessionManager.createAndWarmUp
   |                                          |  (gefilterte Registry: 1 Eintrag)
   |←--- { type: 'session_ready' } -----------|
   |                                          |
   |--- { type: 'message', ... } ------------→|
   |                                          |
```

### Komponenten

**Backend:**

1. `vault-registry.js` — unveraendert. Registry ist bereits pro Vault.
2. `session-manager.js` — `createAndWarmUp(clientId, toolPrefix)` akzeptiert optional einen `toolPrefix`. Gibt ihn an die Bridge weiter.
3. `claude-bridge.js` / `codex-bridge.js` — Bridge-Konstruktor nimmt bereits eine Registry. Neue Methode/Logik: `createSession(toolPrefix?)` filtert die gespeicherte Registry intern auf genau diesen Prefix vor dem Bau von `systemPrompt` und `allowedTools`. Invalid-Prefix → throw.
4. `server.js` —
   - Beim WS-Connect sendet der Server neben `session_init` einen `vaults`-Event mit `[{ toolPrefix, name, description }, ...]`.
   - **Auto-Warm-Up Verhalten:**
     - Bei `vaultRegistry.length === 1`: sofort warm-up wie heute.
     - Bei `>= 2`: warte auf `select_vault` vom Client. Danach `createAndWarmUp(clientId, toolPrefix)`.
   - Handler fuer `{ type: 'select_vault', toolPrefix }`:
     - Validiere gegen Registry (`toolPrefix` muss existieren).
     - Wenn bereits Session existiert und toolPrefix gleich: no-op.
     - Wenn Session existiert und toolPrefix anders: `removeSession` + neu warm-uppen (nur erlaubt solange noch keine Message gesendet wurde → implizit via "session nicht ready" rejection schon mitgeregelt: wir erlauben es einfach generell vor Erstnachricht; Client lockt UI nach erster Nachricht).
     - Wenn noch keine Session: erstellen + warm-uppen.

**Frontend (`public/app.js` + `index.html` + `style.css`):**

1. Beim Empfang von `vaults`:
   - Registry lokal speichern, aktiver Vault = erster Eintrag.
   - Wenn `list.length >= 2`: Selector rendern (neues DOM-Element im Landing-Container, oberhalb `.landing-content`).
   - Wenn `list.length === 1`: Selector nicht rendern, aktiver Vault = der eine.
2. Client sendet `select_vault` mit dem aktiven Vault **sofort** nach Empfang von `vaults` (egal ob Single oder Multi). Server warmt dann.
3. Click auf Segment:
   - Nur moeglich vor erster Nachricht (danach `disabled`).
   - Sendet erneut `select_vault`. Input wird bis `session_ready` erneut disabled, Status zeigt "Wird auf Intex Regeln umgestellt...".
4. Im Chat-Header neues `<span class="vault-badge">` mit gruenem Dot + Vault-Name.
5. Input-Placeholder wird dynamisch auf "Was willst du zu <VaultName> wissen?" gesetzt.

### Fehlerfaelle

- **Invalid `toolPrefix`** vom Client → Server schickt `{ type: 'error', message: 'Unbekannter Vault' }`. Client zeigt Error, setzt Selector auf Default zurueck.
- **Warm-up fehlschlaegt** → bestehender Fehlerpfad (`warm-up failed`-Log, Error an Client).
- **Keine Vaults konfiguriert** → `vaults`-Event mit leerer Liste. Client zeigt Landing ohne Selector und mit disabled Input und Hinweis "Keine Vaults verfuegbar".

## UI-Details (Variant C)

- **Segmented** zentriert oberhalb `<h1>` im `.landing-content`.
- Container: `var(--bg-elevated)` Hintergrund, `var(--border)` Border, `10px` Radius, `3px` Padding.
- Segment: `8px 20px` Padding, `8px` Radius, `13px` Font. Active: `var(--bg)` Background + `var(--text-heading)` Text.
- Max 4-5 Vaults sinnvoll fuer Segmented — bei 6+ Vaults muss auf Scroll/Wrap umgestellt werden. Aktuell out-of-scope (YAGNI).
- Chat-Badge: `4px 10px` Padding, `6px` Radius, `var(--bg-elevated)` Background, kleiner `6px` gruener Dot (`var(--green)`) links vom Namen.

## Tests

Bestehende Tests in `test/` bleiben gruen. Neu:

- `test/vault-selector.test.js`:
  - `createAndWarmUp(clientId, 'otris')` erzeugt Session mit nur `otris_*` Tools.
  - `createAndWarmUp(clientId, 'invalid')` wirft Fehler.
  - WS-Flow: Connect → `vaults`-Event enthaelt alle Registry-Eintraege → `select_vault` triggert Warm-up → danach `session_ready`.
  - Switch vor Erstnachricht: zweites `select_vault` erzeugt neue Session.

## Nicht-Ziele

- Multi-Vault-Auswahl (eine zum anderen Zeitpunkt, falls ueberhaupt).
- Dynamische Vault-Zugabe ohne Neustart.
- Persistierung der User-Auswahl in localStorage (jede Session beginnt beim Default — `location.reload()` setzt sowieso zurueck).
- Vault-Icons/Avatare (Text reicht erstmal).

## Offene Entscheidungen

Keine. Alles geklaert.
