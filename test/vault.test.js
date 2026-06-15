import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  getSections, listFiles, readDoc, searchDocs, getManifest, parseRipgrepJson,
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
      // umlaut-doc für folding-test: Titel und Body mit echtem ü
      'api/Uebersicht.md': '---\ntitle: Übersicht\n---\n# Übersicht\n\nDiese Seite ist eine Übersicht ueber alles.',
      // kanonische API-Klasse, soll bei "context getDocument" trotz vieler
      // example-pages nach vorne kommen (rank-before-slice)
      'Scripting/PortalscriptAPI/classes/context.md': '---\ntitle: context\n---\n# context\n\nDie Klasse context stellt getDocument bereit.\n\n## getDocument\n\ncontext.getDocument() liefert das aktuelle Dokument.',
      // frontmatter-only titleMatch: title enthält den Begriff, Body sonst nichts
      'api/FrontOnly.md': '---\ntitle: SonderBegriffXyz\n---\n# Heading One\n\nIrgendein Fließtext ohne den Begriff im Body.',
      // viele example-pages die context erwähnen, damit context.md sonst untergeht
      'examples/ex01.md': '# Example 1\n\nNutzt context irgendwo.',
      'examples/ex02.md': '# Example 2\n\nNutzt context irgendwo.',
      'examples/ex03.md': '# Example 3\n\nNutzt context irgendwo.',
      'examples/ex04.md': '# Example 4\n\nNutzt context irgendwo.',
      'examples/ex05.md': '# Example 5\n\nNutzt context irgendwo.',
      // doc für per-file-cap: viele Treffer derselben Datei
      'api/Many.md': '# Many\n\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken\ntoken',
      // doc für heading-targeting in readDoc
      'guides/Sections.md': '---\ntitle: Sections\n---\n# Sections\n\nIntro text.\n\n## Alpha\n\nAlpha body line.\n\n### Sub\n\nSub body.\n\n## Beta\n\nBeta body line.',
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
      const doc = readDoc(VAULT_PATH, 'guides/Sections', 10);
      if (doc && doc.content.length > 10) {
        assert.equal(doc.truncated, true);
      }
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

    // Punkt 12: maxLength wird geclampt (0 -> min 1, kein crash)
    it('clamps maxLength defensively', () => {
      const doc = readDoc(VAULT_PATH, 'guides/Sections', 0);
      assert.ok(doc);
      assert.equal(doc.truncated, true);
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
      const results = searchDocs(VAULT_PATH, 'DocFile');
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
      const results = searchDocs(VAULT_PATH, 'upload');
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
      const results = searchDocs(VAULT_PATH, 'Interface');
      assert.ok(results.length > 0);
      assert.equal(results[0].file, 'api/Interface');
      assert.equal(results[0].titleMatch, true);
    });

    it('sets titleMatch flag on every result', () => {
      const results = searchDocs(VAULT_PATH, 'function');
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
      const results = searchDocs(VAULT_PATH, 'carriage');
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

    // bestehendes Schema bleibt erhalten (file, title, matches[{line,text,heading}])
    it('keeps the existing result schema intact', () => {
      const results = searchDocs(VAULT_PATH, 'function');
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

    // Punkt 3: rank-before-slice - kanonische Seite überlebt trotz vieler examples
    it('surfaces the canonical title page even with many example hits', () => {
      const results = searchDocs(VAULT_PATH, 'context', { maxResults: 3 });
      const ctx = results.find(r => r.file === 'Scripting/PortalscriptAPI/classes/context');
      assert.ok(ctx, 'die kanonische context-Klasse muss in den top results sein');
      assert.equal(ctx.titleMatch, true);
    });

    // Punkt 4: per-file cap - keine Datei flutet die Antwort
    it('caps matches per file and drops blank lines', () => {
      const results = searchDocs(VAULT_PATH, 'token');
      const many = results.find(r => r.file === 'api/Many');
      assert.ok(many);
      assert.ok(many.matches.length <= 10, `per-file cap verletzt: ${many.matches.length}`);
      for (const m of many.matches) {
        assert.notEqual(m.text.trim(), '', 'leere zeile durchgerutscht');
      }
    });

    // Punkt 5: context_lines wird auch für multi-token honoriert
    it('honors context_lines for multi-token queries', () => {
      const results = searchDocs(VAULT_PATH, 'Methoden upload', { contextLines: 2 });
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

    // Punkt 11: frontmatter-only titleMatch bekommt synthetischen snippet
    it('synthesizes a snippet for frontmatter-only title matches', () => {
      const results = searchDocs(VAULT_PATH, 'SonderBegriffXyz');
      const front = results.find(r => r.file === 'api/FrontOnly');
      assert.ok(front, 'titleMatch-datei darf nicht gedroppt werden');
      assert.ok(front.matches.length > 0, 'kein leerer snippet');
      for (const m of front.matches) {
        assert.notEqual(m.text.trim(), '');
      }
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
  });

  // Punkt 1: CRLF rg --json parsing
  describe('parseRipgrepJson', () => {
    it('parses rg --json match events with CRLF lines verbatim', () => {
      const abs = join(VAULT_PATH, 'api', 'Crlf.md');
      const stream = [
        JSON.stringify({ type: 'begin', data: { path: { text: abs } } }),
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: abs },
            lines: { text: 'Diese Seite nutzt carriage returns überall.\r\n' },
            line_number: 7,
          },
        }),
        JSON.stringify({ type: 'end', data: { path: { text: abs } } }),
      ].join('\n');

      const parsed = parseRipgrepJson(VAULT_PATH, stream, 10);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].file, 'api/Crlf');
      assert.equal(parsed[0].matches.length, 1);
      assert.equal(parsed[0].matches[0].line, 7);
      // kein trailing CR oder LF mehr
      assert.ok(!parsed[0].matches[0].text.endsWith('\r'));
      assert.ok(!parsed[0].matches[0].text.endsWith('\n'));
      assert.match(parsed[0].matches[0].text, /carriage returns überall/);
    });

    it('stops collecting after maxResults distinct files', () => {
      const lines = [];
      for (let i = 0; i < 10; i++) {
        const abs = join(VAULT_PATH, 'examples', `ex0${i}.md`);
        lines.push(JSON.stringify({
          type: 'match',
          data: { path: { text: abs }, lines: { text: 'x\n' }, line_number: 1 },
        }));
      }
      const parsed = parseRipgrepJson(VAULT_PATH, lines.join('\n'), 3);
      assert.equal(parsed.length, 3);
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
