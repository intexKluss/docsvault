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

// kontrollierbarer bridge: warmUp blockiert bis das zurückgegebene deferred
// manuell aufgelöst wird. so lassen sich race-conditions deterministisch testen.
function controllableBridge(opts = {}) {
  const created = [];
  // optionaler gate vor dem session-build, um den createSession-phase-abbruch zu testen.
  let createReleased = !opts.gateCreate;
  let releaseCreateFn;
  const createGate = new Promise((res) => { releaseCreateFn = () => { createReleased = true; res(); }; });
  // wartet bis der n-te build createSession durchlaufen hat und in warmUp blockiert.
  async function waitForStart(n) {
    while (created.length <= n) await Promise.resolve();
    await created[n].startedPromise;
    return created[n];
  }
  const bridge = {
    created,
    waitForStart,
    releaseCreate: () => releaseCreateFn(),
    async createSession(toolPrefix) {
      if (opts.gateCreate && !createReleased) await createGate;
      let release;
      const gate = new Promise((res) => { release = res; });
      let started;
      const startedPromise = new Promise((res) => { started = res; });
      const session = {
        id: `sess-${created.length}`,
        toolPrefix,
        destroyed: false,
        ready: false,
        release,
        // resolved sobald warmUp den gate erreicht hat (deterministisches timing).
        startedPromise,
        async warmUp() {
          started();
          await gate;
          if (this.destroyed) throw new Error('destroyed during warmUp');
          this.ready = true;
        },
        async *send() {},
        async destroy() { this.destroyed = true; }
      };
      created.push(session);
      return session;
    }
  };
  return bridge;
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

  describe('vault-switch ownership guard', () => {
    it('does not clobber the selected session with a late-resolving build', async () => {
      const bridge = controllableBridge();
      const m = new SessionManager(bridge, { maxSessions: 5, rateLimitPerMin: 100, maxMessageLength: 100 });

      // build A startet und blockiert in warmUp.
      const pA = m.createAndWarmUp('c', 'vaultA');
      const sessionA = await bridge.waitForStart(0);

      // user wechselt: removeSession (bricht A ab) und build B startet.
      await m.removeSession('c');
      const pB = m.createAndWarmUp('c', 'vaultB');
      const sessionB = await bridge.waitForStart(1);

      // B wird fertig zuerst.
      sessionB.release();
      await pB;

      // jetzt löst A spät auf, darf B aber NICHT überschreiben.
      sessionA.release();
      await assert.rejects(() => pA);

      const current = m.getSessionRaw('c');
      assert.equal(current, sessionB, 'selected vault B must still own the slot');
      assert.equal(current.toolPrefix, 'vaultB');
      assert.equal(sessionA.destroyed, true, 'orphaned session A must be destroyed');
      await m.shutdown();
    });
  });

  describe('removeSession abort', () => {
    it('aborts a build that is still in the createSession phase', async () => {
      // createSession blockiert -> removeSession aktiviert den abort auf dem placeholder.
      const bridge = controllableBridge({ gateCreate: true });
      const m = new SessionManager(bridge, { maxSessions: 5, rateLimitPerMin: 100, maxMessageLength: 100 });

      const p = m.createAndWarmUp('c', 'vaultA');
      // placeholder steht im slot, createSession hängt noch.
      assert.equal(m.sessionCount, 1);

      // removeSession bricht den laufenden build ab und räumt den slot.
      await m.removeSession('c');
      assert.equal(m.sessionCount, 0);

      // createSession auflösen: ownership-guard sieht das abgebrochene signal
      // und zerstört die frisch gebaute session, statt sie einzuhängen.
      bridge.releaseCreate();
      await assert.rejects(() => p, { message: 'Session superseded' });
      assert.equal(m.sessionCount, 0);
      assert.equal(bridge.created[0].destroyed, true, 'orphaned session must be destroyed');
      await m.shutdown();
    });

    it('does not leak a session when removeSession races a warming-up build', async () => {
      const bridge = controllableBridge();
      const m = new SessionManager(bridge, { maxSessions: 5, rateLimitPerMin: 100, maxMessageLength: 100 });

      const p = m.createAndWarmUp('c', 'vaultA');
      const sessionA = await bridge.waitForStart(0);

      // build hängt in warmUp, removeSession zerstört die bereits eingehängte session.
      await m.removeSession('c');
      assert.equal(m.sessionCount, 0);
      assert.equal(sessionA.destroyed, true);

      sessionA.release();
      await assert.rejects(() => p);
      assert.equal(m.sessionCount, 0);
      await m.shutdown();
    });
  });

  describe('rate-limit reset window', () => {
    it('resets the counter after the window expires', async () => {
      const realNow = Date.now;
      let fakeNow = 1_000_000;
      Date.now = () => fakeNow;
      const m = new SessionManager(mockBridge, { maxSessions: 3, rateLimitPerMin: 2, maxMessageLength: 100 });
      try {
        m.checkRateLimit('ip');
        m.checkRateLimit('ip');
        assert.throws(() => m.checkRateLimit('ip'), { message: /zu schnell/i });
        // fenster überschreiten -> counter wird zurückgesetzt.
        fakeNow += 60001;
        assert.doesNotThrow(() => m.checkRateLimit('ip'));
      } finally {
        Date.now = realNow;
        await m.shutdown();
      }
    });
  });
});
