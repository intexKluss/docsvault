import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';
import { SessionManager } from '../src/session-manager.js';

// Erfasst die Prefixes, die die Bridge kriegt, damit wir das Scoping prüfen können.
function spyBridge() {
  const calls = [];
  return {
    calls,
    async createSession(toolPrefix) {
      calls.push(toolPrefix);
      return {
        id: 'spy-' + calls.length,
        destroyed: false,
        ready: true,
        toolPrefix,
        async warmUp() {},
        async *send() {},
        async destroy() { this.destroyed = true; },
      };
    },
  };
}

describe('SessionManager vault scoping', () => {
  it('gibt toolPrefix an die Bridge weiter', async () => {
    const bridge = spyBridge();
    const manager = new SessionManager(bridge, { maxSessions: 3, rateLimitPerMin: 5, maxMessageLength: 100 });
    const session = await manager.createAndWarmUp('c1', 'otris');
    assert.equal(bridge.calls[0], 'otris');
    assert.equal(session.toolPrefix, 'otris');
    await manager.shutdown();
  });

  it('ohne toolPrefix bleibt alles beim alten', async () => {
    const bridge = spyBridge();
    const manager = new SessionManager(bridge, { maxSessions: 3, rateLimitPerMin: 5, maxMessageLength: 100 });
    await manager.createAndWarmUp('c1');
    assert.equal(bridge.calls[0], undefined);
    await manager.shutdown();
  });
});

describe('Server vault-selector websocket flow', () => {
  const { root: VAULTS_ROOT, cleanup } = createTempVaultsRoot({
    'otris': {
      meta: { name: 'otris', toolPrefix: 'otris', description: 'otris Docs' },
      files: { 'howtos/upload.md': '# Upload\n\nx.' },
    },
    'intex-regeln': {
      meta: { name: 'Intex Regeln', toolPrefix: 'intex_regeln', description: 'Regeln' },
      files: { 'regeln/sprache.md': '# Sprache\n\nDeutsch.' },
    },
  });

  let server, port;

  before(async () => {
    process.env.ALLOW_NO_ORIGIN = 'true';
    process.env.VAULTS_ROOT = VAULTS_ROOT;
    // Bridge überschreiben gibt es nicht, wir testen nur die WS-Events, nicht das Warmup.
    // Dafür BRIDGE=claude lassen und einfach nie "send" aufrufen; warm-up wird durch die echte
    // Bridge getriggert, aber da kein CLAUDE_PATH -> error im Log, aber WS-Events davor kommen an.
    const result = await createServer({ port: 0 });
    server = result.server;
    port = result.port;
  });

  after(() => {
    delete process.env.ALLOW_NO_ORIGIN;
    delete process.env.VAULTS_ROOT;
    cleanup();
    server.close();
    setTimeout(() => process.exit(0), 500);
  });

  it('sendet vaults-Event mit allen konfigurierten Vaults', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const messages = await collectMessages(ws, 2);
    ws.close();

    assert.equal(messages[0].type, 'session_init');
    assert.equal(messages[1].type, 'vaults');
    assert.ok(Array.isArray(messages[1].list));
    const prefixes = messages[1].list.map(v => v.toolPrefix).sort();
    assert.deepEqual(prefixes, ['intex_regeln', 'otris']);
    // meta-fields durchgeleitet
    const otris = messages[1].list.find(v => v.toolPrefix === 'otris');
    assert.equal(otris.name, 'otris');
    assert.equal(otris.description, 'otris Docs');
  });

  it('select_vault mit unbekanntem Prefix liefert error-event', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    // Queue alle eingehenden Messages von Anfang an (bevor open gleich feuert)
    const queue = [];
    const waiters = [];
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (waiters.length) waiters.shift()(msg);
      else queue.push(msg);
    });
    function nextMsg() {
      return new Promise(resolve => {
        if (queue.length) resolve(queue.shift());
        else waiters.push(resolve);
      });
    }

    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    // session_init + vaults konsumieren
    await nextMsg();
    await nextMsg();

    ws.send(JSON.stringify({ type: 'select_vault', toolPrefix: 'does_not_exist' }));
    const next = await nextMsg();
    ws.close();

    assert.equal(next.type, 'error');
    assert.match(next.message, /Unbekannter Vault/i);
  });
});

function collectMessages(ws, count) {
  return new Promise((resolve, reject) => {
    const out = [];
    ws.on('message', data => {
      out.push(JSON.parse(data.toString()));
      if (out.length >= count) resolve(out);
    });
    ws.on('error', reject);
  });
}

function collectMessagesFromOpen(ws, count) {
  return new Promise((resolve, reject) => {
    const out = [];
    function onMessage(data) {
      out.push(JSON.parse(data.toString()));
      if (out.length >= count) {
        ws.off('message', onMessage);
        resolve(out);
      }
    }
    ws.on('message', onMessage);
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', data => resolve(JSON.parse(data.toString())));
    ws.once('error', reject);
  });
}
