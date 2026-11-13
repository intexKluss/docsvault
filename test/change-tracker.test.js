import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { trackVaultChanges, readChangeHistory, readChangeEntry } from '../src/change-tracker.js';
import { createApiRouter } from '../src/api-routes.js';

describe('change tracker', () => {
  let workDir;
  let vault;
  let dataDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'docsvault-changes-'));
    dataDir = join(workDir, 'data');
    vault = { toolPrefix: 'docs', name: 'Docs', description: '', path: join(workDir, 'docs') };
    mkdirSync(vault.path);
    writeVaultFile('intro/a.md', '# A\nline one\nline two');
    writeVaultFile('intro/b.md', '# B');
  });

  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  function writeVaultFile(relativePath, content) {
    const full = join(vault.path, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  it('creates only a baseline on the first start', () => {
    assert.equal(trackVaultChanges(vault, dataDir), null);
    assert.deepEqual(readChangeHistory(dataDir, 'docs'), []);
    assert.ok(existsSync(join(dataDir, 'changes', 'docs', 'snapshot', 'intro', 'a.md')));
  });

  it('records nothing when the vault is unchanged', () => {
    trackVaultChanges(vault, dataDir);
    assert.equal(trackVaultChanges(vault, dataDir), null);
    assert.deepEqual(readChangeHistory(dataDir, 'docs'), []);
  });

  it('records added, changed and removed pages with a diff', () => {
    trackVaultChanges(vault, dataDir);
    writeVaultFile('intro/a.md', '# A\nline one\nline TWO');
    writeVaultFile('intro/new.md', '# New');
    rmSync(join(vault.path, 'intro', 'b.md'));

    const entry = trackVaultChanges(vault, dataDir);
    assert.deepEqual(entry.added, ['intro/new.md']);
    assert.deepEqual(entry.removed, ['intro/b.md']);
    assert.deepEqual(entry.changed, [{ path: 'intro/a.md', additions: 1, deletions: 1 }]);

    const full = readChangeEntry(dataDir, 'docs', entry.id);
    assert.ok(full.diffs['intro/a.md'].lines.includes('-line two'));
    assert.ok(full.diffs['intro/a.md'].lines.includes('+line TWO'));
  });

  it('compares against the last recorded state, not the first baseline', () => {
    trackVaultChanges(vault, dataDir);
    writeVaultFile('intro/a.md', 'v2');
    trackVaultChanges(vault, dataDir);
    assert.equal(trackVaultChanges(vault, dataDir), null);

    writeVaultFile('intro/a.md', 'v3');
    const entry = trackVaultChanges(vault, dataDir);
    assert.equal(readChangeEntry(dataDir, 'docs', entry.id).diffs['intro/a.md'].lines.includes('-v2'), true);
    assert.equal(readChangeHistory(dataDir, 'docs').length, 2);
  });

  it('ignores non markdown files and skipped folders', () => {
    trackVaultChanges(vault, dataDir);
    writeVaultFile('intro/image.png', 'binary');
    writeVaultFile('_staging/x.md', '# hidden');
    writeVaultFile('crawl/y.md', '# crawler');
    assert.equal(trackVaultChanges(vault, dataDir), null);
  });

  it('keeps entry ids unique when two runs share a second', () => {
    trackVaultChanges(vault, dataDir);
    writeVaultFile('intro/a.md', 'one');
    const first = trackVaultChanges(vault, dataDir);
    writeVaultFile('intro/a.md', 'two');
    const second = trackVaultChanges(vault, dataDir);
    assert.notEqual(first.id, second.id);
  });

  it('serves only ids that exist in the history', () => {
    trackVaultChanges(vault, dataDir);
    assert.equal(readChangeEntry(dataDir, 'docs', '../../history'), null);
    assert.equal(readChangeEntry(dataDir, 'docs', '20260101T000000Z'), null);
  });
});

describe('changes API', () => {
  let workDir;
  let server;
  let baseUrl;
  let vault;
  let dataDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'docsvault-changes-api-'));
    dataDir = join(workDir, 'data');
    vault = { toolPrefix: 'docs', name: 'Docs', description: '', path: join(workDir, 'docs') };
    mkdirSync(vault.path);
    writeFileSync(join(vault.path, 'a.md'), 'one');
  });

  afterEach(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    server = null;
    rmSync(workDir, { recursive: true, force: true });
  });

  async function startApi(dataDirOption) {
    const app = express();
    app.use(createApiRouter([vault], dataDirOption));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = `http://localhost:${server.address().port}`;
  }

  it('reports tracking as disabled without a data directory', async () => {
    await startApi(null);
    const response = await fetch(`${baseUrl}/api/docs/changes`);
    assert.deepEqual(await response.json(), { enabled: false, entries: [] });
    assert.equal((await fetch(`${baseUrl}/api/docs/changes/x`)).status, 404);
  });

  it('lists entries and serves one entry with its diffs', async () => {
    trackVaultChanges(vault, dataDir);
    writeFileSync(join(vault.path, 'a.md'), 'two');
    const entry = trackVaultChanges(vault, dataDir);
    await startApi(dataDir);

    const list = await (await fetch(`${baseUrl}/api/docs/changes`)).json();
    assert.equal(list.enabled, true);
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0].id, entry.id);

    const detail = await (await fetch(`${baseUrl}/api/docs/changes/${entry.id}`)).json();
    assert.ok(detail.diffs['a.md'].lines.includes('+two'));

    assert.equal((await fetch(`${baseUrl}/api/docs/changes/unknown`)).status, 404);
  });
});
