import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { handleOverview } from '../src/tools/overview.js';
import { handleList, handleListPaged, DEFAULT_LIST_LIMIT } from '../src/tools/list.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

var bigFiles = {};
for (var folderIndex = 1; folderIndex <= 12; folderIndex++) {
  var subfolder = `sub${String(folderIndex).padStart(2, '0')}`;
  for (var pageIndex = 1; pageIndex <= 6; pageIndex++) {
    bigFiles[`big/${subfolder}/page${pageIndex}.md`] = `# Page ${folderIndex}-${pageIndex}\n\nbody`;
  }
}
var smallFiles = {
  'small/alpha/a.md': '# A\n\nbody',
  'small/beta/b.md': '# B\n\nbody',
};
var directFiles = {};
for (var pageIndex = 1; pageIndex <= 41; pageIndex++) {
  directFiles[`direct/page${pageIndex}.md`] = `# Direct Page ${pageIndex}\n\nbody`;
}
var testVault = createTempVaultsRoot({
  ov: {
    meta: { toolPrefix: 'ov' },
    files: { ...bigFiles, ...smallFiles, ...directFiles },
  },
});
var VAULT_PATH = join(testVault.root, 'ov');
after(testVault.cleanup);

describe('handleOverview', () => {
  it('caps inline subfolders for large sections', () => {
    var output = handleOverview(VAULT_PATH, {}, 'Test');
    assert.match(output, /\+4 weitere, nutze overview\(big\)/);
    assert.match(output, /sub08/);
    assert.doesNotMatch(output, /sub09/);
  });

  it('lists small sections fully', () => {
    var output = handleOverview(VAULT_PATH, {}, 'Test');
    assert.match(output, /small: 2 pages \(alpha, beta\)/);
  });

  it('returns a detailed listing for a given section', () => {
    var output = handleOverview(VAULT_PATH, { section: 'small' }, 'Test');
    assert.match(output, /## small/);
    assert.match(output, /### alpha/);
    assert.match(output, /### beta/);
  });

  it('reports not-found for an empty/unknown section', () => {
    var output = handleOverview(VAULT_PATH, { section: 'ghost' }, 'Test');
    assert.match(output, /not found or empty/);
  });

  it('returns subfolder counts instead of page titles for large sections', () => {
    var output = handleOverview(VAULT_PATH, { section: 'big' }, 'Test');
    assert.match(output, /## big \(72 pages, 12 subfolders\)/);
    assert.match(output, /- sub01: 6 pages/);
    assert.match(output, /- sub12: 6 pages/);
    assert.doesNotMatch(output, /- Page 1-1/);
    assert.match(output, /list\(section="big", subfolder="sub01"\)/);
  });

  it('counts more than 40 direct pages without exposing _root as a subfolder', () => {
    var output = handleOverview(VAULT_PATH, { section: 'direct' }, 'Test');
    assert.match(output, /## direct \(41 pages, 0 subfolders\)/);
    assert.match(output, /\(direkt in direct\): 41 pages/);
    assert.match(output, /list\(section="direct"\)/);
    assert.doesNotMatch(output, /_root/);
    assert.doesNotMatch(output, /subfolder=/);

    var rootOutput = handleOverview(VAULT_PATH, {}, 'Test');
    assert.match(rootOutput, /direct: 41 pages \(41 direkt\)/);
    assert.doesNotMatch(rootOutput, /_root/);
  });
});

describe('handleListPaged', () => {
  it('exports the default list limit', () => {
    assert.equal(typeof DEFAULT_LIST_LIMIT, 'number');
  });

  it('caps the listing and reports how many are left', () => {
    var result = handleListPaged(VAULT_PATH, { section: 'big' });
    assert.equal(result.files.length, DEFAULT_LIST_LIMIT);
    assert.equal(result.total, 72);
    assert.equal(result.truncated, true);
    assert.match(result.note, /\+22 weitere/);
    assert.match(result.note, /subfolder=/);
  });

  it('does not truncate a small listing', () => {
    var result = handleListPaged(VAULT_PATH, { section: 'small' });
    assert.equal(result.truncated, false);
    assert.equal(result.note, '');
    assert.equal(result.files.length, 2);
  });

  it('honors max_results', () => {
    var result = handleListPaged(VAULT_PATH, { section: 'big', max_results: 3 });
    assert.equal(result.files.length, 3);
    assert.equal(result.truncated, true);
  });

  it('passes the unknown-section error through', () => {
    var result = handleListPaged(VAULT_PATH, { section: 'ghost' });
    assert.ok(result.error);
  });

  it('leaves handleList returning a plain uncapped array', () => {
    var files = handleList(VAULT_PATH, { section: 'big' });
    assert.ok(Array.isArray(files));
    assert.equal(files.length, 72);
  });
});
