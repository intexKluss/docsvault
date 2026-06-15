import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

// minimaler fake-bridge für die ws-tests. warmUp ist sofort fertig, send liefert
// einen kurzen stream. deterministisch, keine echten subprozesse.
function fakeBridge() {
  return {
    async createSession(toolPrefix) {
      let ready = false;
      let destroyed = false;
      return {
        toolPrefix,
        get ready() { return ready; },
        get destroyed() { return destroyed; },
        async warmUp() { ready = true; },
        async *send() {
          yield { type: 'chunk', content: 'ok' };
          yield { type: 'done' };
        },
        async destroy() { destroyed = true; },
      };
    },
  };
}

// sammelt ws-frames bis ein frame mit einem der erwarteten typen kommt.
function waitForType(ws, types, timeoutMs = 3000) {
  const want = new Set(Array.isArray(types) ? types : [types]);
  const seen = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`timeout waiting for ${[...want].join('|')}, saw: ${seen.map(m => m.type).join(',')}`));
    }, timeoutMs);
    function onMsg(data) {
      const msg = JSON.parse(data.toString());
      seen.push(msg);
      if (want.has(msg.type)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve({ msg, seen });
      }
    }
    ws.on('message', onMsg);
  });
}

// server.test nutzt einen fixture-vault (otris-Content liegt nicht mehr im repo)
const { root: TEST_VAULTS_ROOT, cleanup: cleanupTestVaults } = createTempVaultsRoot({
  'otris': {
    meta: { name: 'otris', description: 'Test otris vault', toolPrefix: 'otris' },
    files: {
      'portalscript-api/DocFile.md': '# DocFile\n\nEine Klasse für Dateien.',
      'portalscript-api/FileType.md': '# FileType\n\nDateityp-Klasse.',
      'howtos/upload.md': '# Upload\n\nDoc-Upload Anleitung.',
    },
  },
});

describe('Server', () => {
  let server, port, baseUrl;

  before(async () => {
    process.env.ALLOW_NO_ORIGIN = 'true';
    process.env.VAULTS_ROOT = TEST_VAULTS_ROOT;
    const result = await createServer({ port: 0 });
    server = result.server;
    port = result.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    delete process.env.ALLOW_NO_ORIGIN;
    delete process.env.VAULTS_ROOT;
    cleanupTestVaults();
    server.close();
    // force exit: bridge warmup keeps event loop alive
    setTimeout(() => process.exit(0), 500);
  });

  describe('Static files', () => {
    it('serves index.html at root', async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('<!DOCTYPE html>'));
      assert.ok(text.includes('docsvault'));
    });

    it('sets CSP header', async () => {
      const res = await fetch(`${baseUrl}/`);
      const csp = res.headers.get('content-security-policy');
      assert.ok(csp);
      assert.ok(csp.includes("default-src 'self'"));
    });
  });

  describe('REST API', () => {
    it('GET /api/health returns ok', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
    });

    it('GET /api/vaults lists available vaults', async () => {
      const res = await fetch(`${baseUrl}/api/vaults`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.vaults));
      assert.ok(data.vaults.some(v => v.toolPrefix === 'otris'));
    });

    it('GET /api/otris/status returns vault status', async () => {
      const res = await fetch(`${baseUrl}/api/otris/status`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.status);
    });

    it('GET /api/otris/search requires query param', async () => {
      const res = await fetch(`${baseUrl}/api/otris/search`);
      assert.equal(res.status, 400);
    });

    it('GET /api/otris/search works with valid query', async () => {
      const res = await fetch(`${baseUrl}/api/otris/search?query=DocFile`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data));
    });

    it('GET /api/otris/search clamps max_results', async () => {
      const res = await fetch(`${baseUrl}/api/otris/search?query=test&max_results=999999`);
      assert.equal(res.status, 200);
    });

    it('GET /api/otris/search handles non-numeric max_results', async () => {
      const res = await fetch(`${baseUrl}/api/otris/search?query=test&max_results=abc`);
      assert.equal(res.status, 200);
    });

    it('GET /api/otris/read requires path param', async () => {
      const res = await fetch(`${baseUrl}/api/otris/read`);
      assert.equal(res.status, 400);
    });

    it('GET /api/otris/read returns 404 for missing doc', async () => {
      const res = await fetch(`${baseUrl}/api/otris/read?path=nonexistent/doc`);
      assert.equal(res.status, 404);
    });

    it('GET /api/otris/list requires section param', async () => {
      const res = await fetch(`${baseUrl}/api/otris/list`);
      assert.equal(res.status, 400);
    });

    it('GET /api/otris/overview works without params', async () => {
      const res = await fetch(`${baseUrl}/api/otris/overview`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.text);
    });

    it('GET /api/otris/search rejects empty query', async () => {
      const res = await fetch(`${baseUrl}/api/otris/search?query=`);
      assert.equal(res.status, 400);
    });

    it('GET /api/otris/search rejects whitespace query', async () => {
      const res = await fetch(`${baseUrl}/api/otris/search?query=%20%20`);
      assert.equal(res.status, 400);
    });

    it('GET /api/otris/list returns array for valid section', async () => {
      const res = await fetch(`${baseUrl}/api/otris/list?section=portalscript-api`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data));
    });
  });

  describe('WebSocket', () => {
    it('accepts connections and sends session_init', async () => {
      const { default: WebSocket } = await import('ws');
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const msg = await new Promise((resolve, reject) => {
        ws.on('message', data => resolve(JSON.parse(data.toString())));
        ws.on('error', reject);
      });
      assert.equal(msg.type, 'session_init');
      ws.close();
    });

    // der server-ip-fall: seite wird über irgendeine ip/domain aufgerufen die
    // weder localhost noch ALLOWED_ORIGINS ist. same-origin (Origin-host ==
    // Host-header) muss trotzdem reinkommen, sonst ist der web-chat auf jedem
    // deployment ohne exakt passendes ALLOWED_ORIGINS tot.
    it('accepts same-origin connections for arbitrary hosts', async () => {
      const { default: WebSocket } = await import('ws');
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { Host: `testserver.intern:${port}` },
        origin: `http://testserver.intern:${port}`,
      });
      const msg = await new Promise((resolve, reject) => {
        ws.on('message', data => resolve(JSON.parse(data.toString())));
        ws.on('error', reject);
      });
      assert.equal(msg.type, 'session_init');
      ws.close();
    });

    it('rejects cross-origin connections', async () => {
      const { default: WebSocket } = await import('ws');
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        origin: 'http://evil.example',
      });
      const result = await new Promise((resolve) => {
        ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
        ws.on('error', () => resolve({ status: 'error' }));
        ws.on('open', () => resolve({ status: 'open' }));
      });
      assert.notEqual(result.status, 'open');
      ws.close();
    });
  });

  describe('MCP endpoints', () => {
    it('GET /mcp returns 405', async () => {
      const res = await fetch(`${baseUrl}/mcp`);
      assert.equal(res.status, 405);
    });

    it('DELETE /mcp returns 405', async () => {
      const res = await fetch(`${baseUrl}/mcp`, { method: 'DELETE' });
      assert.equal(res.status, 405);
    });
  });

  // eigener server mit injiziertem fake-bridge und 2 vaults (kein auto-warmup,
  // select_vault wird gebraucht). low rate-limit für den spam-test.
  describe('WebSocket select_vault + ordering', () => {
    let fbServer, fbPort;
    let fbCleanup;
    let WebSocket;

    before(async () => {
      ({ default: WebSocket } = await import('ws'));
      const { root, cleanup } = createTempVaultsRoot({
        'va': { meta: { name: 'va', description: 'Vault A', toolPrefix: 'va' }, files: { 'x/a.md': '# A' } },
        'vb': { meta: { name: 'vb', description: 'Vault B', toolPrefix: 'vb' }, files: { 'x/b.md': '# B' } },
      });
      fbCleanup = cleanup;
      process.env.VAULTS_ROOT = root;
      process.env.RATE_LIMIT_PER_MIN = '3';
      const result = await createServer({ port: 0, bridge: fakeBridge() });
      fbServer = result.server;
      fbPort = result.port;
    });

    after(() => {
      delete process.env.RATE_LIMIT_PER_MIN;
      process.env.VAULTS_ROOT = TEST_VAULTS_ROOT;
      fbCleanup();
      fbServer.close();
    });

    function connect() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${fbPort}`);
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
      });
    }

    // läuft VOR dem spam-test, damit das per-IP rate-limit noch budget hat.
    it('does not lock the vault selector after a rejected first message', async () => {
      const ws = await connect();
      // erste nachricht ist ungültig (leer) -> validierung schlägt fehl (vor dem
      // rate-limit, verbraucht also kein budget). messageSent darf NICHT gesetzt werden.
      const errP = waitForType(ws, ['error'], 3000);
      ws.send(JSON.stringify({ type: 'message', content: '   ' }));
      const { msg: err } = await errP;
      assert.match(err.message, /leer/i);

      // select_vault muss danach noch funktionieren (selector nicht gelockt).
      const readyP = waitForType(ws, ['session_ready', 'error'], 3000);
      ws.send(JSON.stringify({ type: 'select_vault', toolPrefix: 'va' }));
      const { msg: ready } = await readyP;
      assert.equal(ready.type, 'session_ready');
      assert.equal(ready.toolPrefix, 'va');
      ws.close();
    });

    it('rate-limits select_vault spam', async () => {
      const ws = await connect();
      // rate-limit ist 3/min pro IP. abwechselnd va/vb wählen, damit kein
      // duplikat-drop greift. sobald das budget aufgebraucht ist kommt der throttle.
      let throttled = false;
      for (let i = 0; i < 6; i++) {
        const prefix = i % 2 === 0 ? 'va' : 'vb';
        const p = waitForType(ws, ['session_ready', 'error'], 3000);
        ws.send(JSON.stringify({ type: 'select_vault', toolPrefix: prefix }));
        const { msg } = await p;
        if (msg.type === 'error' && /zu schnell/i.test(msg.message)) {
          throttled = true;
          break;
        }
      }
      assert.ok(throttled, 'select_vault spam must hit the rate limit');
      ws.close();
    });
  });
});
