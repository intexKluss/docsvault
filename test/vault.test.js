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
      'api/DocFile.md': '---\ntitle: DocFile\nsource: https://example.com\n---\n# DocFile\n\nEine Klasse fuer Dateien. Hat function upload() method.',
      'api/Interface.md': '# Interface\n\nJede Klasse hat Methoden und function-Definitionen.',
      'howtos/upload.md': '# Upload\n\nSo laedst du etwas hoch. function upload() benutzen.',
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
