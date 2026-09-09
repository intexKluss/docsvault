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

test('repeats the vault research rules for every user question', async function (t) {
  t.mock.method(console, 'log', function () {});
  var prompts = [];
  t.mock.method(Codex.prototype, 'startThread', function () {
    return {
      async run(prompt) {
        prompts.push(prompt);
      },
      async runStreamed(prompt) {
        prompts.push(prompt);
        return {
          events: createAnswerEvents()
        };
      }
    };
  });
  var bridge = new CodexBridge([
    { name: 'otris DOCUMENTS API', description: 'otris Doku.', toolPrefix: 'otris', path: '/x' }
  ], async function () {
    return { model: 'available-model', reasoningEffort: 'high' };
  });
  var session = await bridge.createSession();

  await session.warmUp();
  for await (var event of session.send('Was ist ein FormGadget?', 'fast')) {
    assert.ok(event.type);
  }

  assert.match(prompts[1], /Definitions- und Übersichtsfragen/);
  assert.match(prompts[1], /Code nur, wenn der Nutzer ausdrücklich danach fragt/);
  assert.match(prompts[1], /Was ist ein FormGadget\?/);
  await session.destroy();
});

async function* createAnswerEvents() {
  yield { type: 'item.completed', item: { type: 'agent_message', text: 'Antwort' } };
  yield { type: 'turn.completed' };
}
