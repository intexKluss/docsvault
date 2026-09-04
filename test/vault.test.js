import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  getSections, listFiles, readDoc, searchDocs, getManifest,
} from '../src/tools/vault.js';
import { handleSearch } from '../src/tools/search.js';
import { handleList } from '../src/tools/list.js';
import { handleRead } from '../src/tools/read.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

// fixture-vault zur laufzeit erzeugen - vault-content liegt nicht mehr im repo
const { root, cleanup } = createTempVaultsRoot({
  'otris': {
    meta: { toolPrefix: 'otris' },
    files: {
      'api/DocFile.md': '---\ntitle: DocFile\nsource: https://example.com\n---\n# DocFile\n\n## Methoden\n\nEine Klasse für Dateien. Hat function upload() method.',
      'api/Interface.md': '# Interface\n\nJede Klasse hat Methoden und function-Definitionen.',
      'howtos/upload.md': '# Upload\n\nSo lädst du etwas hoch. function upload() benutzen.',
      // CRLF + frontmatter mit title das den Suchbegriff enthält
      'api/Crlf.md': '---\r\ntitle: CrlfPage\r\nsource: https://example.com\r\n---\r\n# CrlfPage\r\n\r\nDiese Seite nutzt carriage returns überall.\r\n',
      // crawler-code, darf NICHT als section/treffer auftauchen
      'crawl/crawler.md': '# crawler internals\n\nfunction crawl() läuft hier.',
      'otris-teras-build/output/HTML.md': '# interne TERAS Build-Datei\n\nappendHtml internals.',
      // umlaut-doc für folding-test: Titel und Body mit echtem ü
      'api/Uebersicht.md': '---\ntitle: Übersicht\n---\n# Übersicht\n\nDiese Seite ist eine Übersicht ueber alles.',
      // kanonische API-Klasse, soll bei "context getDocument" trotz vieler
      // example-pages nach vorne kommen (rank-before-slice)
      'Scripting/PortalscriptAPI/classes/context.md': '---\ntitle: context\n---\n# context\n\nDie Klasse context stellt getDocument bereit.\n\n## getDocument\n\ncontext.getDocument() liefert das aktuelle Dokument.',
      'Scripting/TERAS API/Gadget API/HTML.md': '# HTML\n\nappendHtml(newHtml: string): void',
      // frontmatter-only titleMatch: title enthält den Begriff, Body sonst nichts
      'api/FrontOnly.md': '---\ntitle: SonderBegriffXyz\n---\n# Heading One\n\nIrgendein Fließtext ohne den Begriff im Body.',
      // Die häufigen Tokens machen den IDF-Regressionsfall realistisch.
      'examples/ex01.md': '# Example 1\n\nNutzt context irgendwo. Am Mappentyp wird die Eigenschaft gesetzt.',
      'examples/ex02.md': '# Example 2\n\nNutzt context irgendwo. Am Mappentyp wird die Eigenschaft gesetzt.',
      'examples/ex03.md': '# Example 3\n\nNutzt context irgendwo. Am Mappentyp wird die Eigenschaft gesetzt.',
      'examples/ex04.md': '# Example 4\n\nNutzt context irgendwo. Am Mappentyp wird die Eigenschaft gesetzt.',
      'examples/ex05.md': '# Example 5\n\nNutzt context irgendwo. Am Mappentyp wird die Eigenschaft gesetzt.',
      // doc für per-file-cap: viele Treffer derselben Datei
      'api/Many.md': '# Many\n\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken',
      // doc für heading-targeting in readDoc
      'guides/Sections.md': '---\ntitle: Sections\n---\n# Sections\n\nIntro text.\n\n## Alpha\n\nAlpha body line.\n\n### Sub\n\nSub body.\n\n## Beta\n\nBeta body line.',
      'Properties/DlcFile.md': '---\ntitle: "Properties: DlcFile"\n---\n# Properties: DlcFile\n\nEigenschaften am Mappentyp.\n\n## enableAlpha\n\n- **Typ:** enum\n\nSchaltet Alpha ein.\n\n## hasInvoicePlugin\n\n- **Objekte:** DlcFile\n- **Typ:** enum\n\nDas Invoice Plugin kann hiermit aktiviert werden.\n\n## zetaMode\n\n- **Typ:** string\n\nSteuert Zeta.',
      'Handbuch/Mappentyp Konfiguration.md': '# Mappentyp Konfiguration\n\n## Eigenschaft setzen\n\nJeder Mappentyp hat Eigenschaften. Die Eigenschaft wird am Mappentyp gepflegt. Eigenschaft und Mappentyp gehören zusammen.\n\n## Weitere Eigenschaft\n\nNoch eine Eigenschaft am Mappentyp.',
      'Handbuch/Eigenschaften und Felder.md': '# Eigenschaften und Felder\n\n## Eigenschaft am Mappentyp\n\nEine Eigenschaft am Mappentyp steuert das Verhalten. Mappentyp, Eigenschaft, Eigenschaft, Mappentyp.',
      'HowTos/Mappentyp Eigenschaft pflegen.md': '# Mappentyp Eigenschaft pflegen\n\n## Eigenschaft anlegen\n\nSo legst du eine Eigenschaft an einem Mappentyp an. Mappentyp Eigenschaft Mappentyp Eigenschaft.',
      'guides/Many Sections.md': '---\ntitle: Many Sections\n---\n# Many Sections\n\nIntro der Seite mit reichlich Text damit das Intro nicht leer ist.\n\n## Ein\n\nInhalt eins mit genug Text um das Limit zu sprengen.\n\n## Zwei\n\nInhalt zwei mit genug Text um das Limit zu sprengen.\n\n## Drei\n\nInhalt drei mit genug Text um das Limit zu sprengen.\n\n## Vier\n\nInhalt vier mit genug Text um das Limit zu sprengen.\n\n## Fünf\n\nInhalt fünf mit genug Text um das Limit zu sprengen.\n\n## Sechs\n\nInhalt sechs mit genug Text um das Limit zu sprengen.',
      'guides/Long Flat.md': '---\ntitle: Long Flat\n---\n# Long Flat\n\n' + 'Fliesstext der einfach immer weiter geht und geht. '.repeat(20) + '\n\n## Hinten\n\nDer hintere Abschnitt.',
      'budget/very-long-path-name-that-must-remain-verbatim-in-search-results.md': '---\ntitle: Ein außergewöhnlich langer Dokumenttitel der das kleine Antwortbudget deutlich übersteigt\n---\n# Budget\n\n## Eine außergewöhnlich lange Überschrift die nicht abgeschnitten werden darf\n\nBudgetMarker',
      'guides/Very Long Navigation.md': '# Navigation\n\nIntro.\n\n## Eine außergewöhnlich lange Überschrift für das enge Antwortbudget Nummer eins\n\nText.\n\n## Eine außergewöhnlich lange Überschrift für das enge Antwortbudget Nummer zwei\n\nText.\n\n## Eine außergewöhnlich lange Überschrift für das enge Antwortbudget Nummer drei\n\nText.\n\n## Eine außergewöhnlich lange Überschrift für das enge Antwortbudget Nummer vier\n\nText.\n\n## Eine außergewöhnlich lange Überschrift für das enge Antwortbudget Nummer fünf\n\nText.',
    },
  },
});
const VAULT_PATH = join(root, 'otris');
after(cleanup);

describe('Vault', () => {
  describe('getSections', () => {
    it('returns array of section names', () => {
      const sections = getSections(VAULT_PATH);
      assert.ok(Array.isArray(sections));
      assert.ok(sections.length > 0);
    });

    it('excludes dotfiles and underscore-prefixed', () => {
      const sections = getSections(VAULT_PATH);
      for (const s of sections) {
        assert.ok(!s.startsWith('.'));
        assert.ok(!s.startsWith('_'));
      }
    });

    it('returns empty array for nonexistent path', () => {
      const sections = getSections('/nonexistent/path');
      assert.deepEqual(sections, []);
    });

    it('excludes crawl and node_modules dirs', () => {
      const sections = getSections(VAULT_PATH);
      assert.ok(!sections.includes('crawl'));
      assert.ok(!sections.includes('node_modules'));
      assert.ok(!sections.includes('otris-teras-build'));
    });
  });

  describe('listFiles', () => {
    it('returns files for a valid section', () => {
      const sections = getSections(VAULT_PATH);
      if (sections.length === 0) return;
      const files = listFiles(VAULT_PATH, sections[0]);
      assert.ok(Array.isArray(files));
      for (const f of files) {
        assert.ok(f.name);
        assert.ok(f.path);
        assert.ok(!f.path.endsWith('.md'));
      }
    });

    it('returns empty for nonexistent section', () => {
      const files = listFiles(VAULT_PATH, 'nonexistent-section');
      assert.deepEqual(files, []);
    });

    it('blocks path traversal', () => {
      const files = listFiles(VAULT_PATH, '..', 'src');
      assert.deepEqual(files, []);
    });
  });

  describe('readDoc', () => {
    it('reads a document and parses frontmatter', () => {
      const sections = getSections(VAULT_PATH);
      if (sections.length === 0) return;
      const files = listFiles(VAULT_PATH, sections[0]);
      if (files.length === 0) return;
      const doc = readDoc(VAULT_PATH, files[0].path);
      assert.ok(doc);
      assert.ok('title' in doc);
      assert.ok('content' in doc);
      assert.ok('truncated' in doc);
    });

    it('returns null for nonexistent doc', () => {
      const doc = readDoc(VAULT_PATH, 'nonexistent/doc-that-matches-nothing-zzz');
      assert.equal(doc, null);
    });

    it('blocks path traversal', () => {
      const doc = readDoc(VAULT_PATH, '../../package');
      assert.equal(doc, null);
    });

    it('truncates content when maxLength exceeded', () => {
      var doc = readDoc(VAULT_PATH, 'guides/Long Flat', 300);
      assert.ok(doc.content.length < 1000);
      assert.equal(doc.truncated, true);
    });

    // Punkt 17: heading-targeting gibt nur den passenden Abschnitt zurück
    it('returns only the requested heading section', () => {
      const doc = readDoc(VAULT_PATH, 'guides/Sections', 50000, { heading: 'Alpha' });
      assert.ok(doc);
      assert.match(doc.content, /## Alpha/);
      assert.match(doc.content, /Alpha body line/);
      // Sub gehört noch zu Alpha (tieferes Level)
      assert.match(doc.content, /Sub body/);
      // Beta ist eine eigene H2 -> nicht enthalten
      assert.doesNotMatch(doc.content, /Beta body line/);
      // Intro vor Alpha ist nicht enthalten
      assert.doesNotMatch(doc.content, /Intro text/);
    });

    // Punkt 17: self-healing über basename wenn exakter pfad fehlt
    it('self-heals a wrong path via basename match', () => {
      const doc = readDoc(VAULT_PATH, 'wrongdir/DocFile');
      assert.ok(doc);
      assert.equal(doc.title, 'DocFile');
    });

    it('clamps maxLength defensively', () => {
      const doc = readDoc(VAULT_PATH, 'guides/Sections', 0);
      assert.ok(doc);
      assert.ok(doc.content.length > 0);
      var huge = readDoc(VAULT_PATH, 'guides/Long Flat', 999999);
      assert.ok(huge.content.length <= 25000);
    });
  });

  describe('searchDocs', () => {
    it('returns results for a common term', () => {
      const results = searchDocs(VAULT_PATH, 'function');
      assert.ok(Array.isArray(results));
    });

    it('returns empty for nonsense query', () => {
      const results = searchDocs(VAULT_PATH, 'xyzzy_impossible_term_42');
      assert.deepEqual(results, []);
    });

    it('respects maxResults', () => {
      const results = searchDocs(VAULT_PATH, 'function', { maxResults: 2 });
      assert.ok(results.length <= 2);
    });

    it('blocks path traversal in section', () => {
      const results = searchDocs(VAULT_PATH, 'test', { section: '../../src' });
      assert.deepEqual(results, []);
    });

    // Punkt 1: Frontmatter-Zeilen (---/title/source) dürfen keine Treffer sein
    it('does not return matches inside the frontmatter block', () => {
      var results = searchDocs(VAULT_PATH, 'DocFile', { detailed: true });
      const doc = results.find(r => r.file === 'api/DocFile');
      assert.ok(doc, 'DocFile sollte gefunden werden (Titel im Heading)');
      for (const m of doc.matches) {
        assert.notEqual(m.text.trim(), '---');
        assert.ok(!/^title\s*:/.test(m.text.trim()), `frontmatter title leaked: ${m.text}`);
        assert.ok(!/^source\s*:/.test(m.text.trim()), `frontmatter source leaked: ${m.text}`);
      }
    });

    // Punkt 2: jeder Treffer trägt die nächste vorausgehende Überschrift
    it('attaches the nearest preceding heading to each match', () => {
      var results = searchDocs(VAULT_PATH, 'upload', { detailed: true });
      assert.ok(results.length > 0);
      for (const r of results) {
        for (const m of r.matches) {
          assert.ok('heading' in m, 'match braucht ein heading-Feld');
          assert.equal(typeof m.heading, 'string');
        }
      }
      const doc = results.find(r => r.file === 'api/DocFile');
      if (doc) {
        const um = doc.matches.find(m => /upload/i.test(m.text));
        if (um) assert.equal(um.heading, 'Methoden');
      }
    });

    // Punkt 3: Titel-/Pfad-Treffer kommen zuerst und sind markiert
    it('ranks title/path matches first with titleMatch flag', () => {
      var results = searchDocs(VAULT_PATH, 'Interface', { detailed: true });
      assert.ok(results.length > 0);
      assert.equal(results[0].file, 'api/Interface');
      assert.equal(results[0].titleMatch, true);
    });

    it('sets titleMatch flag on every detailed result', () => {
      var results = searchDocs(VAULT_PATH, 'function', { detailed: true });
      for (const r of results) {
        assert.ok('titleMatch' in r);
        assert.equal(typeof r.titleMatch, 'boolean');
      }
    });

    // Punkt 10: numerischer score additiv vorhanden
    it('exposes a numeric score on each result', () => {
      const results = searchDocs(VAULT_PATH, 'function');
      assert.ok(results.length > 0);
      for (const r of results) {
        assert.equal(typeof r.score, 'number');
      }
    });

    // Punkt 5: trailing \r wird aus dem Treffer-Text gestrippt
    it('strips trailing carriage returns from match text', () => {
      var results = searchDocs(VAULT_PATH, 'carriage', { detailed: true });
      assert.ok(results.length > 0);
      for (const r of results) {
        for (const m of r.matches) {
          assert.ok(!m.text.endsWith('\r'), `CR leaked: ${JSON.stringify(m.text)}`);
        }
      }
    });

    // Punkt 4: crawl-Ordner liefert keine Treffer
    it('does not search inside the crawl directory', () => {
      const results = searchDocs(VAULT_PATH, 'internals');
      assert.ok(!results.some(r => r.file.startsWith('crawl/')));
    });

    it('keeps the legacy result schema intact in detailed mode', () => {
      var results = searchDocs(VAULT_PATH, 'function', { detailed: true });
      assert.ok(results.length > 0);
      for (const r of results) {
        assert.ok('file' in r);
        assert.ok('title' in r);
        assert.ok(Array.isArray(r.matches));
        for (const m of r.matches) {
          assert.ok('line' in m);
          assert.ok('text' in m);
          assert.equal(typeof m.line, 'number');
        }
      }
    });

    it('returns the compact shape by default', () => {
      var results = searchDocs(VAULT_PATH, 'function');
      assert.ok(results.length > 0);
      for (var resultIndex = 0; resultIndex < results.length; resultIndex++) {
        assert.ok('file' in results[resultIndex]);
        assert.ok('title' in results[resultIndex]);
        assert.ok(Array.isArray(results[resultIndex].headings), 'headings fehlt');
        assert.equal(typeof results[resultIndex].snippet, 'string');
        assert.ok(!('matches' in results[resultIndex]), 'concise darf keine matches enthalten');
      }
    });

    it('defaults to five results', () => {
      var results = searchDocs(VAULT_PATH, 'function');
      assert.ok(results.length <= 5);
    });

    it('never uses bare code fences or blank lines as snippet', () => {
      var results = searchDocs(VAULT_PATH, 'function');
      for (var resultIndex = 0; resultIndex < results.length; resultIndex++) {
        var lines = results[resultIndex].snippet.split('\n');
        for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          assert.notEqual(lines[lineIndex].trim(), '');
          assert.ok(!/^`{3,}$/.test(lines[lineIndex].trim()), `code fence als snippet: ${results[resultIndex].file}`);
        }
      }
    });

    // Punkt 3: rank-before-slice - kanonische Seite überlebt trotz vieler examples
    it('surfaces the canonical title page even with many example hits', () => {
      var results = searchDocs(VAULT_PATH, 'context', { maxResults: 3, detailed: true });
      const ctx = results.find(r => r.file === 'Scripting/PortalscriptAPI/classes/context');
      assert.ok(ctx, 'die kanonische context-Klasse muss in den top results sein');
      assert.equal(ctx.titleMatch, true);
    });

    // Punkt 4: per-file cap - keine Datei flutet die Antwort
    it('caps matches per file and drops blank lines', () => {
      var results = searchDocs(VAULT_PATH, 'token', { detailed: true });
      const many = results.find(r => r.file === 'api/Many');
      assert.ok(many);
      assert.ok(many.matches.length <= 10, `per-file cap verletzt: ${many.matches.length}`);
      for (const m of many.matches) {
        assert.notEqual(m.text.trim(), '', 'leere zeile durchgerutscht');
      }
    });

    // Punkt 5: context_lines wird auch für multi-token honoriert
    it('honors context_lines for multi-token queries', () => {
      var results = searchDocs(VAULT_PATH, 'Methoden upload', { contextLines: 2, detailed: true });
      const doc = results.find(r => r.file === 'api/DocFile');
      assert.ok(doc);
      // bei context 2 muss es mehr als nur die reinen treffer-zeilen geben
      assert.ok(doc.matches.length >= 2, 'multi-token ohne kontext zurückgegeben');
    });

    // Punkt 7: umlaut-folding - ae-query findet ä-doc
    it('folds umlauts so ascii query finds umlaut doc', () => {
      const results = searchDocs(VAULT_PATH, 'uebersicht');
      assert.ok(results.some(r => r.file === 'api/Uebersicht'), 'ue sollte ü matchen');
    });

    it('folds umlauts in the other direction too', () => {
      const results = searchDocs(VAULT_PATH, 'Übersicht');
      assert.ok(results.some(r => r.file === 'api/Uebersicht'));
    });

    it('still returns a snippet when only the title matches', () => {
      const results = searchDocs(VAULT_PATH, 'SonderBegriffXyz');
      const front = results.find(r => r.file === 'api/FrontOnly');
      assert.ok(front, 'titel-treffer darf nicht gedroppt werden');
      assert.notEqual(front.snippet.trim(), '', 'kein leerer snippet');
    });

    // Punkt 8: dotted API name wird tokenisiert
    it('tokenizes dotted api names', () => {
      const results = searchDocs(VAULT_PATH, 'context.getDocument');
      const ctx = results.find(r => r.file === 'Scripting/PortalscriptAPI/classes/context');
      assert.ok(ctx, 'context.getDocument muss die context-klasse finden');
    });

    // Punkt 12: defensive clamp maxResults
    it('clamps maxResults defensively', () => {
      const results = searchDocs(VAULT_PATH, 'context', { maxResults: 9999 });
      assert.ok(results.length <= 100);
    });

    it('honors max_tokens as a hard budget', () => {
      var budget = 60;
      var results = searchDocs(VAULT_PATH, 'function', { maxResults: 5, maxTokens: budget });
      assert.ok(results.length >= 1, 'budget darf nicht alles wegschneiden');
      assert.ok(
        JSON.stringify(results).length <= budget * 4,
        `budget verletzt: ${JSON.stringify(results).length} > ${budget * 4}`
      );
    });

    it('returns no result when a long path and heading cannot fit the exact budget', () => {
      var budget = 50;
      var full = searchDocs(VAULT_PATH, 'BudgetMarker');
      var results = searchDocs(VAULT_PATH, 'BudgetMarker', { maxTokens: budget });
      assert.equal(full.length, 1);
      assert.match(full[0].file, /very-long-path-name/);
      assert.match(full[0].headings[0], /außergewöhnlich lange Überschrift/i);
      assert.deepEqual(results, []);
      assert.ok(JSON.stringify(results).length <= budget * 4);
    });
  });

  describe('searchDocs BM25 ranking', () => {
    it('finds the canonical page for a rare single token', () => {
      var results = searchDocs(VAULT_PATH, 'hasInvoicePlugin');
      assert.equal(results[0].file, 'Properties/DlcFile');
    });

    it('lets the rare token win over frequent tokens (hasInvoicePlugin case)', () => {
      var results = searchDocs(VAULT_PATH, 'Mappentyp Eigenschaft hasInvoicePlugin');
      var resultFiles = '';
      for (var resultIndex = 0; resultIndex < results.length; resultIndex++) {
        if (resultFiles) resultFiles += ', ';
        resultFiles += results[resultIndex].file;
      }
      assert.equal(
        results[0].file,
        'Properties/DlcFile',
        `falsches Top-Ergebnis: ${resultFiles}`
      );
    });

    it('reports the matched heading so a follow-up read can target it', () => {
      var results = searchDocs(VAULT_PATH, 'Mappentyp Eigenschaft hasInvoicePlugin');
      assert.equal(results[0].headings[0], 'hasInvoicePlugin');
      var doc = readDoc(VAULT_PATH, results[0].file, 8000, { heading: results[0].headings[0] });
      assert.equal(doc.mode, 'heading');
      assert.match(doc.content, /Invoice Plugin/);
    });

    it('keeps the section scope', () => {
      var results = searchDocs(VAULT_PATH, 'Eigenschaft', { section: 'Properties' });
      assert.ok(results.length > 0);
      for (var resultIndex = 0; resultIndex < results.length; resultIndex++) {
        assert.ok(results[resultIndex].file.startsWith('Properties/'), `außerhalb der section: ${results[resultIndex].file}`);
      }
    });

    it('falls back to fuzzy matching only when the exact search finds nothing', () => {
      var typo = searchDocs(VAULT_PATH, 'hasInvoicePlugn');
      assert.ok(typo.length > 0, 'tippfehler sollte gerettet werden');
      assert.equal(typo[0].file, 'Properties/DlcFile');
    });

    it('scores results in descending order', () => {
      var results = searchDocs(VAULT_PATH, 'Mappentyp Eigenschaft');
      for (var resultIndex = 1; resultIndex < results.length; resultIndex++) {
        assert.ok(results[resultIndex - 1].score >= results[resultIndex].score);
      }
    });
  });

  describe('readDoc truncation and table of contents', () => {
    it('returns the full body when it fits the budget', () => {
      var doc = readDoc(VAULT_PATH, 'guides/Sections');
      assert.equal(doc.mode, 'full');
      assert.equal(doc.truncated, false);
      assert.match(doc.content, /Beta body line/);
    });

    it('returns only the requested section with heading', () => {
      var doc = readDoc(VAULT_PATH, 'guides/Sections', 8000, { heading: 'Beta' });
      assert.equal(doc.mode, 'heading');
      assert.match(doc.content, /Beta body line/);
      assert.ok(!/Alpha body line/.test(doc.content));
    });

    it('folds umlauts when matching a heading', () => {
      var doc = readDoc(VAULT_PATH, 'api/Uebersicht', 8000, { heading: 'Uebersicht' });
      assert.ok(doc);
    });

    it('offers the table of contents instead of the raw page for an unknown heading', () => {
      var doc = readDoc(VAULT_PATH, 'guides/Many Sections', 8000, { heading: 'GibtEsNicht' });
      assert.equal(doc.mode, 'heading-not-found');
      assert.ok(!/Inhalt eins/.test(doc.content), 'darf nicht den Seiteninhalt dumpen');
      assert.match(doc.content, /Ein \| Zwei \| Drei/);
      assert.match(doc.content, /heading=/);
    });

    it('returns intro plus toc for a long page with many sections', () => {
      var doc = readDoc(VAULT_PATH, 'guides/Many Sections', 200);
      assert.equal(doc.mode, 'toc');
      assert.equal(doc.truncated, true);
      assert.match(doc.content, /Abschnitte \(6\)/);
      assert.match(doc.content, /Ein \| Zwei \| Drei \| Vier \| Fünf \| Sechs/);
      assert.match(doc.content, /heading=/);
      assert.ok(!/Inhalt sechs/.test(doc.content), 'TOC-Modus darf keine Abschnittsinhalte enthalten');
    });

    it('lists the remaining headings when a flat page is cut off', () => {
      var doc = readDoc(VAULT_PATH, 'guides/Long Flat', 300);
      assert.equal(doc.mode, 'truncated');
      assert.equal(doc.truncated, true);
      assert.match(doc.content, /Hinten/);
      assert.match(doc.content, /heading=/);
    });

    it('honors max_tokens as a read budget', () => {
      var doc = readDoc(VAULT_PATH, 'guides/Long Flat', 8000, { maxTokens: 100 });
      assert.ok(doc.content.length <= 100 * 4 + 600, `budget verletzt: ${doc.content.length}`);
    });

    it('caps the table of contents by the budget too', () => {
      var wide = readDoc(VAULT_PATH, 'guides/Many Sections', 800);
      var tight = readDoc(VAULT_PATH, 'guides/Many Sections', 200);
      assert.ok(tight.content.length < wide.content.length, 'kleineres budget muss kürzer sein');
      assert.match(tight.content, /Abschnitte \(6\)/);
    });

    it('keeps long navigation content within the exact read budget', () => {
      var budget = 50;
      var doc = readDoc(VAULT_PATH, 'guides/Very Long Navigation', 8000, { maxTokens: budget });
      assert.ok(doc.content.length <= budget * 4, `budget verletzt: ${doc.content.length} > ${budget * 4}`);
    });
  });

  describe('handleSearch / handleList bad-section signal', () => {
    // Punkt 13: unbekannte section -> error-signal, nicht []
    it('returns an error for an unknown section in search', () => {
      const res = handleSearch(VAULT_PATH, { query: 'function', section: 'nope-not-a-section' });
      assert.ok(res && res.error, 'unbekannte section sollte ein error-objekt liefern');
    });

    it('returns an array for a known section in search', () => {
      const res = handleSearch(VAULT_PATH, { query: 'function', section: 'api' });
      assert.ok(Array.isArray(res));
    });

    it('accepts a nested technical section in search', () => {
      var res = handleSearch(VAULT_PATH, { query: 'appendHtml', section: 'Scripting/TERAS API' });
      assert.ok(Array.isArray(res));
      assert.equal(res[0].file, 'Scripting/TERAS API/Gadget API/HTML');
    });

    it('rejects a non-canonical nested section path', () => {
      var res = handleSearch(VAULT_PATH, { query: 'appendHtml', section: 'Scripting/../Scripting/TERAS API' });
      assert.ok(res && res.error, 'non-canonical section must return an error');
    });

    it('returns an index error for a file used as the vault path', () => {
      var res = handleSearch(join(VAULT_PATH, 'api', 'DocFile.md'), { query: 'function' });
      assert.equal(res.error, 'Search index unavailable: Vault path is not a directory');
    });

    it('returns an index error before validating a section on an invalid vault path', () => {
      var res = handleSearch(join(VAULT_PATH, 'api', 'DocFile.md'), { query: 'function', section: 'api' });
      assert.equal(res.error, 'Search index unavailable: Vault path is not a directory');
    });

    it('returns an error for an unknown section in list', () => {
      const res = handleList(VAULT_PATH, { section: 'nope-not-a-section' });
      assert.ok(res && res.error);
    });

    it('returns an array for a known section in list', () => {
      const res = handleList(VAULT_PATH, { section: 'api' });
      assert.ok(Array.isArray(res));
    });
  });

  describe('handleRead self-healing', () => {
    // Punkt 17: exakter pfad heilt über den index
    it('heals a wrong path to the right document', () => {
      const res = handleRead(VAULT_PATH, { path: 'totally/wrong/DocFile' });
      assert.ok(!res.error, `sollte heilen, nicht erroren: ${JSON.stringify(res)}`);
      assert.equal(res.title, 'DocFile');
    });

    it('returns a not-found error for a truly missing doc', () => {
      const res = handleRead(VAULT_PATH, { path: 'no-such-thing-zzz-qqq' });
      assert.ok(res.error);
    });
  });

  describe('getManifest', () => {
    it('returns manifest object or null', () => {
      const manifest = getManifest(VAULT_PATH);
      if (manifest) {
        assert.ok(typeof manifest === 'object');
      }
    });
  });
});
