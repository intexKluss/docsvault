import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, loadVaultRegistry, describeVaults } from '../src/vault-registry.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

describe('slugify', () => {
  const cases = [
    ['otris', 'otris'],
    ['Intex Regeln', 'intex_regeln'],
    ['API v2.0', 'api_v2_0'],
    ['Kunden-Projekte', 'kunden_projekte'],
    ['---abc---', 'abc'],
    ['MixedCASE', 'mixedcase'],
    ['multiple   spaces', 'multiple_spaces'],
    ['with.dots.everywhere', 'with_dots_everywhere'],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" -> "${expected}"`, () => {
      assert.equal(slugify(input), expected);
    });
  }
});

describe('loadVaultRegistry — basic scan', () => {
  it('scans one vault with full _meta.json', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'otris': {
        meta: {
          name: 'otris DOCUMENTS API',
          description: 'Die otris API-Doku.',
          toolPrefix: 'otris',
        },
        files: { 'api/a.md': '# A' },
      },
    });
    after(cleanup);

    const registry = loadVaultRegistry(root);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].name, 'otris DOCUMENTS API');
    assert.equal(registry[0].description, 'Die otris API-Doku.');
    assert.equal(registry[0].toolPrefix, 'otris');
    assert.ok(registry[0].path.endsWith('otris'));
  });

  it('scans multiple vaults, sorted by toolPrefix', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'zebra': { meta: { toolPrefix: 'zebra' }, files: { 'a.md': 'z' } },
      'otris': { meta: { toolPrefix: 'otris' }, files: { 'a.md': 'o' } },
      'intex-regeln': { meta: { toolPrefix: 'intex_regeln' }, files: { 'a.md': 'i' } },
    });
    after(cleanup);

    const registry = loadVaultRegistry(root);
    assert.deepEqual(registry.map(v => v.toolPrefix), ['intex_regeln', 'otris', 'zebra']);
  });

  it('falls back when _meta.json is missing', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'Intex Regeln': { files: { 'a.md': '#' } },
    });
    after(cleanup);

    const registry = loadVaultRegistry(root);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].name, 'Intex Regeln');
    assert.equal(registry[0].toolPrefix, 'intex_regeln');
    assert.ok(registry[0].description.includes('Intex Regeln'));
  });

  it('falls back for partial _meta.json (only name)', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'foo': { meta: { name: 'Foo Docs' }, files: { 'a.md': '#' } },
    });
    after(cleanup);

    const [vault] = loadVaultRegistry(root);
    assert.equal(vault.name, 'Foo Docs');
    assert.equal(vault.toolPrefix, 'foo');
    assert.ok(vault.description.length > 0);
  });

  it('ignores dotfiles and non-directories at top level', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'otris': { meta: { toolPrefix: 'otris' }, files: { 'a.md': '#' } },
      '.git': { files: { 'config': 'x' } },
    });
    after(cleanup);

    const registry = loadVaultRegistry(root);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].toolPrefix, 'otris');
  });
});

describe('loadVaultRegistry — validation', () => {
  it('skips vault with invalid toolPrefix (starts with digit)', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'bad': { meta: { toolPrefix: '2fa' }, files: { 'a.md': '#' } },
      'good': { meta: { toolPrefix: 'good' }, files: { 'a.md': '#' } },
    });
    after(cleanup);
    const registry = loadVaultRegistry(root);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].toolPrefix, 'good');
  });

  it('skips vault with invalid toolPrefix (uppercase)', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'bad': { meta: { toolPrefix: 'BadOne' }, files: { 'a.md': '#' } },
    });
    after(cleanup);
    assert.equal(loadVaultRegistry(root).length, 0);
  });

  it('skips vault when derived slug is invalid (folder name all digits)', () => {
    const { root, cleanup } = createTempVaultsRoot({
      '2024-notes': { files: { 'a.md': '#' } },
    });
    after(cleanup);
    assert.equal(loadVaultRegistry(root).length, 0);
  });

  it('skips second vault on toolPrefix collision (alphabetic order by folder)', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'a-first': { meta: { toolPrefix: 'shared' }, files: { 'a.md': '#' } },
      'b-second': { meta: { toolPrefix: 'shared' }, files: { 'a.md': '#' } },
    });
    after(cleanup);
    const registry = loadVaultRegistry(root);
    assert.equal(registry.length, 1);
    assert.ok(registry[0].path.endsWith('a-first'));
  });

  it('skips vault with no markdown files', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'empty': { meta: { toolPrefix: 'empty' }, files: {} },
      'full': { meta: { toolPrefix: 'full' }, files: { 'a.md': '#' } },
    });
    after(cleanup);
    const registry = loadVaultRegistry(root);
    assert.deepEqual(registry.map(v => v.toolPrefix), ['full']);
  });

  it('ignores markdown that only lives in crawl/ or node_modules/', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'crawlonly': {
        meta: { toolPrefix: 'crawlonly' },
        files: { 'crawl/script.md': '# crawler', 'node_modules/dep/readme.md': '# dep' },
      },
      'real': { meta: { toolPrefix: 'real' }, files: { 'doc.md': '# real' } },
    });
    after(cleanup);
    const registry = loadVaultRegistry(root);
    assert.deepEqual(registry.map(v => v.toolPrefix), ['real']);
  });

  it('finds nested markdown (recursive check)', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'nested': {
        meta: { toolPrefix: 'nested' },
        files: { 'sec/subsec/deep.md': '# deep' },
      },
    });
    after(cleanup);
    assert.equal(loadVaultRegistry(root).length, 1);
  });

  it('returns empty registry when VAULTS_ROOT does not exist', () => {
    assert.deepEqual(loadVaultRegistry('/absolutely/not/a/path'), []);
  });

  it('handles _meta.json that is not a JSON object (array)', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'arr': { meta: '[1,2,3]', files: { 'a.md': '#' } },
    });
    after(cleanup);
    const registry = loadVaultRegistry(root);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].toolPrefix, 'arr');
    assert.equal(registry[0].name, 'arr');
  });

  it('handles invalid JSON in _meta.json', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'broken': { meta: '{nope', files: { 'a.md': '#' } },
    });
    after(cleanup);
    const registry = loadVaultRegistry(root);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].toolPrefix, 'broken');
  });
});

describe('describeVaults', () => {
  it('returns empty string for empty registry', () => {
    assert.equal(describeVaults([]), '');
  });

  it('lists each vault with name, description and tools', () => {
    const registry = [
      { name: 'otris DOCUMENTS API', description: 'otris Doku.', toolPrefix: 'otris', path: '/x' },
      { name: 'Intex Regeln', description: 'Firmenregeln.', toolPrefix: 'intex_regeln', path: '/y' },
    ];
    const out = describeVaults(registry);
    assert.ok(out.includes('otris DOCUMENTS API'));
    assert.ok(out.includes('otris Doku.'));
    assert.ok(out.includes('otris_search'));
    assert.ok(out.includes('otris_read'));
    assert.ok(out.includes('Intex Regeln'));
    assert.ok(out.includes('intex_regeln_search'));
  });
});
