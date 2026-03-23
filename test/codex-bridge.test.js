import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// We test the CodexBridge class. Since the SDK requires auth,
// we test the reasoning effort mapping and the interface contract.

import { CodexBridge } from '../src/codex-bridge.js';

describe('CodexBridge', () => {
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

  it('hat createSession methode', () => {
    const bridge = new CodexBridge();
    assert.equal(typeof bridge.createSession, 'function');
  });
});
