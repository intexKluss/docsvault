import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative, basename, sep } from 'path';
import { isSkippedDir } from '../vault-registry.js';
import { buildSearchIndex } from './search-index.js';

// Modul-weiter Cache pro Vault. Vaults sind zwischen Crawls read-only, daher
// können wir Manifest, Sections, einen Titel-/Pfad-Index und den BM25-Index
// halten und nur invalidieren wenn sich _manifest.json oder der rekursive
// Markdown-Bestand eines Vaults ohne Manifest ändert.
var cache = new Map();
var MANIFESTLESS_VALIDATION_INTERVAL_MS = 1000;

function vaultChangeKey(vaultPath) {
  if (!existsSync(vaultPath)) return 'missing';

  var manifestPath = join(vaultPath, '_manifest.json');
  if (existsSync(manifestPath)) {
    var manifestStats = statSync(manifestPath);
    return `manifest:${manifestStats.mtimeMs}:${manifestStats.size}`;
  }

  var changes = [];
  collectVaultChanges(vaultPath, changes);
  changes.sort();

  var key = '';
  for (var changeIndex = 0; changeIndex < changes.length; changeIndex++) {
    key += changes[changeIndex] + '\n';
  }
  return key;
}

function collectVaultChanges(directory, changes) {
  var entries = readdirSync(directory, { withFileTypes: true });
  for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    var entry = entries[entryIndex];
    var fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue;
      changes.push(`directory:${fullPath}`);
      collectVaultChanges(fullPath, changes);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    var stats = statSync(fullPath);
    changes.push(`file:${fullPath}:${stats.mtimeMs}:${stats.size}`);
  }
}

function getEntry(vaultPath) {
  var existing = cache.get(vaultPath);
  var hasManifest = existsSync(join(vaultPath, '_manifest.json'));
  var now = Date.now();
  if (
    existing
    && !hasManifest
    && existing.manifestlessValidatedAt <= now
    && existing.manifestlessValidUntil > now
  ) {
    return existing;
  }

  var changeKey = vaultChangeKey(vaultPath);
  if (existing && existing.changeKey === changeKey) {
    if (!hasManifest) {
      existing.manifestlessValidatedAt = now;
      existing.manifestlessValidUntil = now + MANIFESTLESS_VALIDATION_INTERVAL_MS;
    }
    return existing;
  }

  var entry = {
    changeKey,
    manifestlessValidatedAt: 0,
    manifestlessValidUntil: 0,
    manifest: undefined,
    sections: undefined,
    titleIndex: undefined,
    searchIndex: undefined,
  };
  if (!hasManifest) {
    entry.manifestlessValidatedAt = now;
    entry.manifestlessValidUntil = now + MANIFESTLESS_VALIDATION_INTERVAL_MS;
  }
  cache.set(vaultPath, entry);
  return entry;
}

// gecachtes Manifest (oder null). Lazy geladen.
export function getCachedManifest(vaultPath) {
  const entry = getEntry(vaultPath);
  if (entry.manifest === undefined) {
    const manifestPath = join(vaultPath, '_manifest.json');
    try {
      entry.manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      entry.manifest = null;
    }
  }
  return entry.manifest;
}

// gecachte Section-Liste (Top-Level-Ordner ohne Skip-Dirs). Lazy.
export function getCachedSections(vaultPath) {
  const entry = getEntry(vaultPath);
  if (entry.sections === undefined) {
    try {
      entry.sections = readdirSync(vaultPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !isSkippedDir(d.name))
        .map(d => d.name)
        .sort();
    } catch {
      entry.sections = [];
    }
  }
  return entry.sections;
}

// liest nur den Frontmatter-title aus einer Datei, ohne den ganzen Body zu
// behalten. Günstig genug für den Index-Aufbau.
function readTitleOnly(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
  if (raw.replace(/^﻿/, '').slice(0, 3) !== '---') return '';
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return '';
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^title\s*:\s*"?(.+?)"?\s*$/);
    if (kv) return kv[1].replace(/\r$/, '');
  }
  return '';
}

function buildTitleIndex(vaultPath) {
  const index = []; // { path, name, title }
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const full = join(dir, entry.name);
        const relPath = relative(vaultPath, full).replace(/\.md$/, '').split(sep).join('/');
        index.push({
          path: relPath,
          name: basename(entry.name, '.md'),
          title: readTitleOnly(full),
        });
      }
    }
  }
  walk(vaultPath);
  return index;
}

// gecachter Titel-/Pfad-Index: [{ path, name, title }] für alle .md-Dateien
// (ohne Skip-Dirs). Lazy aufgebaut, geteilt von Suche, status und overview.
export function getCachedTitleIndex(vaultPath) {
  const entry = getEntry(vaultPath);
  if (entry.titleIndex === undefined) {
    entry.titleIndex = buildTitleIndex(vaultPath);
  }
  return entry.titleIndex;
}

export function getCachedSearchIndex(vaultPath) {
  var entry = getEntry(vaultPath);
  if (entry.searchIndex === undefined) {
    entry.searchIndex = buildSearchIndex(vaultPath);
  }
  return entry.searchIndex;
}

export function warmSearchIndex(vaultPath) {
  try {
    return getCachedSearchIndex(vaultPath);
  } catch (err) {
    console.warn(`[vault-cache] index build failed for ${vaultPath}: ${err.message}`);
    return null;
  }
}

// Cache leeren (vor allem für Tests).
export function clearVaultCache(vaultPath) {
  if (vaultPath) cache.delete(vaultPath);
  else cache.clear();
}
