import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { handleStatus } from '../src/tools/status.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

const today = new Date().toISOString();

const { root, cleanup } = createTempVaultsRoot({
  // vault mit manifest inkl. pageCount
  'withmanifest': {
    meta: { toolPrefix: 'withmanifest' },
    files: {
      'api/A.md': '# A\n\nbody',
      'api/B.md': '# B\n\nbody',
      '_manifest.json': JSON.stringify({
        crawledAt: today,
        pageCount: 999,
        pdfCount: 3,
        errorCount: 0,
        sections: ['api'],
        crawlerVersion: '1.2.3',
      }),
    },
  },
  // vault ohne manifest
  'nomanifest': {
    meta: { toolPrefix: 'nomanifest' },
    files: {
      'api/A.md': '# A\n\nbody',
    },
  },
});
after(cleanup);

describe('handleStatus', () => {
  // Punkt 15: pageCount aus dem manifest wird ohne tree-walk übernommen
  it('uses manifest.pageCount without walking the tree', () => {
    const res = handleStatus(join(root, 'withmanifest'));
    assert.equal(res.pages, 999, 'pageCount aus manifest muss gewinnen, nicht der walk (=2)');
    assert.equal(res.status, 'current');
    assert.equal(res.crawlerVersion, '1.2.3');
  });

  it('falls back to walking when manifest is missing', () => {
    const res = handleStatus(join(root, 'nomanifest'));
    assert.equal(res.status, 'unknown');
    assert.equal(res.pages, 1);
  });

  it('reports not_installed for a missing vault', () => {
    const res = handleStatus(join(root, 'does-not-exist'));
    assert.equal(res.status, 'not_installed');
  });
});
