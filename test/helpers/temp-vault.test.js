import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTempVaultsRoot } from './temp-vault.js';

describe('temp-vault helper', () => {
  it('creates vaults with meta and files, cleans up after', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'otris': {
        meta: { name: 'otris', toolPrefix: 'otris' },
        files: { 'sec/a.md': '# A' },
      },
    });

    assert.ok(existsSync(join(root, 'otris', '_meta.json')));
    assert.equal(readFileSync(join(root, 'otris', 'sec', 'a.md'), 'utf-8'), '# A');

    cleanup();
    assert.ok(!existsSync(root));
  });

  it('accepts raw string meta for invalid-JSON tests', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'broken': { meta: '{not valid json', files: {} },
    });
    assert.equal(readFileSync(join(root, 'broken', '_meta.json'), 'utf-8'), '{not valid json');
    cleanup();
  });
});
