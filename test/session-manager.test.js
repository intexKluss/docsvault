import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../src/session-manager.js';

// mock codex bridge
const mockBridge = {
  async createSession() {
    return {
      id: 'test-id',
      destroyed: false,
      async *send(content, mode) {
        yield { type: 'chunk', content: 'test' };
        yield { type: 'done' };
      },
      async destroy() { this.destroyed = true; }
    };
  }
};

describe('SessionManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SessionManager(mockBridge, {
      maxSessions: 3,
      sessionTimeoutMin: 1,
      rateLimitPerMin: 5,
      maxMessageLength: 100
    });
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('erstellt eine Session für einen neuen Client', async () => {
    const session = await manager.getOrCreateSession('client-1');
    assert.ok(session);
  });

  it('gibt dieselbe Session für denselben Client zurück', async () => {
    const s1 = await manager.getOrCreateSession('client-1');
    const s2 = await manager.getOrCreateSession('client-1');
    assert.equal(s1.id, s2.id);
  });

  it('lehnt ab wenn maxSessions erreicht', async () => {
    await manager.getOrCreateSession('c1');
    await manager.getOrCreateSession('c2');
    await manager.getOrCreateSession('c3');
    await assert.rejects(
      () => manager.getOrCreateSession('c4'),
      { message: /max sessions/i }
    );
  });

  it('entfernt Session bei disconnect nach grace period', async () => {
    await manager.getOrCreateSession('client-1');
    manager.scheduleRemoval('client-1', 50);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(manager.sessionCount, 0);
  });

  it('bricht removal ab wenn Client reconnected', async () => {
    await manager.getOrCreateSession('client-1');
    manager.scheduleRemoval('client-1', 200);
    manager.cancelRemoval('client-1');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(manager.sessionCount, 1);
  });

  it('validiert Nachrichtenlänge', () => {
    const long = 'a'.repeat(101);
    assert.throws(
      () => manager.validateMessage(long),
      { message: /zu lang/i }
    );
  });

  it('rate-limited pro IP', () => {
    for (let i = 0; i < 5; i++) {
      manager.checkRateLimit('192.168.1.1');
    }
    assert.throws(
      () => manager.checkRateLimit('192.168.1.1'),
      { message: /rate limit/i }
    );
  });
});
