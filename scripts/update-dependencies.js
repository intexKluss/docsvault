import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

var SCRIPT_PATH = fileURLToPath(import.meta.url);

if (process.argv[1] === SCRIPT_PATH) {
  var packageNames = process.argv.slice(2);
  var directDependencies = readDirectDependencies();
  process.exitCode = updateDependencies(packageNames, directDependencies, spawnSync, process);
}

export function updateDependencies(packageNames, directDependencies, spawn, runtime) {
  if (!Array.isArray(packageNames) || packageNames.length === 0) {
    console.error('Usage: npm run deps:update -- <direct dependency> [...]');
    return 1;
  }

  var requestedPackages = [];
  var seenPackages = Object.create(null);
  for (var validationIndex = 0; validationIndex < packageNames.length; validationIndex++) {
    var packageName = packageNames[validationIndex];
    if (!Object.hasOwn(directDependencies, packageName)) {
      console.error(`'${packageName}' ist keine direkte Dependency in package.json.`);
      return 1;
    }

    if (seenPackages[packageName]) continue;
    seenPackages[packageName] = true;
    requestedPackages.push(`${packageName}@latest`);
  }

  console.log(`Aktualisiere ${requestedPackages.length} direkte Dependencies...`);
  var installArgs = ['install'].concat(requestedPackages);
  var installResult = executeCommand('npm', installArgs, spawn, runtime);
  var installExitCode = getExitCode(installResult, 'npm');
  if (installExitCode !== 0) return installExitCode;

  var checks = [
    ['ls'],
    ['audit', '--omit=dev', '--audit-level=high'],
    ['test']
  ];

  for (var checkIndex = 0; checkIndex < checks.length; checkIndex++) {
    var checkResult = executeCommand('npm', checks[checkIndex], spawn, runtime);
    var checkExitCode = getExitCode(checkResult, 'npm');
    if (checkExitCode !== 0) return checkExitCode;
  }

  var modelScript = fileURLToPath(new URL('../src/codex-model.js', import.meta.url));
  var modelResult = executeCommand('node', [modelScript], spawn, runtime);
  var modelExitCode = getExitCode(modelResult, 'Codex Modellprüfung');
  if (modelExitCode !== 0) return modelExitCode;

  var imageTag = `docsvault-dependency-check:${randomUUID()}`;
  var buildArgs = [
    'build',
    '--platform',
    'linux/amd64',
    '-t',
    imageTag,
    '.'
  ];
  var buildResult = executeCommand('docker', buildArgs, spawn, runtime);
  var buildExitCode = getExitCode(buildResult, 'docker');

  var cleanupResult = executeCommand('docker', ['image', 'rm', imageTag], spawn, runtime);
  var cleanupExitCode = getExitCode(cleanupResult, 'docker image rm');

  if (buildExitCode !== 0) return buildExitCode;
  if (cleanupExitCode !== 0) return cleanupExitCode;

  console.log('Dependency-Update geprüft. Prüfe jetzt package.json und package-lock.json vor dem Commit.');
  return 0;
}

function readDirectDependencies() {
  var packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
  var packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  var directDependencies = {};
  var groups = [packageJson.dependencies, packageJson.devDependencies];

  for (var index = 0; index < groups.length; index++) {
    var group = groups[index];
    if (!group) continue;

    for (var packageName in group) {
      directDependencies[packageName] = true;
    }
  }

  return directDependencies;
}

function executeCommand(command, args, spawn, runtime) {
  var executable = command;
  var commandArgs = args;
  if (command === 'node') executable = runtime.execPath;
  if (runtime.platform === 'win32' && command === 'npm') {
    var nodeDirectory = dirname(runtime.execPath);
    var npmCliPath = resolve(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    executable = runtime.execPath;
    commandArgs = [npmCliPath].concat(args);
  }

  return spawn(executable, commandArgs, {
    stdio: 'inherit'
  });
}

function getExitCode(result, command) {
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  if (typeof result.status !== 'number') {
    console.error(`${command} wurde ohne Exit-Code beendet.`);
    return 1;
  }

  return result.status;
}
