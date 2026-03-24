import { readdirSync, readFileSync, statSync } from 'fs';
import { join, basename, dirname, resolve, posix } from 'path';

/**
 * Recursively walks a directory, returns all file paths.
 */
function walkDir(dir) {
  const entries = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries.push(...walkDir(full));
    } else if (entry.endsWith('.md')) {
      entries.push(full);
    }
  }
  return entries;
}

/**
 * Extract frontmatter source URL from a markdown file.
 */
function extractSource(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const srcMatch = match[1].match(/^source:\s*["']?(.+?)["']?\s*$/m);
    return srcMatch ? srcMatch[1] : null;
  } catch {
    return null;
  }
}

/**
 * Builds a file index from vault for link resolution.
 * Keys: filename, source URL, URL path variants.
 * Values: vault-relative path without .md extension.
 */
export function buildFileIndex(vaultPath) {
  const index = new Map();
  const files = walkDir(vaultPath);

  for (const filePath of files) {
    // vault-relative path without .md
    const relative = filePath
      .slice(vaultPath.length + 1)
      .replace(/\.md$/, '')
      .split('/').join('/'); // normalize separators

    const name = basename(filePath, '.md');

    // Key: bare filename
    // Only set if not already taken (first wins, avoids ambiguity)
    if (!index.has(name)) {
      index.set(name, relative);
    }

    // Key: the relative vault path itself
    index.set(relative, relative);

    // Extract source URL and create URL-based keys
    const source = extractSource(filePath);
    if (source) {
      index.set(source, relative);

      try {
        const url = new URL(source);
        const urlPath = url.pathname;

        // Key: full URL path  e.g. /documents/api/portalscript/classes/DocFile.html
        index.set(urlPath, relative);

        // Key: URL path without .html
        if (urlPath.endsWith('.html')) {
          index.set(urlPath.replace(/\.html$/, ''), relative);
        }

        // Key: URL path without trailing slash
        if (urlPath.endsWith('/')) {
          index.set(urlPath.replace(/\/$/, ''), relative);
        }

        // Key: path with hash (for anchored URLs)
        if (url.hash) {
          index.set(urlPath + url.hash, relative);
        }
      } catch {
        // not a valid URL, skip
      }
    }
  }

  return index;
}

// Patterns to skip
const SKIP_HREF_RE = /^(https?:\/\/|mailto:|#)/;
const ASSET_EXT_RE = /\.(png|jpg|jpeg|gif|svg|css|js|pdf)$/i;

// Markdown link regex — matches [text](href) but not ![img](src)
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Convert HTML-style relative links in markdown content to vault paths.
 *
 * @param {string} content - Markdown content string
 * @param {string} fromFilePath - Vault-relative path of the file containing the links (no .md)
 * @param {Map} fileIndex - Index built by buildFileIndex
 * @returns {string} Content with converted links
 */
export function convertLinks(content, fromFilePath, fileIndex) {
  return content.replace(LINK_RE, (match, text, href) => {
    // Skip external, anchor-only, mailto links
    if (SKIP_HREF_RE.test(href)) return match;

    // Skip asset files
    const hrefWithoutAnchor = href.split('#')[0];
    if (ASSET_EXT_RE.test(hrefWithoutAnchor)) return match;

    // Extract anchor
    const hashIdx = href.indexOf('#');
    const anchor = hashIdx !== -1 ? href.slice(hashIdx) : '';
    const rawPath = hashIdx !== -1 ? href.slice(0, hashIdx) : href;

    // Try to resolve relative path to absolute vault path
    const resolved = resolveLink(rawPath, fromFilePath, fileIndex);

    if (resolved) {
      return `[${text}](${resolved}${anchor})`;
    }

    // Unresolvable — leave original
    return match;
  });
}

/**
 * Resolve a relative href to a vault path.
 */
function resolveLink(rawPath, fromFilePath, fileIndex) {
  // Strip .html extension for resolution
  const cleanPath = rawPath.replace(/\.html$/, '');

  // 1. Try resolving relative to the current file's directory
  const fromDir = dirname(fromFilePath);
  const absoluteish = posix.normalize(posix.join(fromDir, cleanPath));

  // Direct lookup
  if (fileIndex.has(absoluteish)) {
    return fileIndex.get(absoluteish);
  }

  // 2. Try the clean path as-is (might be absolute within vault)
  if (fileIndex.has(cleanPath)) {
    return fileIndex.get(cleanPath);
  }

  // 3. Try just the filename (basename)
  const name = basename(cleanPath);
  if (fileIndex.has(name)) {
    return fileIndex.get(name);
  }

  // 4. Try dotted JSDoc-style name (e.g. "DocFile.setAttribute" -> "DocFile")
  const dotParts = name.split('.');
  if (dotParts.length > 1 && fileIndex.has(dotParts[0])) {
    return fileIndex.get(dotParts[0]);
  }

  return null;
}
