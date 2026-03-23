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

  afterEach(async () => {
    await manager.shutdown();
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

  it('entfernt Session nach Inaktivitäts-Timeout', async () => {
    // sessionTimeoutMin wird in ms umgerechnet: value * 60 * 1000
    // 0.001 min = 60ms
    const shortManager = new SessionManager(mockBridge, {
      maxSessions: 3,
      sessionTimeoutMin: 0.001,
      rateLimitPerMin: 5,
      maxMessageLength: 100
    });
    await shortManager.getOrCreateSession('timeout-client');
    assert.equal(shortManager.sessionCount, 1);
    await new Promise(r => setTimeout(r, 150));
    assert.equal(shortManager.sessionCount, 0);
    await shortManager.shutdown();
  });

  it('touchSession setzt den Inaktivitäts-Timer zurück', async () => {
    const shortManager = new SessionManager(mockBridge, {
      maxSessions: 3,
      sessionTimeoutMin: 0.002,
      rateLimitPerMin: 5,
      maxMessageLength: 100
    });
    await shortManager.getOrCreateSession('touch-client');
    // nach 80ms touchen, damit der Timer (120ms) noch nicht abgelaufen ist
    await new Promise(r => setTimeout(r, 80));
    shortManager.touchSession('touch-client');
    // nach weiteren 80ms sollte die Session noch da sein (Timer wurde zurückgesetzt)
    await new Promise(r => setTimeout(r, 80));
    assert.equal(shortManager.sessionCount, 1);
    // nach dem vollen Timeout sollte sie weg sein
    await new Promise(r => setTimeout(r, 100));
    assert.equal(shortManager.sessionCount, 0);
    await shortManager.shutdown();
  });

  it('shutdown entfernt alle Sessions', async () => {
    await manager.getOrCreateSession('s1');
    await manager.getOrCreateSession('s2');
    await manager.getOrCreateSession('s3');
    assert.equal(manager.sessionCount, 3);
    await manager.shutdown();
    assert.equal(manager.sessionCount, 0);
  });

  it('validateMessage wirft bei null/undefined', () => {
    assert.throws(
      () => manager.validateMessage(null),
      { message: /leer/i }
    );
    assert.throws(
      () => manager.validateMessage(undefined),
      { message: /leer/i }
    );
  });

  it('validateMessage wirft bei nicht-string Input', () => {
    assert.throws(
      () => manager.validateMessage(42),
      { message: /string/i }
    );
    assert.throws(
      () => manager.validateMessage({}),
      { message: /string/i }
    );
  });
});
