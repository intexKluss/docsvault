import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { readBurnRate } from '../src/codex-usage.js';
import { createServer } from '../src/server.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

// schreibt einen fake-rollout wie ihn `codex exec` ablegt (token_count mit
// rate_limits unter payload), damit die tests nicht von echten ~/.codex-daten
// abhängen.
function writeRollout(home, rateLimits) {
  const dir = join(home, 'sessions', '2026', '06', '25');
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    timestamp: '2026-06-25T10:00:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: null, rate_limits: rateLimits },
  });
  writeFileSync(join(dir, 'rollout-2026-06-25T10-00-00-test.jsonl'), line + '\n');
}

const RL = {
  limit_id: 'codex',
  primary: { used_percent: 28, window_minutes: 300, resets_at: 1782416513 },
  secondary: { used_percent: 5, window_minutes: 10080, resets_at: 1783003313 },
  plan_type: 'team',
};

describe('codex-usage readBurnRate', () => {
  let home;

  before(() => {
    home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    process.env.CODEX_HOME = home;
    writeRollout(home, RL);
  });

  after(() => {
    delete process.env.CODEX_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it('liest primary + secondary aus dem rollout', async () => {
    const r = await readBurnRate({ force: true });
    assert.ok(r, 'burn-rate sollte daten liefern');
    assert.equal(r.primary.usedPercent, 28);
    assert.equal(r.primary.remainingPercent, 72);
    assert.equal(r.primary.windowMinutes, 300);
    assert.equal(r.secondary.remainingPercent, 95);
    assert.equal(r.planType, 'team');
  });

  it('binding = das fenster mit dem wenigsten rest', async () => {
    const r = await readBurnRate({ force: true });
    // primary 72% rest < secondary 95% rest -> primary bindet
    assert.equal(r.binding.remainingPercent, 72);
    assert.equal(r.binding.windowMinutes, 300);
  });

  it('liefert null wenn kein rollout da ist', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'codex-empty-'));
    process.env.CODEX_HOME = empty;
    try {
      const r = await readBurnRate({ force: true });
      assert.equal(r, null);
    } finally {
      process.env.CODEX_HOME = home;
      rmSync(empty, { recursive: true, force: true });
    }
  });

  // robustheit: die NEUESTE rollout-datei (frische session, warm-up noch nicht
  // durch) hat noch keine rate_limits -> es muss auf die nächstältere mit quote
  // zurückgefallen werden (quote ist account-global).
  it('fällt auf die nächstältere datei zurück wenn die neueste keine quote hat', async () => {
    const h = mkdtempSync(join(tmpdir(), 'codex-fallback-'));
    const dir = join(h, 'sessions', '2026', '06', '25');
    mkdirSync(dir, { recursive: true });

    const withRl = join(dir, 'rollout-2026-06-25T09-00-00-old.jsonl');
    writeFileSync(withRl, JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: null, rate_limits: RL },
    }) + '\n');

    // frischer rollout ohne token_count/rate_limits (nur session_meta)
    const noRl = join(dir, 'rollout-2026-06-25T11-00-00-fresh.jsonl');
    writeFileSync(noRl, JSON.stringify({ type: 'session_meta', payload: { id: 'x' } }) + '\n');

    // der frische muss die neuere mtime haben
    utimesSync(withRl, new Date(1000000), new Date(1000000));
    utimesSync(noRl, new Date(2000000), new Date(2000000));

    process.env.CODEX_HOME = h;
    try {
      const r = await readBurnRate({ force: true });
      assert.ok(r, 'fallback sollte die quote aus der älteren datei liefern');
      assert.equal(r.binding.remainingPercent, 72);
    } finally {
      process.env.CODEX_HOME = home;
      rmSync(h, { recursive: true, force: true });
    }
  });
});

// integration: der server pusht das burn_rate-event über die ws-verbindung,
// sobald die session bereit ist (codex-bridge).
describe('Server burn_rate push', () => {
  let server, port, home, vaults;

  before(async () => {
    home = mkdtempSync(join(tmpdir(), 'codex-home-srv-'));
    writeRollout(home, RL);
    vaults = createTempVaultsRoot({
      otris: {
        meta: { name: 'otris', description: 'Test', toolPrefix: 'otris' },
        files: { 'howtos/x.md': '# X\n\ninhalt' },
      },
    });
    process.env.CODEX_HOME = home;
    process.env.BRIDGE = 'codex';
    process.env.ALLOW_NO_ORIGIN = 'true';
    process.env.VAULTS_ROOT = vaults.root;
    const result = await createServer({ port: 0, bridge: fakeBridge() });
    server = result.server;
    port = result.port;
  });

  after(() => {
    delete process.env.CODEX_HOME;
    delete process.env.BRIDGE;
    delete process.env.ALLOW_NO_ORIGIN;
    delete process.env.VAULTS_ROOT;
    vaults.cleanup();
    rmSync(home, { recursive: true, force: true });
    server.close();
    setTimeout(() => process.exit(0), 500);
  });

  // single-vault -> auto-warmup -> session_ready -> burn_rate
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

  it('sendet ein burn_rate-event nach session_ready', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const burn = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('kein burn_rate event empfangen')), 4000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'burn_rate') { clearTimeout(timer); resolve(msg); }
      });
      ws.on('error', reject);
    });
    ws.close();
    assert.equal(burn.binding.remainingPercent, 72);
    assert.equal(burn.planType, 'team');
  });
});
