import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

function fakeBridge() {
  return {
    async createSession(toolPrefix) {
      let ready = false;
      return {
        toolPrefix,
        get ready() { return ready; },
        get destroyed() { return false; },
        async warmUp() { ready = true; },
        async *send() { yield { type: 'chunk', content: 'ok' }; yield { type: 'done' }; },
        async destroy() {},
      };
    },
  };
}

describe('Server bug report', () => {
  let server, port, vaults, reportsFile, dir;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'reports-'));
    reportsFile = join(dir, 'reports.json');
    vaults = createTempVaultsRoot({
      otris: { meta: { name: 'otris', description: 'Test', toolPrefix: 'otris' }, files: { 'howtos/x.md': '# X\n\ninhalt' } },
    });
    process.env.ALLOW_NO_ORIGIN = 'true';
    process.env.VAULTS_ROOT = vaults.root;
    process.env.REPORTS_PATH = reportsFile;
    const r = await createServer({ port: 0, bridge: fakeBridge() });
    server = r.server;
    port = r.port;
  });

  after(() => {
    delete process.env.ALLOW_NO_ORIGIN;
    delete process.env.VAULTS_ROOT;
    delete process.env.REPORTS_PATH;
    vaults.cleanup();
    rmSync(dir, { recursive: true, force: true });
    server.close();
    setTimeout(() => process.exit(0), 500);
  });

  it('speichert report mit ISO-timestamp und lesbarer localTime', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

    const saved = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('kein report_saved empfangen')), 4000);
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'report_saved') { clearTimeout(t); res(); }
      });
    });

    ws.send(JSON.stringify({
      type: 'report',
      description: 'test bug',
      chatContext: [
        { role: 'user', text: 'frage' },
        { role: 'assistant', text: 'antwort' },
      ],
      clientLog: [],
    }));

    await saved;
    ws.close();

    const lines = readFileSync(reportsFile, 'utf8').trim().split('\n');
    const rep = JSON.parse(lines[lines.length - 1]);

    assert.ok(rep.timestamp, 'ISO timestamp vorhanden');
    assert.ok(rep.localTime && /\d{2}\.\d{2}\.\d{4}/.test(rep.localTime), 'lesbares deutsches datum');
    assert.equal(rep.chatContext.length, 2);
    assert.equal(rep.chatContext[0].role, 'user');
    assert.equal(rep.chatContext[1].role, 'assistant');
  });
});
