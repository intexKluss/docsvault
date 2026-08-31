import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { handleOverview } from '../src/tools/overview.js';
import { handleList, handleListPaged, DEFAULT_LIST_LIMIT } from '../src/tools/list.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

// section mit 12 subfoldern -> muss auf 8 + "+N weitere" gekürzt werden.
// Jeder subfolder bekommt genug seiten damit die section über
// MAX_INLINE_TITLES liegt und nur noch subfolder-zählungen liefert.
const bigFiles = {};
for (let i = 1; i <= 12; i++) {
  const sf = `sub${String(i).padStart(2, '0')}`;
  for (let p = 1; p <= 6; p++) {
    bigFiles[`big/${sf}/page${p}.md`] = `# Page ${i}-${p}\n\nbody`;
  }
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
  // Punkt 16: große section wird gekürzt
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

  // grosse section: subfolder mit seitenzahlen statt hunderter titel
  it('returns subfolder counts instead of page titles for large sections', () => {
    const out = handleOverview(VAULT_PATH, { section: 'big' }, 'Test');
    assert.match(out, /## big \(72 pages, 12 subfolders\)/);
    assert.match(out, /- sub01: 6 pages/);
    assert.match(out, /- sub12: 6 pages/);
    // keine einzelnen seitentitel mehr
    assert.doesNotMatch(out, /- Page 1-1/);
    assert.match(out, /list\(section="big", subfolder="sub01"\)/);
  });
});

describe('handleListPaged', () => {
  it('caps the listing and reports how many are left', () => {
    const res = handleListPaged(VAULT_PATH, { section: 'big' });
    assert.equal(res.files.length, DEFAULT_LIST_LIMIT);
    assert.equal(res.total, 72);
    assert.equal(res.truncated, true);
    assert.match(res.note, /\+22 weitere/);
    assert.match(res.note, /subfolder=/);
  });

  it('does not truncate a small listing', () => {
    const res = handleListPaged(VAULT_PATH, { section: 'small' });
    assert.equal(res.truncated, false);
    assert.equal(res.note, '');
    assert.equal(res.files.length, 2);
  });

  it('honors max_results', () => {
    const res = handleListPaged(VAULT_PATH, { section: 'big', max_results: 3 });
    assert.equal(res.files.length, 3);
    assert.equal(res.truncated, true);
  });

  it('passes the unknown-section error through', () => {
    const res = handleListPaged(VAULT_PATH, { section: 'ghost' });
    assert.ok(res.error);
  });

  // handleList selbst bleibt unveraendert ein array (web-api haengt dran)
  it('leaves handleList returning a plain uncapped array', () => {
    const files = handleList(VAULT_PATH, { section: 'big' });
    assert.ok(Array.isArray(files));
    assert.equal(files.length, 72);
  });
});
