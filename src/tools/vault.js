import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative, basename, sep, resolve } from 'path';
import { execFileSync } from 'child_process';

function isInsideVault(vaultPath, targetPath) {
  const resolvedVault = resolve(vaultPath);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget.startsWith(resolvedVault + sep) || resolvedTarget === resolvedVault;
}

/**
 * Returns array of section directory names in vault root.
 * Excludes dotfiles and underscore-prefixed entries.
 */
export function getSections(vaultPath) {
  try {
    return readdirSync(vaultPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
      .map(d => d.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Recursively finds all .md files in a section (or subfolder).
 * Returns [{ name, path }] sorted by name.
 * path is relative to vault root without .md extension, using forward slashes.
 */
export function listFiles(vaultPath, section, subfolder) {
  const searchDir = subfolder
    ? join(vaultPath, section, subfolder)
    : join(vaultPath, section);

  if (!isInsideVault(vaultPath, searchDir)) return [];

  if (!existsSync(searchDir) || !statSync(searchDir).isDirectory()) {
    return [];
  }

  const results = [];
  collectMdFiles(searchDir, vaultPath, results);
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function collectMdFiles(dir, vaultRoot, results) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMdFiles(fullPath, vaultRoot, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const relPath = relative(vaultRoot, fullPath).replace(/\.md$/, '').split(sep).join('/');
      results.push({
        name: basename(entry.name, '.md'),
        path: relPath,
      });
    }
  }
}

/**
 * Reads a doc file, parses YAML frontmatter.
 * Returns { title, source, content, truncated } or null if not found.
 */
export function readDoc(vaultPath, docPath, maxLength = 50000) {
  const filePath = join(vaultPath, docPath + '.md');

  if (!isInsideVault(vaultPath, filePath)) return null;

  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);

  let content = body;
  let truncated = false;

  if (content.length > maxLength) {
    content = content.slice(0, maxLength) + '\n\n[truncated]';
    truncated = true;
  }

  return {
    title: frontmatter.title || '',
    source: frontmatter.source || '',
    content,
    truncated,
  };
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const yamlBlock = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w+)\s*:\s*"?(.+?)"?\s*$/);
    if (kv) {
      frontmatter[kv[1]] = kv[2];
    }
  }

  return { frontmatter, body };
}

/**
 * Full-text search across vault .md files.
 * Tries ripgrep first, falls back to Node.js regex grep.
 * Returns [{ file, title, matches }].
 */
export function searchDocs(vaultPath, query, options = {}) {
  const { section, contextLines = 2, maxResults = 10 } = options;
  const searchPath = section ? join(vaultPath, section) : vaultPath;

  if (!isInsideVault(vaultPath, searchPath)) return [];

  if (!existsSync(searchPath)) {
    return [];
  }

  try {
    return searchWithRipgrep(vaultPath, searchPath, query, contextLines, maxResults);
  } catch {
    return searchWithNode(vaultPath, searchPath, query, contextLines, maxResults);
  }
}

function searchWithRipgrep(vaultPath, searchPath, query, contextLines, maxResults) {
  const args = ['-i', '-n', '--no-heading', '-C', String(contextLines), '--glob', '*.md', '--max-count', String(maxResults * 2), query, searchPath];

  let output;
  try {
    output = execFileSync('rg', args, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err) {
    // rg exits with code 1 when no matches found
    if (err.status === 1 && err.stdout !== undefined) {
      return [];
    }
    // rg not found or other error
    throw err;
  }

  if (!output) {
    return [];
  }

  return parseRipgrepOutput(vaultPath, output).slice(0, maxResults);
}

function parseRipgrepOutput(vaultPath, output) {
  const fileGroups = new Map();

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;

    // rg output: /path/to/file.md:linenum:content  or  /path/to/file.md-linenum-content (context)
    const match = line.match(/^(.+\.md)[:-](\d+)[:-](.*)$/);
    if (!match) continue;

    const [, absPath, lineNum, content] = match;
    const relPath = relative(vaultPath, absPath).replace(/\.md$/, '').split(sep).join('/');

    if (!fileGroups.has(relPath)) {
      // Read title from frontmatter
      const doc = readDoc(vaultPath, relPath);
      fileGroups.set(relPath, {
        file: relPath,
        title: doc?.title || '',
        matches: [],
      });
    }

    fileGroups.get(relPath).matches.push({
      line: parseInt(lineNum, 10),
      text: content,
    });
  }

  return Array.from(fileGroups.values());
}

function searchWithNode(vaultPath, searchPath, query, contextLines, maxResults) {
  const regex = new RegExp(escapeRegex(query), 'i');
  const results = [];

  const mdFiles = [];
  collectMdFilePaths(searchPath, mdFiles);

  for (const filePath of mdFiles) {
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n');
    const matchingLines = [];

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        // Gather context
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length - 1, i + contextLines);
        for (let j = start; j <= end; j++) {
          if (!matchingLines.some(m => m.line === j + 1)) {
            matchingLines.push({ line: j + 1, text: lines[j] });
          }
        }
      }
    }

    if (matchingLines.length > 0) {
      const relPath = relative(vaultPath, filePath).replace(/\.md$/, '').split(sep).join('/');
      const doc = readDoc(vaultPath, relPath);
      matchingLines.sort((a, b) => a.line - b.line);
      results.push({
        file: relPath,
        title: doc?.title || '',
        matches: matchingLines,
      });
    }
  }

  return results.slice(0, maxResults);
}

function collectMdFilePaths(dir, results) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
      collectMdFilePaths(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads _manifest.json from vault root.
 * Returns parsed JSON or null.
 */
export function getManifest(vaultPath) {
  const manifestPath = join(vaultPath, '_manifest.json');
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
