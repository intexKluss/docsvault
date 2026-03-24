import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../src/session-manager.js';

const mockBridge = {
  async createSession() {
    return {
      id: 'test-id',
      destroyed: false,
      ready: true,
      async warmUp() {},
      async *send(content, mode) {
        yield { type: 'chunk', content: 'test' };
        yield { type: 'done' };
      },
      async destroy() { this.destroyed = true; }
    };
  }
};

function failingBridge(error) {
  return {
    async createSession() {
      return {
        id: 'fail-id',
        destroyed: false,
        ready: false,
        async warmUp() { throw new Error(error); },
        async *send() {},
        async destroy() { this.destroyed = true; }
      };
    }
  };
}

describe('SessionManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SessionManager(mockBridge, {
      maxSessions: 3,
      rateLimitPerMin: 5,
      maxMessageLength: 100,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  describe('createAndWarmUp', () => {
    it('creates a session and warms it up', async () => {
      const session = await manager.createAndWarmUp('client-1');
      assert.ok(session);
      assert.equal(session.ready, true);
      assert.equal(manager.sessionCount, 1);
    });

    it('rejects when maxSessions reached', async () => {
      await manager.createAndWarmUp('c1');
      await manager.createAndWarmUp('c2');
      await manager.createAndWarmUp('c3');
      await assert.rejects(
        () => manager.createAndWarmUp('c4'),
        { message: 'Max sessions reached' }
      );
    });

    it('cleans up on warmUp failure', async () => {
      const m = new SessionManager(failingBridge('warmup failed'), {
        maxSessions: 3,
        rateLimitPerMin: 5,
        maxMessageLength: 100,
      });
      await assert.rejects(
        () => m.createAndWarmUp('fail-client'),
        { message: 'warmup failed' }
      );
      assert.equal(m.sessionCount, 0);
      await m.shutdown();
    });
  });

  describe('getSession', () => {
    it('returns session after warmup', async () => {
      await manager.createAndWarmUp('client-1');
      const session = manager.getSession('client-1');
      assert.ok(session);
      assert.equal(session.ready, true);
    });

    it('returns null for unknown client', () => {
      assert.equal(manager.getSession('unknown'), null);
    });
  });

  describe('removeSession', () => {
    it('removes and destroys session', async () => {
      const session = await manager.createAndWarmUp('client-1');
      assert.equal(manager.sessionCount, 1);
      await manager.removeSession('client-1');
      assert.equal(manager.sessionCount, 0);
    });

    it('handles removing non-existent session', async () => {
      await manager.removeSession('nonexistent');
      assert.equal(manager.sessionCount, 0);
    });
  });

  describe('validateMessage', () => {
    it('accepts valid string', () => {
      assert.doesNotThrow(() => manager.validateMessage('hello'));
    });

    it('rejects null', () => {
      assert.throws(
        () => manager.validateMessage(null),
        { message: /leer/i }
      );
    });

    it('rejects undefined', () => {
      assert.throws(
        () => manager.validateMessage(undefined),
        { message: /leer/i }
      );
    });

    it('rejects non-string', () => {
      assert.throws(
        () => manager.validateMessage(42),
        { message: /string/i }
      );
      assert.throws(
        () => manager.validateMessage({}),
        { message: /string/i }
      );
    });

    it('rejects empty string', () => {
      assert.throws(
        () => manager.validateMessage('   '),
        { message: /leer/i }
      );
    });

    it('rejects too long message', () => {
      assert.throws(
        () => manager.validateMessage('a'.repeat(101)),
        { message: /zu lang/i }
      );
    });

    it('accepts message at exact limit', () => {
      assert.doesNotThrow(() => manager.validateMessage('a'.repeat(100)));
    });
  });

  describe('checkRateLimit', () => {
    it('allows up to limit', () => {
      for (let i = 0; i < 5; i++) {
        assert.doesNotThrow(() => manager.checkRateLimit('192.168.1.1'));
      }
    });

    it('blocks after limit exceeded', () => {
      for (let i = 0; i < 5; i++) {
        manager.checkRateLimit('192.168.1.1');
      }
      assert.throws(
        () => manager.checkRateLimit('192.168.1.1'),
        { message: /zu schnell/i }
      );
    });

    it('tracks IPs independently', () => {
      for (let i = 0; i < 5; i++) {
        manager.checkRateLimit('192.168.1.1');
      }
      assert.doesNotThrow(() => manager.checkRateLimit('192.168.1.2'));
    });
  });

  describe('shutdown', () => {
    it('removes all sessions', async () => {
      await manager.createAndWarmUp('s1');
      await manager.createAndWarmUp('s2');
      await manager.createAndWarmUp('s3');
      assert.equal(manager.sessionCount, 3);
      await manager.shutdown();
      assert.equal(manager.sessionCount, 0);
    });
  });
});
