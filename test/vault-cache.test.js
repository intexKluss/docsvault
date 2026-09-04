import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { handleSearch } from '../src/tools/search.js';
import { buildSearchIndex } from '../src/tools/search-index.js';
import { clearVaultCache } from '../src/tools/vault-cache.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

var testVault = createTempVaultsRoot({
  cache: {
    files: {
      'nested/Page.md': '# Page\n\nOriginalCacheNeedle',
    },
  },
  broken: {
    files: {
      '_manifest.json': '{"pageCount":1}',
      'nested/Broken.md': '# Broken\n\nMissingMarkdownNeedle',
    },
  },
});
var VAULT_PATH = join(testVault.root, 'cache');
var BROKEN_VAULT_PATH = join(testVault.root, 'broken');
after(testVault.cleanup);

describe('vault cache', () => {
  it('invalidates a manifestless index when nested Markdown content changes', async () => {
    clearVaultCache(VAULT_PATH);
    var first = handleSearch(VAULT_PATH, { query: 'OriginalCacheNeedle' });
    assert.equal(first.length, 1);

    writeFileSync(join(VAULT_PATH, 'nested', 'Page.md'), '# Page\n\nUpdatedCacheNeedle with changed length');
    await new Promise(function (resolve) {
      setTimeout(resolve, 1100);
    });

    var second = handleSearch(VAULT_PATH, { query: 'UpdatedCacheNeedle' });
    assert.equal(second.length, 1);
    assert.equal(second[0].file, 'nested/Page');
  });

  it('throws directory read failures with path context', () => {
    var missingPath = join(testVault.root, 'missing-vault');
    assert.throws(
      function () {
        buildSearchIndex(missingPath);
      },
      function (error) {
        return error.message.includes(missingPath);
      }
    );
  });

  it('exposes Markdown read failures through the search error result', () => {
    clearVaultCache(BROKEN_VAULT_PATH);
    var first = handleSearch(BROKEN_VAULT_PATH, { query: 'MissingMarkdownNeedle' });
    assert.equal(first.length, 1);

    var brokenPath = join(BROKEN_VAULT_PATH, 'nested', 'Broken.md');
    unlinkSync(brokenPath);

    var loggedError = '';
    var originalError = console.error;
    console.error = function (message) {
      loggedError += message;
    };
    try {
      var second = handleSearch(BROKEN_VAULT_PATH, { query: 'MissingMarkdownNeedle' });
    } finally {
      console.error = originalError;
    }

    assert.equal(second.error, 'Search index unavailable.');
    assert.match(loggedError, /Broken\.md/);
  });

  it('counts every successfully read Markdown file', () => {
    var index = buildSearchIndex(VAULT_PATH);
    assert.equal(index.fileCount, 1);
  });
});
