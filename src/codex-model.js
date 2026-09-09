import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

var SCRIPT_PATH = fileURLToPath(import.meta.url);
var DEFAULT_CODEX_MODEL = 'gpt-5.6-luna';

if (process.argv[1] === SCRIPT_PATH) {
  resolveCodexModel().then(function (selection) {
    console.log(`Codex Modell geprüft: ${selection.model}, Reasoning: ${selection.reasoningEffort}.`);
  }).catch(function (error) {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export async function resolveCodexModel(options = {}) {
  var runtime = options.runtime || process;
  var environment = runtime.env || process.env;
  var preferredModel = environment.CODEX_MODEL || DEFAULT_CODEX_MODEL;
  var preferredEffort = environment.CODEX_REASONING_EFFORT || 'low';
  var spawnProcess = options.spawn || spawn;
  var command = environment.CODEX_PATH;
  var args = ['app-server', '--listen', 'stdio://'];
  if (!command) {
    var require = createRequire(import.meta.resolve('@openai/codex-sdk'));
    var cliPath = require.resolve('@openai/codex/bin/codex.js');
    command = runtime.execPath;
    args.unshift(cliPath);
  }

  var models = await new Promise(function (resolve, reject) {
    var child = spawnProcess(command, args, {
      cwd: dirname(SCRIPT_PATH),
      env: environment,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    });
    var reader = createInterface({ input: child.stdout });
    var catalog = [];
    var cursors = new Set();
    var requestId = 0;
    var finished = false;
    var failure;
    var cleanupTimer;
    var timer = setTimeout(function () {
      finish(new Error('Zeitlimit bei der Codex Modellprüfung überschritten.'));
    }, options.timeoutMs || 20000);

    child.on('error', function (error) { finish(error); });
    child.stdin.on('error', function (error) { finish(error); });
    child.on('close', function (code) {
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      reader.close();
      if (failure) return reject(failure);
      if (!finished || code !== 0) return reject(new Error(`Codex Modellprüfung wurde vorzeitig beendet (Exit ${code}).`));
      resolve(catalog);
    });
    reader.on('line', function (line) {
      if (finished) return;
      try {
        var message = JSON.parse(line);
        if (message.id !== requestId) return;
        if (message.error) throw new Error(message.error.message || 'Codex Modellprüfung fehlgeschlagen.');
        if (!message.result) throw new Error('Ungültige Antwort der Codex CLI.');
        if (requestId === 0) {
          child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
          requestId++;
          child.stdin.write(JSON.stringify({ id: requestId, method: 'account/read', params: { refreshToken: true } }) + '\n');
          return;
        }
        if (requestId === 1) {
          if (!message.result.account) throw new Error('Codex Login fehlt. Melde dich mit codex login an und wiederhole die Modellprüfung.');
          requestId++;
          child.stdin.write(JSON.stringify({ id: requestId, method: 'model/list', params: { limit: 100, includeHidden: true } }) + '\n');
          return;
        }

        if (!Array.isArray(message.result.data)) throw new Error('Ungültige Modellantwort der Codex CLI.');
        for (var model of message.result.data) {
          if (!model || typeof model.model !== 'string' || !Array.isArray(model.supportedReasoningEfforts)) {
            throw new Error('Ungültige Modellantwort der Codex CLI.');
          }
          catalog.push(model);
        }
        var cursor = message.result.nextCursor;
        if (cursor) {
          if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Ungültige Seitennavigation der Codex Modellliste.');
          cursors.add(cursor);
          requestId++;
          child.stdin.write(JSON.stringify({ id: requestId, method: 'model/list', params: { limit: 100, includeHidden: true, cursor: cursor } }) + '\n');
          return;
        }
        finish();
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.write(JSON.stringify({
      id: requestId,
      method: 'initialize',
      params: { clientInfo: { name: 'docsvault_model_check', version: '0.2.0' } }
    }) + '\n');

    function finish(error) {
      if (finished) return;
      finished = true;
      failure = error;
      clearTimeout(timer);
      child.stdin.end();
      cleanupTimer = setTimeout(function () {
        // Der npm Launcher hat einen nativen Kindprozess, der unter Windows mit beendet werden muss.
        if (process.platform === 'win32' && child.pid) {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
          return;
        }
        child.kill('SIGTERM');
      }, 1000);
    }
  });

  var selected;
  var recommended;
  var first;
  for (var index = 0; index < models.length; index++) {
    var model = models[index];
    if (model.inputModalities && !model.inputModalities.includes('text')) continue;
    if (model.supportedReasoningEfforts.length === 0) continue;
    if (model.model === preferredModel) selected = model;
    if (model.hidden) continue;
    if (!first) first = model;
    if (model.isDefault) recommended = model;
  }
  selected = selected || recommended || first;
  if (!selected) throw new Error('Codex meldet kein verfügbares Textmodell mit Reasoning Optionen.');

  var reasoningEffort = selected.defaultReasoningEffort;
  var supported = false;
  for (var effort of selected.supportedReasoningEfforts) {
    if (effort.reasoningEffort === preferredEffort) {
      reasoningEffort = preferredEffort;
      supported = true;
      break;
    }
    if (effort.reasoningEffort === reasoningEffort) supported = true;
  }
  if (!supported) reasoningEffort = selected.supportedReasoningEfforts[0].reasoningEffort;
  if (selected.model !== preferredModel) console.log(`Codex Modell ${preferredModel} ist nicht verfügbar. Verwende ${selected.model}.`);
  if (reasoningEffort !== preferredEffort) console.log(`Reasoning ${preferredEffort} wird nicht unterstützt. Verwende ${reasoningEffort}.`);
  return { model: selected.model, reasoningEffort: reasoningEffort };
}
