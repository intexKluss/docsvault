import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTempVaultsRoot } from './helpers/temp-vault.js';
import { loadVaultRegistry, getToolSuffixes } from '../src/vault-registry.js';
import { createMcpServer } from '../src/mcp-handler.js';
import { handleSearch } from '../src/tools/search.js';

describe('Multi-vault integration', () => {
  const { root, cleanup } = createTempVaultsRoot({
    'otris': {
      meta: { name: 'otris', toolPrefix: 'otris', description: 'otris Doku', technicalSection: 'api/technical' },
      files: {
        'api/technical/DocApi.md': '# DocApi',
        'api/DocFile.md': '# DocFile\n\nDas ist eine otris-API-Klasse zur Dateiverwaltung.',
        'howtos/upload.md': '# Upload\n\nSo lädst du Dateien hoch.',
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

  it('creates each vault\'s configured tools with correct prefixes', () => {
    const registry = loadVaultRegistry(root);
    const server = createMcpServer(registry);
    // uses SDK internal; may break on SDK upgrade
    const tools = server._registeredTools || {};
    var toolCount = 0;
    for (var vaultIndex = 0; vaultIndex < registry.length; vaultIndex++) {
      toolCount += getToolSuffixes(registry[vaultIndex]).length;
    }
    assert.equal(Object.keys(tools).length, toolCount);

    var prefixes = ['otris', 'intex_regeln'];
    for (var prefixIndex = 0; prefixIndex < prefixes.length; prefixIndex++) {
      var vault;
      for (var vaultIndex = 0; vaultIndex < registry.length; vaultIndex++) {
        if (registry[vaultIndex].toolPrefix === prefixes[prefixIndex]) vault = registry[vaultIndex];
      }
      var suffixes = getToolSuffixes(vault);
      for (var suffixIndex = 0; suffixIndex < suffixes.length; suffixIndex++) {
        var toolName = `${prefixes[prefixIndex]}_${suffixes[suffixIndex]}`;
        assert.ok(tools[toolName], `missing tool ${toolName}`);
      }
    }
  });

  it('registers technical search only for the configured vault', () => {
    var registry = loadVaultRegistry(root);
    var server = createMcpServer(registry);
    var tools = server._registeredTools || {};

    assert.ok(tools.otris_technical_search);
    assert.ok(!tools.intex_regeln_technical_search);
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
