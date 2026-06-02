import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative, basename, sep } from 'path';
import { isSkippedDir } from '../vault-registry.js';

// Modul-weiter Cache pro Vault. Vaults sind zwischen Crawls read-only, daher
// koennen wir Manifest, Sections und einen Titel-/Pfad-Index halten und nur
// invalidieren wenn sich die mtime von _manifest.json (fallback: Vault-Root)
// aendert.
const cache = new Map(); // vaultPath -> { mtimeMs, manifest, sections, titleIndex }

// Liefert die mtime die fuer die Invalidierung benutzt wird:
// bevorzugt _manifest.json, sonst der Vault-Root-Ordner.
function vaultMtime(vaultPath) {
  try {
    return statSync(join(vaultPath, '_manifest.json')).mtimeMs;
  } catch {
    try {
      return statSync(vaultPath).mtimeMs;
    } catch {
      return 0;
    }
  }
}

// Holt (oder baut) den Cache-Eintrag fuer einen Vault. Invalidiert bei
// mtime-Aenderung.
function getEntry(vaultPath) {
  const mtimeMs = vaultMtime(vaultPath);
  const existing = cache.get(vaultPath);
  if (existing && existing.mtimeMs === mtimeMs) return existing;

  const entry = { mtimeMs, manifest: undefined, sections: undefined, titleIndex: undefined };
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
// behalten. Guenstig genug fuer den Index-Aufbau.
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

// gecachter Titel-/Pfad-Index: [{ path, name, title }] fuer alle .md-Dateien
// (ohne Skip-Dirs). Lazy aufgebaut, geteilt von Suche, status und overview.
export function getCachedTitleIndex(vaultPath) {
  const entry = getEntry(vaultPath);
  if (entry.titleIndex === undefined) {
    entry.titleIndex = buildTitleIndex(vaultPath);
  }
  return entry.titleIndex;
}

// Cache leeren (vor allem fuer Tests).
export function clearVaultCache(vaultPath) {
  if (vaultPath) cache.delete(vaultPath);
  else cache.clear();
}
