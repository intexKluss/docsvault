# Token Efficiency Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die lokalen Token Efficiency Commits bekommen verlässliche Antwortbudgets, sichtbare Fehler, kompatible REST Defaults, datengetriebene TERAS Suche und einen Refactor nach Manus Codestil.

**Architecture:** MCP bleibt kompakt, REST behält seinen bisherigen Default Vertrag. Such- und Read Budgets werden an der tatsächlich ausgelieferten Antwort geprüft. Indexfehler werden bis zur äußeren Schnittstelle durchgereicht, und optionale technische Suchen werden aus der Vault Konfiguration beziehungsweise dem vorhandenen TERAS Verzeichnis abgeleitet.

**Tech Stack:** Node.js 20+, ES Modules, MiniSearch, MCP SDK, Express, `node:test`.

## Global Constraints

- Direkt auf dem bestehenden Branch `perf/token-efficiency` arbeiten.
- Tests immer zuerst schreiben und den erwarteten RED Lauf dokumentieren.
- Nach jeder abgeschlossenen Task einen kleinen englischen Commit erstellen.
- Nicht pushen und keine PR erstellen.
- Manus `coding-style` anwenden: Guard Clauses, Hauptablauf zuerst, Helper darunter in Aufrufreihenfolge, `var` statt `const` oder `let`, klassische Schleifen statt `.map()`, `.filter()` und `.join()`, keine Ternary Ketten, nur notwendige Kommentare, echte Umlaute und keine Em Dashes.
- Bestehende öffentliche Schnittstellen nur ändern, wenn diese Task den Vertrag ausdrücklich definiert.

---

### Task 1: Antwortbudgets und Suchfehler verlässlich machen

**Files:**
- Modify: `src/tools/vault.js`
- Modify: `src/tools/search.js`
- Modify: `src/tools/read.js`
- Modify: `src/mcp-handler.js`
- Modify: `src/api-routes.js`
- Modify: `test/vault.test.js`
- Modify: `test/mcp-handler.test.js`
- Modify: `test/server.test.js`

**Interfaces:**
- `searchDocs()` liefert weiterhin ein Array und hält `JSON.stringify(result).length <= maxTokens * 4`. Wenn nicht einmal ein vollständiger Treffer mit unverändertem `file` hineinpasst, liefert es ein leeres Array.
- `readDoc()` hält seinen Content inklusive Navigationshinweisen innerhalb seines Zeichenbudgets.
- MCP begrenzt den finalen ausgelieferten Read Text inklusive Titel und Source auf `max_tokens * 4` Zeichen.
- `handleSearch()` wandelt Fehler beim Indexaufbau in `{ error: "Search index unavailable: <message>" }` um.
- REST verwendet ohne Parameter weiterhin zehn detaillierte Suchtreffer. MCP verwendet weiterhin fünf kompakte Treffer.
- REST Read darf explizit bis 200000 Zeichen lesen. MCP bleibt bei maximal 25000 Zeichen.

- [ ] **Step 1: Failing tests schreiben**

Tests müssen lange Titel, Pfade und Headings verwenden und exakt gegen `maxTokens * 4` prüfen. Zusätzlich muss ein ungültiger interner Vault Pfad über `handleSearch()` einen Fehler statt `[]` liefern. REST muss ohne `response_format` ein Ergebnis mit `matches` und mit `response_format=concise` ein Ergebnis mit `snippet` liefern.

- [ ] **Step 2: RED prüfen**

Run: `node --test test/vault.test.js test/mcp-handler.test.js test/server.test.js`

Expected: Die neuen Budget-, Fehler- und REST Kompatibilitätstests schlagen aus den jeweils beschriebenen Gründen fehl.

- [ ] **Step 3: Minimale Implementierung schreiben**

Budgets erst nach Aufbau des vollständigen Ergebnisses anwenden. Pfade und Heading Namen niemals verstümmeln. Fehler nur an `handleSearch()` abfangen, dort klar benennen und von MCP sowie REST über die bestehenden Error Pfade ausgeben.

- [ ] **Step 4: GREEN prüfen**

Run: `node --test test/vault.test.js test/mcp-handler.test.js test/server.test.js`

Expected: Alle fokussierten Tests bestehen.

- [ ] **Step 5: Gesamtsuite und Commit**

Run: `npm test`

Commit: `fix(search): enforce response contracts`

---

### Task 2: Startup und technische Suche sauber konfigurieren

**Files:**
- Modify: `src/server.js`
- Modify: `src/mcp-stdio.js`
- Modify: `src/vault-registry.js`
- Modify: `src/mcp-handler.js`
- Die frühere zweite Bridge ist inzwischen entfernt.
- Modify: `test/vault-registry.test.js`
- Modify: `test/mcp-handler.test.js`
- Modify: `test/integration-multi-vault.test.js`

**Interfaces:**
- Der Suchindex wird synchron vor Freigabe der HTTP- beziehungsweise MCP Verbindung aufgebaut. Es gibt keinen irreführenden `setImmediate`-Hintergrundlauf.
- Registry Einträge besitzen optional `technicalSection`.
- `_meta.json.technicalSection` gewinnt. Ohne Konfiguration wird `Scripting/TERAS API` nur dann verwendet, wenn dieses Verzeichnis im Vault wirklich existiert.
- `<prefix>_technical_search` wird ausschließlich für Vaults mit `technicalSection` registriert und sucht genau in diesem Abschnitt.
- `getToolSuffixes()` leitet das zusätzliche Tool aus `technicalSection` ab, nicht aus dem Namen `otris`.

- [ ] **Step 1: Failing tests schreiben**

Tests müssen einen umbenannten Vault mit `technicalSection`, einen `otris`-Vault ohne technische Section und die automatische Erkennung des real vorhandenen TERAS Verzeichnisses abdecken. Der Servertest muss belegen, dass der Index bereits nach `createServer()` vorhanden ist und kein späteres `setImmediate` benötigt wird.

- [ ] **Step 2: RED prüfen**

Run: `node --test test/vault-registry.test.js test/mcp-handler.test.js test/integration-multi-vault.test.js test/server.test.js`

Expected: Die neuen Konfigurations- und Startup Tests schlagen fehl.

- [ ] **Step 3: Minimale Implementierung schreiben**

`technicalSection` beim Registry Aufbau validieren und nur übernehmen, wenn der kanonische Pfad innerhalb des Vaults existiert. Bestehende Tool Präfixe und normale Vaults unverändert lassen. Warmup vor `connect()` beziehungsweise vor Rückgabe des Servers ausführen.

- [ ] **Step 4: GREEN prüfen**

Run: `node --test test/vault-registry.test.js test/mcp-handler.test.js test/integration-multi-vault.test.js test/server.test.js`

Expected: Alle fokussierten Tests bestehen.

- [ ] **Step 5: Gesamtsuite und Commit**

Run: `npm test`

Commit: `refactor(mcp): derive technical search from vault data`

---

### Task 3: Branch Änderungen nach Manus Codestil refactoren und dokumentieren

**Files:**
- Modify: alle Produktions- und Testdateien, deren Zeilen in `origin/main..HEAD` durch die Token Efficiency Commits neu hinzugekommen oder wesentlich umgebaut wurden
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Keine Verhaltensänderung gegenüber dem grünen Stand aus Task 2.
- Neue beziehungsweise umgebaute Branch Zeilen verwenden `var`, klassische Schleifen, Guard Clauses und wenige notwendige Kommentare.
- Das README Beispiel verwendet `path=api/DocFile` ohne `.md`.
- README und Architektur beschreiben REST Kompatibilität, MCP Defaults, tatsächliche Budgetgrenzen, deterministischen Indexaufbau und die datengetriebene technische Suche korrekt.

- [ ] **Step 1: Bestehende Tests als Refactor Sicherung ausführen**

Run: `npm test`

Expected: Alle Tests bestehen vor dem Refactor.

- [ ] **Step 2: Produktionscode refactoren**

Nur Branch Änderungen anfassen. Funktionale Array Ketten in direkt geänderten Abläufen durch lesbare Schleifen ersetzen, neue Konstanten als `var` schreiben, Ternarys auflösen, Dekorationskommentare entfernen und Helper unter den Hauptablauf verschieben.

- [ ] **Step 3: Tests und Dokumentation refactoren**

Neue Tests ebenfalls nach dem Stil ausrichten, ohne ihre Assertions abzuschwächen. Falsche oder veraltete Beispiele korrigieren.

- [ ] **Step 4: Stil und Verhalten prüfen**

Run: `npm test`

Run: `git diff --check origin/main...HEAD`

Run: `git diff origin/main...HEAD -- src test | rg "^\\+.*\\b(const|let)\\b|^\\+.*\\.(map|filter|join)\\(|^\\+.*\\?.*:"`

Expected: Tests bestehen, Diff Check ist leer, und die Stil Suche liefert für die refactorten Branch Zeilen keine Treffer.

- [ ] **Step 5: Commit**

Commit: `refactor: align token efficiency code with project style`
