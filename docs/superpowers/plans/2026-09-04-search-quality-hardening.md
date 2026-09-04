# Search Quality Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die fünf Review-Findings aus Pull Request #4 mit reproduzierenden Tests und kleinen Commits beheben.

**Architecture:** Die bestehende Suchpipeline bleibt erhalten. Korrekturen werden an den vorhandenen Filter-, Fallback-, Cache- und Fehlergrenzen vorgenommen; neue öffentliche APIs oder plattformabhängige Watcher entstehen nicht.

**Tech Stack:** Node.js 20+, ES Modules, MiniSearch, `node:test`.

## Global Constraints

- Produktionscode folgt Manus `coding-style`: `var`, klassische Schleifen, Guard Clauses, Hauptablauf zuerst und keine unnötigen Helper.
- Jede Verhaltensänderung beginnt mit einem fehlschlagenden Test.
- Nach jeder grünen Änderung wird sofort ein kleiner englischer Commit erstellt.
- Bestehende MCP- und REST-Antwortformen bleiben unverändert.
- Nicht pushen.

---

### Task 1: Section-Scope strikt halten

**Files:**
- Modify: `test/vault.test.js`
- Modify: `src/tools/vault.js:225-231`

**Interfaces:**
- Consumes: `searchDocs(vaultPath, query, { section })`
- Produces: Treffer ausschließlich unter `section/`

- [ ] **Step 1: Failing Test schreiben**

Ergänze eine Section `scope/` und die gleichnamige Geschwisterdatei `scope.md`. Suche nach demselben Marker und prüfe, dass nur `scope/Page` zurückkommt.

```js
it('does not include a sibling page with the same name as the section', () => {
  var results = searchDocs(VAULT_PATH, 'SectionBoundaryNeedle', { section: 'scope' });
  var files = [];
  for (var resultIndex = 0; resultIndex < results.length; resultIndex++) {
    files.push(results[resultIndex].file);
  }
  assert.deepEqual(files, ['scope/Page']);
});
```

- [ ] **Step 2: RED prüfen**

Run: `node --test test/vault.test.js`

Expected: FAIL, weil zusätzlich `scope` geliefert wird.

- [ ] **Step 3: Minimalen Fix schreiben**

Der Filter akzeptiert nur noch Dateien mit dem Prefix `sectionPrefix`.

```js
return !!segment && segment.file.startsWith(sectionPrefix);
```

- [ ] **Step 4: GREEN prüfen und committen**

Run: `node --test test/vault.test.js`

Commit: `fix(search): keep section results inside directory`

---

### Task 2: Unbekannte Query-Terme fuzzy ergänzen

**Files:**
- Modify: `test/vault.test.js`
- Modify: `src/tools/vault.js:234-238`

**Interfaces:**
- Consumes: exakte MiniSearch-Treffer und `index.hasTerm(term)`
- Produces: kombinierte Treffer mit vereinigten `terms` und addiertem Score pro Segment-ID

- [ ] **Step 1: Failing Test schreiben**

Lege ein Zielsegment mit `CommonSearchToken RareCorrectedNeedle` und eine Noise-Seite mit häufigem `CommonSearchToken` an. Die Query `CommonSearchToken RareCorrectedNeedl` muss das Ziel zuerst liefern.

```js
it('fuzzy-matches an unknown term even when another term has exact hits', () => {
  var results = searchDocs(VAULT_PATH, 'CommonSearchToken RareCorrectedNeedl');
  assert.equal(results[0].file, 'fuzzy/Target');
});
```

- [ ] **Step 2: RED prüfen**

Run: `node --test test/vault.test.js`

Expected: FAIL, weil der exakte häufige Term den fuzzy Fallback unterdrückt.

- [ ] **Step 3: Minimalen Fix schreiben**

Baue aus unbekannten Query-Termen eine zusätzliche Query. Führe dafür fuzzy und Prefix Search aus. Merge anhand `id`, addiere den Score und ergänze fehlende Trefferterme; neue IDs werden angehängt.

```js
var fuzzyQuery = '';
for (var termIndex = 0; termIndex < terms.length; termIndex++) {
  if (index.hasTerm(terms[termIndex])) continue;
  if (fuzzyQuery) fuzzyQuery += ' ';
  fuzzyQuery += terms[termIndex];
}
```

- [ ] **Step 4: GREEN prüfen und committen**

Run: `node --test test/vault.test.js`

Commit: `fix(search): fuzzy match missing query terms`

---

### Task 3: Manifestlose Cache-Prüfung drosseln

**Files:**
- Modify: `test/cache-traversal.test.js`
- Modify: `test/vault-cache.test.js`
- Modify: `src/tools/vault-cache.js:7-65`

**Interfaces:**
- Consumes: bestehende rekursive Änderungssignatur
- Produces: höchstens eine rekursive Prüfung pro Vault und Sekunde

- [ ] **Step 1: Failing Test schreiben**

Erweitere `cache-traversal.test.js`: Nach einem warmen Zugriff setzt der Test den Zähler zurück und führt sofort eine zweite Suche aus. Der Vault-Root darf dabei nicht erneut gelesen werden.

```js
rootReads = 0;
var cached = searchTools.handleSearch(VAULT_PATH, { query: 'TraversalNeedle' });
assert.equal(cached.length, 1);
assert.equal(rootReads, 0);
```

- [ ] **Step 2: RED prüfen**

Run: `node --test test/cache-traversal.test.js test/vault-cache.test.js`

Expected: FAIL mit `rootReads === 1`.

- [ ] **Step 3: Minimalen Fix schreiben**

Speichere `manifestlessValidUntil` im Cache-Eintrag. Manifestlose bestehende Einträge werden innerhalb von 1000 Millisekunden direkt geliefert. Nach einer echten Prüfung mit unverändertem Change-Key wird die Frist erneuert. Der Invalidierungstest wartet vor der erwarteten Neuerkennung 1100 Millisekunden.

```js
var MANIFESTLESS_VALIDATION_INTERVAL_MS = 1000;
```

- [ ] **Step 4: GREEN prüfen und committen**

Run: `node --test test/cache-traversal.test.js test/vault-cache.test.js`

Commit: `perf(cache): throttle manifestless vault scans`

---

### Task 4: Interne Suchfehler redigieren

**Files:**
- Modify: `test/vault.test.js`
- Modify: `test/vault-cache.test.js`
- Modify: `src/tools/search.js:45-47`

**Interfaces:**
- Consumes: interne Exception mit Pfadkontext
- Produces: öffentlich `{ error: 'Search index unavailable.' }`, vollständiges `console.error` nur serverseitig

- [ ] **Step 1: Failing Tests schreiben**

Ändere die bestehenden Fehlerassertions auf die generische Meldung und fange `console.error` ab. Prüfe getrennt, dass das Log weiterhin `Vault path is not a directory` beziehungsweise den betroffenen Markdown-Dateinamen enthält.

```js
assert.equal(result.error, 'Search index unavailable.');
assert.match(loggedError, /Vault path is not a directory/);
```

- [ ] **Step 2: RED prüfen**

Run: `node --test test/vault.test.js test/vault-cache.test.js`

Expected: FAIL, weil die öffentliche Meldung aktuell interne Details enthält.

- [ ] **Step 3: Minimalen Fix schreiben**

```js
console.error(`[search] index unavailable: ${err.message}`);
return { error: 'Search index unavailable.' };
```

- [ ] **Step 4: GREEN prüfen und committen**

Run: `node --test test/vault.test.js test/vault-cache.test.js`

Commit: `fix(search): redact internal index errors`

---

### Task 5: Reihenfolge deterministisch machen

**Files:**
- Modify: `test/vault.test.js`
- Modify: `src/tools/search-index.js:38-40`
- Modify: `src/tools/vault.js:714-716`

**Interfaces:**
- Consumes: Dateipfade und bewertete Dateigruppen
- Produces: alphabetische Dateireihenfolge bei identischen Scores

- [ ] **Step 1: Failing Test schreiben**

Erzeuge zwei inhaltlich identische Treffer `alpha` und `zeta`, drehe die MiniSearch-Hits kontrolliert um und prüfe, dass `alpha` trotzdem zuerst kommt.

```js
var originalSearch = index.mini.search.bind(index.mini);
index.mini.search = function (query, options) {
  return originalSearch(query, options).reverse();
};
var results = searchDocs(vaultPath, 'StableOrderNeedle');
var files = [];
for (var resultIndex = 0; resultIndex < results.length; resultIndex++) {
  files.push(results[resultIndex].file);
}
assert.deepEqual(files, ['stable/alpha', 'stable/zeta']);
```

- [ ] **Step 2: RED prüfen**

Run: `node --test test/vault.test.js`

Expected: FAIL mit umgekehrter Trefferreihenfolge.

- [ ] **Step 3: Minimalen Fix schreiben**

Sortiere `files` direkt nach dem Einsammeln. Vergleiche beim finalen Ranking zuerst den Score und bei Gleichstand `group.file`.

```js
files.sort();
```

- [ ] **Step 4: GREEN prüfen und committen**

Run: `node --test test/vault.test.js`

Commit: `fix(search): stabilize equal-score ordering`

---

### Task 6: Gesamtverifikation

**Files:**
- Verify: alle geänderten Produktions-, Test- und Dokumentationsdateien

**Interfaces:**
- Consumes: Tasks 1 bis 5
- Produces: grüner Branch ohne Whitespace-Fehler oder unerwartete Änderungen

- [ ] **Step 1: Vollständige Suite ausführen**

Run: `npm test`

Expected: alle Tests bestehen.

- [ ] **Step 2: Diff und Stil prüfen**

Run: `git diff --check origin/main...HEAD`

Run: `git status --short`

Expected: kein Diff-Fehler und keine uncommitteten Dateien.
