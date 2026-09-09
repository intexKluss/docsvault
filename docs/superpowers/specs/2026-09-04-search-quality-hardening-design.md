# Search Quality Hardening Design

## Ziel

Die fünf Review Findings aus Pull Request #4 werden behoben, ohne die neuen MCP- und REST Verträge oder das bestehende BM25 Ranking unnötig umzubauen.

## Suchkorrektheit

Eine Section bezeichnet immer ein Verzeichnis. Der Suchfilter akzeptiert deshalb ausschließlich Dateien unterhalb von `section/`; eine gleichnamige Markdown Datei neben dem Verzeichnis gehört nicht zum Scope.

Exakte Treffer bleiben der erste Suchpfad. Für Query Terme, die nicht exakt im Index vorkommen, wird zusätzlich eine fuzzy und Prefix fähige Suche ausgeführt. Treffer derselben Segment ID werden zusammengeführt, ihre gefundenen Terme vereinigt und ihre Scores addiert, damit ein bereits durch einen häufigen Begriff gefundenes Segment den korrigierten seltenen Begriff nicht verliert.

## Cache Verhalten

Vaults mit `_manifest.json` behalten die günstige Prüfung über mtime und Größe. Manifestlose Vaults berechnen ihre rekursive Änderungssignatur höchstens einmal pro Sekunde. Innerhalb dieses Fensters wird der bestehende Cache Eintrag direkt verwendet; Änderungen werden spätestens beim ersten Zugriff nach Ablauf des Fensters erkannt.

Die Frist ist eine interne Konstante. Es entsteht keine neue öffentliche Konfiguration und kein plattformabhängiger Dateisystem Watcher.

## Fehler und Determinismus

Interne Indexfehler werden mit ihren vollständigen Pfaden serverseitig geloggt. REST und MCP erhalten nur `Search index unavailable.` und geben keine lokalen Verzeichnisstrukturen preis.

Markdown Dateien werden vor der Indexierung sortiert. Finale Suchergebnisse verwenden bei identischen Scores den Dateipfad als Tie Breaker, sodass dieselben Vault Daten auf allen Plattformen dieselbe Reihenfolge liefern.

## Tests

Jede Änderung beginnt mit einem fehlschlagenden Regressionstest. Abgedeckt werden gleichnamige Datei und Section, gemischte exakte und vertippte Query Terme, gedrosselte manifestlose Cache Prüfung, redigierte öffentliche Fehler und stabile Trefferreihenfolge. Danach laufen die fokussierten Tests und die vollständige Suite.
