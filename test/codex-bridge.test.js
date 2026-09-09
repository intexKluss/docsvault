import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Codex } from '@openai/codex-sdk';
import { CodexBridge } from '../src/codex-bridge.js';

test('uses the selected model and shares one check across concurrent sessions', async function (t) {
  t.mock.method(console, 'log', function () {});
  var threadOptions = [];
  t.mock.method(Codex.prototype, 'startThread', function (options) {
    threadOptions.push(options);
    return {};
  });
  var checks = 0;
  var bridge = new CodexBridge([], async function () {
    checks++;
    return { model: 'available-model', reasoningEffort: 'high' };
  });

  var sessions = await Promise.all([bridge.createSession(), bridge.createSession()]);

  assert.equal(checks, 1);
  assert.equal(threadOptions.length, 2);
  for (var options of threadOptions) {
    assert.equal(options.model, 'available-model');
    assert.equal(options.modelReasoningEffort, 'high');
    assert.equal(options.sandboxMode, 'read-only');
    assert.equal(options.webSearchEnabled, false);
  }
  for (var session of sessions) await session.destroy();
});

test('retries the model check after login or connection failure', async function (t) {
  t.mock.method(console, 'log', function () {});
  t.mock.method(Codex.prototype, 'startThread', function () { return {}; });
  var checks = 0;
  var bridge = new CodexBridge([], async function () {
    checks++;
    if (checks === 1) throw new Error('Codex Login fehlt');
    return { model: 'available-model', reasoningEffort: 'low' };
  });

  await assert.rejects(bridge.createSession(), /Codex Login fehlt/);
  var session = await bridge.createSession();

  assert.equal(checks, 2);
  await session.destroy();
});
