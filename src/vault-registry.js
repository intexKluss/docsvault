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

  const registry = [];
  for (const entry of topLevel) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const vaultDir = join(absRoot, entry.name);
    const meta = safeReadMeta(vaultDir);
    registry.push(buildEntry(entry.name, vaultDir, meta));
  }

  registry.sort((a, b) => a.toolPrefix.localeCompare(b.toolPrefix));
  return registry;
}
