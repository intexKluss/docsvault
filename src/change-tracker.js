import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { isSkippedDir } from './vault-registry.js';
import { diffLines, buildHunks } from './line-diff.js';

const MAX_ENTRIES = 30;
const MAX_DIFF_LINES_PER_FILE = 400;

// compares the vault with the snapshot of the previous start and records what
// changed. the first start only creates the snapshot (no history to report).
// returns the new history entry or null when nothing changed.
export function trackVaultChanges(vault, dataDir) {
  const stateDir = join(dataDir, 'changes', vault.toolPrefix);
  const snapshotDir = join(stateDir, 'snapshot');

  const currentPaths = listMarkdownFiles(vault.path);

  if (!existsSync(snapshotDir)) {
    copyFiles(vault.path, snapshotDir, currentPaths);
    writeJson(join(stateDir, 'history.json'), []);
    return null;
  }

  const snapshotPaths = listMarkdownFiles(snapshotDir);
  const snapshotSet = new Set(snapshotPaths);
  const currentSet = new Set(currentPaths);

  const added = currentPaths.filter(path => !snapshotSet.has(path));
  const removed = snapshotPaths.filter(path => !currentSet.has(path));

  const changed = [];
  const diffs = {};
  const modifiedPaths = [];
  for (const path of currentPaths) {
    if (!snapshotSet.has(path)) continue;
    const oldText = readFileSync(join(snapshotDir, path), 'utf-8');
    const newText = readFileSync(join(vault.path, path), 'utf-8');
    if (oldText === newText) continue;

    const hunks = buildHunks(diffLines(oldText, newText), MAX_DIFF_LINES_PER_FILE);
    changed.push({ path, additions: hunks.additions, deletions: hunks.deletions });
    diffs[path] = { lines: hunks.lines, truncated: hunks.truncated };
    modifiedPaths.push(path);
  }

  if (added.length === 0 && removed.length === 0 && changed.length === 0) return null;

  const history = readHistory(stateDir);
  const entry = { id: createEntryId(history), at: new Date().toISOString(), added, removed, changed };

  // history first: a crash in between leaves a duplicate entry, not a lost one
  writeJson(join(stateDir, 'diffs', `${entry.id}.json`), diffs);
  history.unshift(entry);
  for (const dropped of history.splice(MAX_ENTRIES)) {
    rmSync(join(stateDir, 'diffs', `${dropped.id}.json`), { force: true });
  }
  writeJson(join(stateDir, 'history.json'), history);

  copyFiles(vault.path, snapshotDir, added.concat(modifiedPaths));
  for (const path of removed) rmSync(join(snapshotDir, path), { force: true });

  return entry;
}

export function readChangeHistory(dataDir, toolPrefix) {
  return readHistory(join(dataDir, 'changes', toolPrefix));
}

// only ids that exist in the history are served, so the id never reaches the file system unchecked
export function readChangeEntry(dataDir, toolPrefix, id) {
  const stateDir = join(dataDir, 'changes', toolPrefix);
  const entry = readHistory(stateDir).find(candidate => candidate.id === id);
  if (!entry) return null;

  const diffs = readJson(join(stateDir, 'diffs', `${entry.id}.json`), {});
  return { ...entry, diffs };
}

function listMarkdownFiles(rootDir) {
  const paths = [];
  collectMarkdownFiles(rootDir, '', paths);
  paths.sort();
  return paths;
}

function collectMarkdownFiles(rootDir, relativeDir, paths) {
  const entries = readdirSync(join(rootDir, relativeDir), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (isSkippedDir(entry.name)) continue;

    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectMarkdownFiles(rootDir, relativePath, paths);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      paths.push(relativePath);
    }
  }
}

function copyFiles(fromDir, toDir, relativePaths) {
  for (const path of relativePaths) {
    const target = join(toDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(fromDir, path)));
  }
}

function createEntryId(history) {
  const base = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const taken = new Set(history.map(entry => entry.id));
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

function readHistory(stateDir) {
  return readJson(join(stateDir, 'history.json'), []);
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, path);
}
