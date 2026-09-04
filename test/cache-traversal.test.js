import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

var testVault = createTempVaultsRoot({
  traversal: {
    files: {
      'nested/Page.md': '# Page\n\nTraversalNeedle',
    },
  },
});
var VAULT_PATH = join(testVault.root, 'traversal');
after(testVault.cleanup);

it('reuses the manifestless change signature during the validation interval', async () => {
  var originalReaddirSync = fs.readdirSync;
  var rootReads = 0;
  fs.readdirSync = function (directory, options) {
    if (resolve(directory) === resolve(VAULT_PATH)) rootReads++;
    return originalReaddirSync(directory, options);
  };
  syncBuiltinESMExports();

  try {
    var searchTools = await import('../src/tools/search.js?cache-traversal');
    var warm = searchTools.handleSearch(VAULT_PATH, { query: 'TraversalNeedle' });
    assert.equal(warm.length, 1);

    rootReads = 0;
    var result = searchTools.handleSearch(VAULT_PATH, {
      query: 'TraversalNeedle',
      section: 'nested',
    });
    assert.equal(result.length, 1);
    assert.equal(rootReads, 0);
  } finally {
    fs.readdirSync = originalReaddirSync;
    syncBuiltinESMExports();
  }
});
