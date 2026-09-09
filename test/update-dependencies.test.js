import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { updateDependencies } from '../scripts/update-dependencies.js';

test('updates unique direct dependencies in one install and runs every gate', function (t) {
  t.mock.method(console, 'log', function () {});
  var calls = [];
  var packages = {
    '@openai/codex-sdk': '^0.153.4',
    zod: '^4.5.4'
  };

  function spawn(command, args, options) {
    calls.push([command, args, options]);
    return { status: 0 };
  }

  var runtime = {
    execPath: 'C:\\nodejs\\node.exe',
    platform: 'win32'
  };
  var exitCode = updateDependencies(
    ['@openai/codex-sdk', 'zod', '@openai/codex-sdk'],
    packages,
    spawn,
    runtime
  );
  var imageTag = calls[5][1][4];

  assert.equal(exitCode, 0);
  assert.match(imageTag, /^docsvault-dependency-check:[0-9a-f-]{36}$/);
  assert.deepEqual(calls, [
    [runtime.execPath, [
      'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      'install',
      '@openai/codex-sdk@latest',
      'zod@latest'
    ], { stdio: 'inherit' }],
    [runtime.execPath, [
      'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      'ls'
    ], { stdio: 'inherit' }],
    [runtime.execPath, [
      'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      'audit',
      '--omit=dev',
      '--audit-level=high'
    ], { stdio: 'inherit' }],
    [runtime.execPath, [
      'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      'test'
    ], { stdio: 'inherit' }],
    [runtime.execPath, [fileURLToPath(new URL('../src/codex-model.js', import.meta.url))], { stdio: 'inherit' }],
    ['docker', [
      'build',
      '--platform',
      'linux/amd64',
      '-t',
      imageTag,
      '.'
    ], { stdio: 'inherit' }],
    ['docker', ['image', 'rm', imageTag], { stdio: 'inherit' }]
  ]);
});

test('rejects unknown packages before npm changes anything', function (t) {
  t.mock.method(console, 'error', function () {});
  var calls = [];
  function spawn(command, args, options) {
    calls.push([command, args, options]);
    return { status: 0 };
  }

  var exitCode = updateDependencies(['express'], {}, spawn, process);

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
});

test('stops after a failed update', function (t) {
  t.mock.method(console, 'log', function () {});
  var calls = [];
  var packages = { zod: '^4.5.4' };

  function spawn(command, args, options) {
    calls.push([command, args, options]);
    return { status: 2 };
  }

  var exitCode = updateDependencies(['zod'], packages, spawn, process);

  assert.equal(exitCode, 2);
  assert.equal(calls.length, 1);
});

test('removes its temporary image after a failed build', function (t) {
  t.mock.method(console, 'log', function () {});
  var calls = [];
  var packages = { zod: '^4.5.4' };

  function spawn(command, args, options) {
    calls.push([command, args, options]);
    if (command === 'docker' && args[0] === 'build') return { status: 3 };
    return { status: 0 };
  }

  var exitCode = updateDependencies(['zod'], packages, spawn, process);
  var buildCall = calls[calls.length - 2];
  var cleanupCall = calls[calls.length - 1];
  var imageTag = buildCall[1][4];

  assert.equal(exitCode, 3);
  assert.deepEqual(cleanupCall, [
    'docker',
    ['image', 'rm', imageTag],
    { stdio: 'inherit' }
  ]);
});

test('fails when a successful build cannot be cleaned up', function (t) {
  t.mock.method(console, 'log', function () {});
  var packages = { zod: '^4.5.4' };

  function spawn(command, args) {
    if (command === 'docker' && args[0] === 'image') return { status: 4 };
    return { status: 0 };
  }

  var exitCode = updateDependencies(['zod'], packages, spawn, process);

  assert.equal(exitCode, 4);
});

test('spawns npm without a shell on non-Windows platforms', function (t) {
  t.mock.method(console, 'log', function () {});
  var calls = [];
  var packages = { zod: '^4.5.4' };

  function spawn(command, args, options) {
    calls.push([command, args, options]);
    return { status: 0 };
  }

  updateDependencies(['zod'], packages, spawn, {
    execPath: '/usr/bin/node',
    platform: 'linux'
  });

  assert.deepEqual(calls[0], [
    'npm',
    ['install', 'zod@latest'],
    { stdio: 'inherit' }
  ]);
});

test('rejects inherited toString before spawning commands', function (t) {
  t.mock.method(console, 'error', function () {});
  t.mock.method(console, 'log', function () {});
  var calls = [];
  function spawn(command, args, options) {
    calls.push([command, args, options]);
    return { status: 0 };
  }

  var exitCode = updateDependencies(['toString'], {}, spawn, process);

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
});

test('rejects inherited constructor before spawning commands', function (t) {
  t.mock.method(console, 'error', function () {});
  t.mock.method(console, 'log', function () {});
  var calls = [];
  function spawn(command, args, options) {
    calls.push([command, args, options]);
    return { status: 0 };
  }

  var exitCode = updateDependencies(['constructor'], {}, spawn, process);

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
});

test('stops before Docker when the model check fails', function (t) {
  t.mock.method(console, 'log', function () {});
  var calls = [];
  function spawn(command, args) {
    calls.push(command);
    if (args[0].endsWith('codex-model.js')) return { status: 5 };
    return { status: 0 };
  }

  var exitCode = updateDependencies(['ws'], { ws: '^8.21.3' }, spawn, process);

  assert.equal(exitCode, 5);
  assert.equal(calls.includes('docker'), false);
});
