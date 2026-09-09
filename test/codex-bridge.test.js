import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CODEX_MODEL } from '../src/codex-bridge.js';

test('uses a ChatGPT supported Codex model by default', () => {
  assert.equal(DEFAULT_CODEX_MODEL, 'gpt-5.6-luna');
});
