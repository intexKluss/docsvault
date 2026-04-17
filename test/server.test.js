import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

describe('Server', () => {
  let server, port, baseUrl;

  before(async () => {
    process.env.ALLOW_NO_ORIGIN = 'true';
    const result = await createServer({ port: 0 });
    server = result.server;
    port = result.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    delete process.env.ALLOW_NO_ORIGIN;
    server.close();
    // force exit — bridge warmup keeps event loop alive
    setTimeout(() => process.exit(0), 500);
  });

  describe('Static files', () => {
    it('serves index.html at root', async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('<!DOCTYPE html>'));
      assert.ok(text.includes('otris docs assistant'));
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
});
