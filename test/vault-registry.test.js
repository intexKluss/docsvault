import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify, loadVaultRegistry, getToolSuffixes, describeVaults } from '../src/vault-registry.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

function findVault(registry, toolPrefix) {
  for (var i = 0; i < registry.length; i++) {
    if (registry[i].toolPrefix === toolPrefix) return registry[i];
  }
  return undefined;
}

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

describe('loadVaultRegistry: basic scan', () => {
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

  it('reads optional searchHint from _meta.json', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'otris': {
        meta: { toolPrefix: 'otris', searchHint: 'Check Properties first.' },
        files: { 'a.md': '#' },
      },
    });
    after(cleanup);
    const [vault] = loadVaultRegistry(root);
    assert.equal(vault.searchHint, 'Check Properties first.');
  });

  it('searchHint defaults to empty string when absent', () => {
    const { root, cleanup } = createTempVaultsRoot({
      'otris': { meta: { toolPrefix: 'otris' }, files: { 'a.md': '#' } },
    });
    after(cleanup);
    const [vault] = loadVaultRegistry(root);
    assert.equal(vault.searchHint, '');
  });

  it('keeps a configured technical section for a renamed vault', () => {
    var fixture = createTempVaultsRoot({
      'api-reference': {
        meta: { toolPrefix: 'api_reference', technicalSection: 'Reference/API' },
        files: { 'Reference/API/DocFile.md': '# DocFile' },
      },
    });
    after(fixture.cleanup);

    var vault = loadVaultRegistry(fixture.root)[0];
    assert.equal(vault.technicalSection, 'Reference/API');
    assert.ok(getToolSuffixes(vault).includes('technical_search'));
  });

  it('does not assign a technical section to otris without configuration', () => {
    var fixture = createTempVaultsRoot({
      'otris': {
        meta: { toolPrefix: 'otris' },
        files: { 'api/DocFile.md': '# DocFile' },
      },
    });
    after(fixture.cleanup);

    var vault = loadVaultRegistry(fixture.root)[0];
    assert.equal(vault.technicalSection, undefined);
    assert.ok(!getToolSuffixes(vault).includes('technical_search'));
  });

  it('detects the TERAS API section only when it exists', () => {
    var fixture = createTempVaultsRoot({
      'otris': {
        meta: { toolPrefix: 'otris' },
        files: { 'Scripting/TERAS API/DocFile.md': '# DocFile' },
      },
    });
    after(fixture.cleanup);

    var vault = loadVaultRegistry(fixture.root)[0];
    assert.equal(vault.technicalSection, 'Scripting/TERAS API');
    assert.ok(getToolSuffixes(vault).includes('technical_search'));
  });

  it('rejects non-canonical technical section paths', () => {
    var fixture = createTempVaultsRoot({
      outside: { files: { 'Doc.md': '# Outside' } },
      parent: { files: { 'Guide.md': '# Guide' } },
      absolute: { files: { 'Guide.md': '# Guide' } },
      duplicate: { files: { 'Reference/API/Doc.md': '# Doc' } },
    });
    after(fixture.cleanup);

    writeFileSync(join(fixture.root, 'parent', '_meta.json'), JSON.stringify({ toolPrefix: 'parent', technicalSection: '../outside' }));
    writeFileSync(join(fixture.root, 'absolute', '_meta.json'), JSON.stringify({ toolPrefix: 'absolute', technicalSection: join(fixture.root, 'outside') }));
    writeFileSync(join(fixture.root, 'duplicate', '_meta.json'), JSON.stringify({ toolPrefix: 'duplicate', technicalSection: 'Reference//API' }));

    var registry = loadVaultRegistry(fixture.root);
    assert.equal(findVault(registry, 'parent').technicalSection, undefined);
    assert.equal(findVault(registry, 'absolute').technicalSection, undefined);
    assert.equal(findVault(registry, 'duplicate').technicalSection, undefined);
  });

  it('rejects a technical section that escapes through a symbolic link', (t) => {
    var fixture = createTempVaultsRoot({
      'api-reference': {
        meta: { toolPrefix: 'api_reference', technicalSection: 'Reference/API' },
        files: { 'Guide.md': '# Guide' },
      },
      outside: { files: { 'Doc.md': '# Outside' } },
    });
    after(fixture.cleanup);

    var sectionDir = join(fixture.root, 'api-reference', 'Reference');
    var linkPath = join(sectionDir, 'API');
    var linkType = 'dir';
    if (process.platform === 'win32') linkType = 'junction';
    mkdirSync(sectionDir, { recursive: true });

    try {
      symlinkSync(join(fixture.root, 'outside'), linkPath, linkType);
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        t.skip(`symbolic links unavailable: ${err.code}`);
        return;
      }
      throw err;
    }

    var vault = findVault(loadVaultRegistry(fixture.root), 'api_reference');
    assert.equal(vault.technicalSection, undefined);
  });
});

describe('loadVaultRegistry: validation', () => {
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
