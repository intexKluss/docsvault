import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTempVaultsRoot } from './helpers/temp-vault.js';
import { loadVaultRegistry, TOOL_SUFFIXES } from '../src/vault-registry.js';
import { createMcpServer } from '../src/mcp-handler.js';
import { handleSearch } from '../src/tools/search.js';

describe('Multi-vault integration', () => {
  const { root, cleanup } = createTempVaultsRoot({
    'otris': {
      meta: { name: 'otris', toolPrefix: 'otris', description: 'otris Doku' },
      files: {
        'api/DocFile.md': '# DocFile\n\nDas ist eine otris-API-Klasse zur Dateiverwaltung.',
        'howtos/upload.md': '# Upload\n\nSo laedst du Dateien hoch.',
      },
    },
    'intex-regeln': {
      meta: { name: 'Intex Regeln', toolPrefix: 'intex_regeln', description: 'Firmenregeln' },
      files: {
        'regeln/commits.md': '# Commits\n\nAggressiv committen. Keine Co-Authored-By.',
        'regeln/sprache.md': '# Sprache\n\nAuf Deutsch antworten, direkt und kurz.',
      },
    },
  });
  after(cleanup);

  it('loads both vaults', () => {
    const registry = loadVaultRegistry(root);
    assert.equal(registry.length, 2);
    assert.deepEqual(registry.map(v => v.toolPrefix).sort(), ['intex_regeln', 'otris']);
  });

  it('creates MCP server with 5 tools per vault using correct prefixes', () => {
    const registry = loadVaultRegistry(root);
    const server = createMcpServer(registry);
    // uses SDK internal; may break on SDK upgrade
    const tools = server._registeredTools || {};
    assert.equal(Object.keys(tools).length, registry.length * TOOL_SUFFIXES.length);

    for (const prefix of ['otris', 'intex_regeln']) {
      for (const suffix of TOOL_SUFFIXES) {
        assert.ok(tools[`${prefix}_${suffix}`], `missing tool ${prefix}_${suffix}`);
      }
    }
  });

  it('search isolates per-vault content', () => {
    const registry = loadVaultRegistry(root);
    const otris = registry.find(v => v.toolPrefix === 'otris');
    const intex = registry.find(v => v.toolPrefix === 'intex_regeln');

    const otrisHits = handleSearch(otris.path, { query: 'DocFile' });
    assert.ok(otrisHits.length > 0, 'otris should find DocFile');

    const intexHits = handleSearch(intex.path, { query: 'DocFile' });
    assert.equal(intexHits.length, 0, 'intex should NOT find DocFile');

    const commitHits = handleSearch(intex.path, { query: 'commits' });
    assert.ok(commitHits.length > 0, 'intex should find commits');

    const otrisCommitHits = handleSearch(otris.path, { query: 'commits' });
    assert.equal(otrisCommitHits.length, 0, 'otris should NOT find commits');
  });
});
