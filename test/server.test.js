import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

describe('Server', () => {
  let server, port, baseUrl;

  before(async () => {
    const result = await createServer({ port: 0 });
    server = result.server;
    port = result.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    });
  });

  it('liefert statische Dateien aus (GET / gibt HTML)', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('<!DOCTYPE html>'));
    assert.ok(text.includes('otris docs assistant'));
  });

  it('akzeptiert WebSocket-Verbindungen', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}?sid=test-connect`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
  });

  it('sendet ready-Nachricht mit sid bei Verbindung', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}?sid=my-session-id`);
    const msg = await new Promise((resolve, reject) => {
      ws.on('message', data => resolve(JSON.parse(data.toString())));
      ws.on('error', reject);
    });
    assert.equal(msg.type, 'ready');
    assert.equal(msg.sid, 'my-session-id');
    ws.close();
  });

  it('generiert neue sid wenn keine angegeben', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msg = await new Promise((resolve, reject) => {
      ws.on('message', data => resolve(JSON.parse(data.toString())));
      ws.on('error', reject);
    });
    assert.equal(msg.type, 'ready');
    assert.ok(msg.sid);
    assert.ok(msg.sid.length > 0);
    ws.close();
  });
});
