import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { handleOverview } from '../src/tools/overview.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

// section mit 12 subfoldern -> muss auf 8 + "+N weitere" gekuerzt werden
const bigFiles = {};
for (let i = 1; i <= 12; i++) {
  const sf = `sub${String(i).padStart(2, '0')}`;
  bigFiles[`big/${sf}/page.md`] = `# Page ${i}\n\nbody`;
}
// kleine section mit nur 2 subfoldern -> voll auflisten
const smallFiles = {
  'small/alpha/a.md': '# A\n\nbody',
  'small/beta/b.md': '# B\n\nbody',
};

const { root, cleanup } = createTempVaultsRoot({
  'ov': {
    meta: { toolPrefix: 'ov' },
    files: { ...bigFiles, ...smallFiles },
  },
});
const VAULT_PATH = join(root, 'ov');
after(cleanup);

describe('handleOverview', () => {
  // Punkt 16: grosse section wird gekuerzt
  it('caps inline subfolders for large sections', () => {
    const out = handleOverview(VAULT_PATH, {}, 'Test');
    assert.match(out, /\+4 weitere, nutze overview\(big\)/);
    // sub01..sub08 sichtbar, sub09+ nicht inline
    assert.match(out, /sub08/);
    assert.doesNotMatch(out, /sub09/);
  });

  it('lists small sections fully', () => {
    const out = handleOverview(VAULT_PATH, {}, 'Test');
    assert.match(out, /small: 2 pages \(alpha, beta\)/);
  });

  it('returns a detailed listing for a given section', () => {
    const out = handleOverview(VAULT_PATH, { section: 'small' }, 'Test');
    assert.match(out, /## small/);
    assert.match(out, /### alpha/);
    assert.match(out, /### beta/);
  });

  it('reports not-found for an empty/unknown section', () => {
    const out = handleOverview(VAULT_PATH, { section: 'ghost' }, 'Test');
    assert.match(out, /not found or empty/);
  });
});
