import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join } from 'node:path';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

var testVault = createTempVaultsRoot({
  docs: {
    files: {
      'stable/alpha.md': '# Alpha\n\nStableOrderNeedle',
      'stable/zeta.md': '# Zeta\n\nStableOrderNeedle',
    },
  },
});
var VAULT_PATH = join(testVault.root, 'docs');
after(testVault.cleanup);

it('indexes Markdown files in stable path order', async () => {
  var originalReaddirSync = fs.readdirSync;
  fs.readdirSync = function (directory, options) {
    var entries = originalReaddirSync(directory, options);
    if (basename(directory) === 'stable') entries.reverse();
    return entries;
  };
  syncBuiltinESMExports();

  try {
    var searchIndex = await import('../src/tools/search-index.js?stable-path-order');
    var index = searchIndex.buildSearchIndex(VAULT_PATH);
  } finally {
    fs.readdirSync = originalReaddirSync;
    syncBuiltinESMExports();
  }

  var files = [];
  var segments = Array.from(index.segments.values());
  for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    if (files.includes(segments[segmentIndex].file)) continue;
    files.push(segments[segmentIndex].file);
  }
  assert.deepEqual(files, ['stable/alpha', 'stable/zeta']);
});
