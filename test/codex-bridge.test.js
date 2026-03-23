import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CodexBridge } from '../src/codex-bridge.js';

// hilfsfunktion: async generator aus array
async function* asyncGen(items) {
  for (const item of items) {
    yield item;
  }
}

// mock sdk erstellen
function createMockSdk(streamEvents = []) {
  return {
    startThread() {
      return {
        runStreamed(_content, _opts) {
          return asyncGen(streamEvents);
        }
      };
    }
  };
}

// alle events aus async generator sammeln
async function collect(gen) {
  const results = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe('CodexBridge', () => {
  // reasoning effort mapping
  describe('getReasoningEffort', () => {
    it('mappt mode fast zu reasoning_effort low', () => {
      const bridge = new CodexBridge();
      assert.equal(bridge.getReasoningEffort('fast'), 'low');
    });

    it('mappt mode thorough zu reasoning_effort high', () => {
      const bridge = new CodexBridge();
      assert.equal(bridge.getReasoningEffort('thorough'), 'high');
    });

    it('default mode ist high', () => {
      const bridge = new CodexBridge();
      assert.equal(bridge.getReasoningEffort('unknown'), 'high');
    });
  });

  // event mapping
  describe('event mapping', () => {
    it('mappt tool_use events', async () => {
      const sdk = createMockSdk([
        { type: 'tool_use', name: 'search' },
        { type: 'turn_completed' }
      ]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.deepEqual(events[0], { type: 'tool_use', tool: 'search', status: 'running' });
    });

    it('mappt tool_result events', async () => {
      const sdk = createMockSdk([
        { type: 'tool_result', name: 'search' },
        { type: 'turn_completed' }
      ]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.deepEqual(events[0], { type: 'tool_use', tool: 'search', status: 'done' });
    });

    it('mappt text_delta zu chunk', async () => {
      const sdk = createMockSdk([
        { type: 'text_delta', text: 'hello' },
        { type: 'turn_completed' }
      ]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.deepEqual(events[0], { type: 'chunk', content: 'hello' });
    });

    it('mappt turn_completed zu done', async () => {
      const sdk = createMockSdk([
        { type: 'turn_completed' }
      ]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.deepEqual(events, [{ type: 'done' }]);
    });

    it('mappt error events', async () => {
      const sdk = createMockSdk([
        { type: 'error', message: 'something went wrong' },
        { type: 'turn_completed' }
      ]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.deepEqual(events[0], { type: 'error', message: 'something went wrong' });
    });
  });

  // auth error sanitization
  describe('auth error handling', () => {
    it('sanitisiert auth error in stream events', async () => {
      const sdk = createMockSdk([
        { type: 'error', message: 'invalid auth token' },
        { type: 'turn_completed' }
      ]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.equal(events[0].type, 'error');
      assert.ok(!events[0].message.includes('auth'));
      assert.ok(events[0].message.includes('temporär'));
    });

    it('sanitisiert auth error bei sdk import', async () => {
      const badSdk = {
        startThread() {
          throw new Error('invalid auth credentials');
        }
      };
      const bridge = new CodexBridge();
      await assert.rejects(
        () => bridge.createSession(badSdk),
        (err) => {
          assert.ok(!err.message.includes('auth'));
          assert.ok(err.message.includes('temporär'));
          return true;
        }
      );
    });

    it('sanitisiert unauthorized error bei startThread', async () => {
      const badSdk = {
        startThread() {
          throw new Error('unauthorized request');
        }
      };
      const bridge = new CodexBridge();
      await assert.rejects(
        () => bridge.createSession(badSdk),
        (err) => {
          assert.ok(!err.message.includes('unauthorized'));
          assert.ok(err.message.includes('temporär'));
          return true;
        }
      );
    });

    it('sanitisiert auth error bei runStreamed', async () => {
      const sdk = {
        startThread() {
          return {
            runStreamed() {
              throw new Error('api key invalid');
            }
          };
        }
      };
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'error');
      assert.ok(events[0].message.includes('temporär'));
    });

    it('wirft nicht-auth errors unverändert weiter', async () => {
      const badSdk = {
        startThread() {
          throw new Error('network timeout');
        }
      };
      const bridge = new CodexBridge();
      await assert.rejects(
        () => bridge.createSession(badSdk),
        (err) => {
          assert.equal(err.message, 'network timeout');
          return true;
        }
      );
    });
  });

  // destroyed session
  describe('destroyed session', () => {
    it('wirft error bei send nach destroy', async () => {
      const sdk = createMockSdk([]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);

      await session.destroy();
      assert.equal(session.destroyed, true);

      await assert.rejects(
        () => collect(session.send('test', 'fast')),
        (err) => {
          assert.equal(err.message, 'Session destroyed');
          return true;
        }
      );
    });
  });

  // fallback done event
  describe('fallback done event', () => {
    it('emittiert done wenn stream ohne turn_completed endet', async () => {
      const sdk = createMockSdk([
        { type: 'text_delta', text: 'hello' }
        // kein turn_completed
      ]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.equal(events.length, 2);
      assert.deepEqual(events[0], { type: 'chunk', content: 'hello' });
      assert.deepEqual(events[1], { type: 'done' });
    });

    it('emittiert kein doppeltes done wenn turn_completed vorhanden', async () => {
      const sdk = createMockSdk([
        { type: 'text_delta', text: 'hello' },
        { type: 'turn_completed' }
      ]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      const doneEvents = events.filter(e => e.type === 'done');
      assert.equal(doneEvents.length, 1);
    });

    it('emittiert done bei leerem stream', async () => {
      const sdk = createMockSdk([]);
      const bridge = new CodexBridge();
      const session = await bridge.createSession(sdk);
      const events = await collect(session.send('test', 'fast'));

      assert.deepEqual(events, [{ type: 'done' }]);
    });
  });
});
