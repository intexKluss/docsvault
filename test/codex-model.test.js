import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { resolveCodexModel } from '../src/codex-model.js';

test('keeps the configured model and supported reasoning effort', async function () {
  var fixture = createServer({ models: [model('preferred'), model('recommended', true)] });
  var selection = await resolveCodexModel({
    spawn: fixture.spawn,
    runtime: { execPath: process.execPath, env: { CODEX_MODEL: 'preferred', CODEX_REASONING_EFFORT: 'high' } }
  });

  assert.deepEqual(selection, { model: 'preferred', reasoningEffort: 'high' });
  assert.equal(fixture.closed, true);
  assert.deepEqual(fixture.requests, ['initialize', 'initialized', 'account/read', 'model/list']);
});

test('keeps the current default model when it is available', async function () {
  var fixture = createServer({ models: [model('recommended', true), model('gpt-5.6-luna')] });
  var selection = await resolveCodexModel({ spawn: fixture.spawn, runtime: { execPath: process.execPath, env: {} } });

  assert.equal(selection.model, 'gpt-5.6-luna');
  assert.equal(selection.reasoningEffort, 'low');
});

test('automatically falls back to the recommended visible text model', async function () {
  var fixture = createServer({ models: [model('first'), model('recommended', true)] });
  var selection = await resolveCodexModel({ spawn: fixture.spawn, runtime: { execPath: process.execPath, env: { CODEX_MODEL: 'removed' } } });

  assert.equal(selection.model, 'recommended');
});

test('uses the first usable model when no recommendation exists', async function () {
  var hidden = model('hidden', true);
  hidden.hidden = true;
  var audio = model('audio', true);
  audio.inputModalities = ['audio'];
  var fixture = createServer({ models: [hidden, audio, model('usable')] });
  var selection = await resolveCodexModel({ spawn: fixture.spawn });

  assert.equal(selection.model, 'usable');
});

test('replaces an unsupported reasoning effort with the model default', async function () {
  var fixture = createServer({ models: [model('recommended', true)] });
  var selection = await resolveCodexModel({ spawn: fixture.spawn, runtime: { execPath: process.execPath, env: { CODEX_REASONING_EFFORT: 'ultra' } } });

  assert.equal(selection.reasoningEffort, 'low');
});

test('reads all model pages before selecting a fallback', async function () {
  var fixture = createServer({ pages: [
    { data: [model('first', true)], nextCursor: 'next' },
    { data: [model('gpt-5.6-luna')], nextCursor: null }
  ] });
  var selection = await resolveCodexModel({ spawn: fixture.spawn, runtime: { execPath: process.execPath, env: {} } });

  assert.equal(selection.model, 'gpt-5.6-luna');
  assert.equal(fixture.modelParams[1].cursor, 'next');
});

test('rejects missing authentication before listing models', async function () {
  var fixture = createServer({ account: null });

  await assert.rejects(resolveCodexModel({ spawn: fixture.spawn }), /Codex Login/);
  assert.equal(fixture.modelParams.length, 0);
  assert.equal(fixture.closed, true);
});

test('rejects empty or unusable model catalogs', async function () {
  var fixture = createServer({ models: [] });

  await assert.rejects(resolveCodexModel({ spawn: fixture.spawn }), /kein.*Modell/i);
  assert.equal(fixture.closed, true);
});

test('surfaces protocol errors and closes the subprocess', async function () {
  var fixture = createServer({ error: { code: -1, message: 'model service unavailable' } });

  await assert.rejects(resolveCodexModel({ spawn: fixture.spawn }), /model service unavailable/);
  assert.equal(fixture.closed, true);
});

test('rejects malformed model responses', async function () {
  var fixture = createServer({ pages: [{ data: 'invalid' }] });

  await assert.rejects(resolveCodexModel({ spawn: fixture.spawn }), /Modellantwort/);
});

test('bounds a stalled request and closes the subprocess', async function () {
  var fixture = createServer({ stall: true });

  await assert.rejects(resolveCodexModel({ spawn: fixture.spawn, timeoutMs: 20 }), /Zeitlimit/);
  assert.equal(fixture.closed, true);
});

test('uses CODEX_PATH directly without a shell', async function () {
  var fixture = createServer({ models: [model('available', true)] });
  await resolveCodexModel({ spawn: fixture.spawn, runtime: { execPath: process.execPath, env: { CODEX_PATH: 'C:\\Codex Tools\\codex.exe' } } });

  assert.equal(fixture.command, 'C:\\Codex Tools\\codex.exe');
  assert.deepEqual(fixture.args, ['app-server', '--listen', 'stdio://']);
  assert.equal(fixture.options.shell, undefined);
  assert.equal(fixture.options.windowsHide, true);
});

test('settles a timed out request even if the subprocess never closes', async function () {
  var fixture = createServer({ stall: true, keepAlive: true });
  var result = resolveCodexModel({ spawn: fixture.spawn, timeoutMs: 10 });
  var outcome = result.then(function () { return 'resolved'; }, function (error) { return error.message; });
  var deadline = new Promise(function (resolve) { setTimeout(function () { resolve('still pending'); }, 1300); });

  assert.match(await Promise.race([outcome, deadline]), /Zeitlimit/);
});

test('allows providers that do not require OpenAI authentication', async function () {
  var fixture = createServer({ account: null, requiresOpenaiAuth: false, models: [model('local', true)] });
  var selection = await resolveCodexModel({ spawn: fixture.spawn });

  assert.equal(selection.model, 'local');
});

test('rejects malformed reasoning entries and empty model names', async function () {
  var invalidModels = [model('broken'), model('broken'), model('')];
  invalidModels[0].supportedReasoningEfforts = [{}];
  invalidModels[1].supportedReasoningEfforts = [null];
  for (var invalidModel of invalidModels) {
    var fixture = createServer({ models: [invalidModel] });
    await assert.rejects(resolveCodexModel({ spawn: fixture.spawn }), /Modellantwort/);
  }
});

function createServer(options) {
  var fixture = { closed: false, requests: [], modelParams: [] };
  fixture.spawn = function (command, args, spawnOptions) {
    fixture.command = command;
    fixture.args = args;
    fixture.options = spawnOptions;
    var child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write: function (chunk, encoding, callback) {
        var message = JSON.parse(chunk.toString());
        fixture.requests.push(message.method);
        callback();
        if (options.stall || message.method === 'initialized') return;
        var response = { id: message.id, result: {} };
        if (message.method === 'account/read') {
          response.result = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
          if (Object.hasOwn(options, 'account')) response.result.account = options.account;
          if (Object.hasOwn(options, 'requiresOpenaiAuth')) response.result.requiresOpenaiAuth = options.requiresOpenaiAuth;
        }
        if (message.method === 'model/list') {
          fixture.modelParams.push(message.params);
          response.result = { data: options.models, nextCursor: null };
          if (options.pages) response.result = options.pages[fixture.modelParams.length - 1];
          if (options.error) response = { id: message.id, error: options.error };
        }
        setImmediate(function () { child.stdout.write(JSON.stringify(response) + '\n'); });
      },
      final: function (callback) {
        fixture.closed = true;
        callback();
        if (options.keepAlive) return;
        setImmediate(function () { child.stdout.end(); child.emit('close', 0); });
      }
    });
    child.kill = function () {
      if (options.keepAlive) return;
      fixture.closed = true;
      child.emit('close', null);
    };
    child.unref = function () {};
    return child;
  };
  return fixture;
}

function model(name, isDefault = false) {
  return {
    model: name,
    hidden: false,
    isDefault: isDefault,
    inputModalities: ['text', 'image'],
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }]
  };
}
