import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

var SCRIPT_PATH = fileURLToPath(import.meta.url);

if (process.argv[1] === SCRIPT_PATH) {
  var packageNames = process.argv.slice(2);
  var directDependencies = readDirectDependencies();
  process.exitCode = updateDependencies(packageNames, directDependencies, executeCommand);
}

export function updateDependencies(packageNames, directDependencies, execute) {
  if (!Array.isArray(packageNames) || packageNames.length === 0) {
    console.error('Usage: npm run deps:update -- <direct dependency> [...]');
    return 1;
  }

  for (var validationIndex = 0; validationIndex < packageNames.length; validationIndex++) {
    var packageName = packageNames[validationIndex];
    if (!directDependencies[packageName]) {
      console.error(`'${packageName}' ist keine direkte Dependency in package.json.`);
      return 1;
    }
  }

  for (var updateIndex = 0; updateIndex < packageNames.length; updateIndex++) {
    var packageName = packageNames[updateIndex];
    console.log(`Aktualisiere ${packageName}...`);
    var installResult = execute('npm', ['install', `${packageName}@latest`]);
    var installExitCode = getExitCode(installResult, 'npm');
    if (installExitCode !== 0) return installExitCode || 1;
  }

  var checks = [
    ['npm', ['ls']],
    ['npm', ['test']],
    ['docker', ['build', '--platform', 'linux/amd64', '-t', 'docsvault-dependency-check', '.']]
  ];

  for (var checkIndex = 0; checkIndex < checks.length; checkIndex++) {
    var check = checks[checkIndex];
    var checkResult = execute(check[0], check[1]);
    var checkExitCode = getExitCode(checkResult, check[0]);
    if (checkExitCode !== 0) return checkExitCode || 1;
  }

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

function executeCommand(command, args) {
  var executable = command;
  var commandArgs = args;
  if (process.platform === 'win32' && command === 'npm') {
    var nodeDirectory = dirname(process.execPath);
    var npmCliPath = resolve(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    executable = process.execPath;
    commandArgs = [npmCliPath].concat(args);
  }

  return spawnSync(executable, commandArgs, {
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
