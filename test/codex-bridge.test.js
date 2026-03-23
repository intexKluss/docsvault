import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CodexBridge } from '../src/codex-bridge.js';

// alle events aus async generator sammeln
async function collect(gen) {
  const results = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe('CodexBridge', () => {
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

  describe('createSession', () => {
    it('erstellt session mit id', async () => {
      const bridge = new CodexBridge();
      const session = await bridge.createSession();
      assert.ok(session.id);
      assert.equal(session.destroyed, false);
    });

    it('destroyed session wirft bei send', async () => {
      const bridge = new CodexBridge();
      const session = await bridge.createSession();
      await session.destroy();
      assert.equal(session.destroyed, true);
      await assert.rejects(
        () => collect(session.send('test', 'fast')),
        { message: 'Session destroyed' }
      );
    });
  });
});
