import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, loadVaultRegistry } from '../src/vault-registry.js';
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
