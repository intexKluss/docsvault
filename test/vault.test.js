import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { getSections, listFiles, readDoc, searchDocs, getManifest } from '../src/tools/vault.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

// fixture-vault zur laufzeit erzeugen - vault-content liegt nicht mehr im repo
const { root, cleanup } = createTempVaultsRoot({
  'otris': {
    meta: { toolPrefix: 'otris' },
    files: {
      'api/DocFile.md': '---\ntitle: DocFile\nsource: https://example.com\n---\n# DocFile\n\n## Methoden\n\nEine Klasse fuer Dateien. Hat function upload() method.',
      'api/Interface.md': '# Interface\n\nJede Klasse hat Methoden und function-Definitionen.',
      'howtos/upload.md': '# Upload\n\nSo laedst du etwas hoch. function upload() benutzen.',
      // CRLF + frontmatter mit title das den Suchbegriff enthaelt
      'api/Crlf.md': '---\r\ntitle: CrlfPage\r\nsource: https://example.com\r\n---\r\n# CrlfPage\r\n\r\nDiese Seite nutzt carriage returns ueberall.\r\n',
      // crawler-code, darf NICHT als section/treffer auftauchen
      'crawl/crawler.md': '# crawler internals\n\nfunction crawl() laeuft hier.',
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
      const doc = readDoc(VAULT_PATH, 'nonexistent/doc');
      assert.equal(doc, null);
    });

    it('blocks path traversal', () => {
      const doc = readDoc(VAULT_PATH, '../../package');
      assert.equal(doc, null);
    });

    it('truncates content when maxLength exceeded', () => {
      const sections = getSections(VAULT_PATH);
      if (sections.length === 0) return;
      const files = listFiles(VAULT_PATH, sections[0]);
      if (files.length === 0) return;
      const doc = readDoc(VAULT_PATH, files[0].path, 10);
      if (doc && doc.content.length > 10) {
        assert.equal(doc.truncated, true);
      }
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

    // Punkt 1: Frontmatter-Zeilen (---/title/source) duerfen keine Treffer sein
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

    // Punkt 2: jeder Treffer traegt die naechste vorausgehende Ueberschrift
    it('attaches the nearest preceding heading to each match', () => {
      const results = searchDocs(VAULT_PATH, 'upload');
      assert.ok(results.length > 0);
      for (const r of results) {
        for (const m of r.matches) {
          assert.ok('heading' in m, 'match braucht ein heading-Feld');
          assert.equal(typeof m.heading, 'string');
        }
      }
      // function upload() steht unter "## Methoden" in DocFile
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

    // bestehendes Schema bleibt erhalten (file, title, matches[{line,text}])
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
  });

  describe('getManifest', () => {
    it('returns manifest object or null', () => {
      const manifest = getManifest(VAULT_PATH);
      // manifest may or may not exist
      if (manifest) {
        assert.ok(typeof manifest === 'object');
      }
    });
  });
});
