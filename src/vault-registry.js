import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Wandelt einen freien Namen in einen MCP-kompatiblen Tool-Prefix.
// Regeln: lowercase, non-[a-z0-9] zu _, mehrfache _ zu einem, trim leading/trailing _.
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function safeReadMeta(vaultDir) {
  const metaPath = join(vaultDir, '_meta.json');
  if (!existsSync(metaPath)) return null;
  try {
    const raw = readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    console.warn(`[vault-registry] ${metaPath}: _meta.json must be an object, ignoring`);
    return null;
  } catch (err) {
    console.warn(`[vault-registry] ${metaPath}: invalid JSON (${err.message}), ignoring`);
    return null;
  }
}

function buildEntry(folderName, vaultDir, meta) {
  const name = (meta?.name && String(meta.name).trim()) || folderName;
  const toolPrefix = (meta?.toolPrefix && String(meta.toolPrefix).trim()) || slugify(folderName);
  const description = (meta?.description && String(meta.description).trim())
    || `Documentation vault '${name}'.`;

  return { name, description, toolPrefix, path: vaultDir };
}

const TOOL_PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

function hasAnyMarkdown(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    // _-Prefix = Meta/Internal (analog _meta.json), nicht Teil des Vault-Inhalts
    if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (hasAnyMarkdown(full)) return true;
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      return true;
    }
  }
  return false;
}

export function loadVaultRegistry(vaultsRoot) {
  const absRoot = resolve(vaultsRoot);

  if (!existsSync(absRoot)) {
    console.warn(`[vault-registry] VAULTS_ROOT does not exist: ${absRoot}`);
    return [];
  }

  let topLevel;
  try {
    topLevel = readdirSync(absRoot, { withFileTypes: true });
  } catch (err) {
    console.warn(`[vault-registry] cannot read VAULTS_ROOT ${absRoot}: ${err.message}`);
    return [];
  }

  // stabile Reihenfolge fuer Kollisionsaufloesung (Folder-Name alphabetisch)
  const folders = topLevel
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort();

  const registry = [];
  const seenPrefixes = new Map(); // toolPrefix -> folderName

  for (const folderName of folders) {
    const vaultDir = join(absRoot, folderName);
    const meta = safeReadMeta(vaultDir);
    const entry = buildEntry(folderName, vaultDir, meta);

    if (!TOOL_PREFIX_PATTERN.test(entry.toolPrefix)) {
      console.warn(`[vault-registry] skip '${folderName}': invalid toolPrefix '${entry.toolPrefix}' (must match /^[a-z][a-z0-9_]*$/)`);
      continue;
    }

    if (seenPrefixes.has(entry.toolPrefix)) {
      console.warn(`[vault-registry] skip '${folderName}': toolPrefix '${entry.toolPrefix}' already used by '${seenPrefixes.get(entry.toolPrefix)}'`);
      continue;
    }

    if (!hasAnyMarkdown(vaultDir)) {
      console.warn(`[vault-registry] skip '${folderName}': no .md files found`);
      continue;
    }

    seenPrefixes.set(entry.toolPrefix, folderName);
    registry.push(entry);
  }

  registry.sort((a, b) => a.toolPrefix.localeCompare(b.toolPrefix));
  return registry;
}
