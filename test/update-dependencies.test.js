import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { updateDependencies } from '../scripts/update-dependencies.js';

test('updates requested direct dependencies and verifies the result', function (t) {
  t.mock.method(console, 'log', () => {});
  var calls = [];
  var packages = {
    '@openai/codex-sdk': '^0.153.4',
    zod: '^4.5.4'
  };

  function runCommand(command, args) {
    calls.push([command, args]);
    return { status: 0 };
  }

  var exitCode = updateDependencies(['@openai/codex-sdk', 'zod'], packages, runCommand);

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    ['npm', ['install', '@openai/codex-sdk@latest']],
    ['npm', ['install', 'zod@latest']],
    ['npm', ['ls']],
    ['npm', ['test']],
    ['docker', ['build', '--platform', 'linux/amd64', '-t', 'docsvault-dependency-check', '.']]
  ]);
});

test('rejects unknown packages before npm changes anything', function (t) {
  t.mock.method(console, 'error', () => {});
  var calls = [];
  function runCommand(command, args) {
    calls.push([command, args]);
    return { status: 0 };
  }

  var exitCode = updateDependencies(['express'], {}, runCommand);

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
});

test('stops after a failed update', function (t) {
  t.mock.method(console, 'log', () => {});
  var calls = [];
  var packages = { zod: '^4.5.4' };

  function runCommand(command, args) {
    calls.push([command, args]);
    return { status: 2 };
  }

  var exitCode = updateDependencies(['zod'], packages, runCommand);

  assert.equal(exitCode, 2);
  assert.deepEqual(calls, [['npm', ['install', 'zod@latest']]]);
});

test('starts npm without a shell', () => {
  var script = readFileSync(new URL('../scripts/update-dependencies.js', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /shell:/);
  assert.match(script, /npm-cli\.js/);
});
