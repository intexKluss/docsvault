import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, relative, normalize, isAbsolute, sep } from 'node:path';

// Ordner die kein Vault-Content sind und übersprungen werden (zusätzlich
// zu '.'- und '_'-Präfix). crawl = Crawler-Code, node_modules = Deps.
var SKIP_DIRS = new Set(['crawl', 'node_modules', 'otris-teras', 'otris-teras-build']);

// true wenn der Ordner kein Vault-Content ist (Meta/Internal/Crawler/Deps).
export function isSkippedDir(name) {
  return name.startsWith('.') || name.startsWith('_') || SKIP_DIRS.has(name);
}

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
  // optionaler vault-spezifischer Such-Hinweis, wird in die Tool-Beschreibungen eingehängt
  const searchHint = (meta?.searchHint && String(meta.searchHint).trim()) || '';

  var technicalSection = findTechnicalSection(vaultDir, meta);

  return { name, description, toolPrefix, searchHint, technicalSection, path: vaultDir };
}

function findTechnicalSection(vaultDir, meta) {
  if (meta && Object.hasOwn(meta, 'technicalSection')) {
    return findExistingSection(vaultDir, String(meta.technicalSection).trim());
  }
  return findExistingSection(vaultDir, 'Scripting/TERAS API');
}

function findExistingSection(vaultDir, section) {
  var normalizedSection = normalize(section).replace(/\\/g, '/');
  if (!section || normalizedSection !== section) return undefined;

  var sectionPath = resolve(vaultDir, normalizedSection);
  var vaultRelativePath = relative(vaultDir, sectionPath);
  if (!vaultRelativePath || isAbsolute(vaultRelativePath)) return undefined;
  if (vaultRelativePath === '..' || vaultRelativePath.startsWith('..' + sep)) return undefined;

  try {
    if (!existsSync(sectionPath)) return undefined;
    if (!statSync(sectionPath).isDirectory()) return undefined;
    var realVaultPath = realpathSync(vaultDir);
    var realSectionPath = realpathSync(sectionPath);
    var realRelativePath = relative(realVaultPath, realSectionPath);
    if (!realRelativePath || isAbsolute(realRelativePath)) return undefined;
    if (realRelativePath === '..' || realRelativePath.startsWith('..' + sep)) return undefined;
  } catch {
    return undefined;
  }

  return normalizedSection;
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
    // _-Prefix = Meta/Internal (analog _meta.json), crawl/node_modules = kein Content
    if (isSkippedDir(e.name)) continue;
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

  // stabile Reihenfolge für Kollisionsauflösung (Folder-Name alphabetisch)
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

export var TOOL_SUFFIXES = ['search', 'read', 'list', 'overview', 'status'];

export function getToolSuffixes(vault) {
  if (vault.technicalSection) {
    return ['search', 'technical_search', 'read', 'list', 'overview', 'status'];
  }
  return TOOL_SUFFIXES;
}

export function describeVaults(registry) {
  if (!registry.length) return '';

  var lines = '';
  for (var vaultIndex = 0; vaultIndex < registry.length; vaultIndex++) {
    var vault = registry[vaultIndex];
    var suffixes = getToolSuffixes(vault);
    var tools = '';
    for (var suffixIndex = 0; suffixIndex < suffixes.length; suffixIndex++) {
      if (tools) tools += ', ';
      tools += `${vault.toolPrefix}_${suffixes[suffixIndex]}`;
    }

    if (lines) lines += '\n\n';
    lines += `- **${vault.name}**: ${vault.description}\n  Tools: ${tools}`;
  }

  return lines;
}
