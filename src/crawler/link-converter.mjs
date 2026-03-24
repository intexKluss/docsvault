import { readdirSync, readFileSync, statSync } from 'fs';
import { join, basename, dirname, resolve, posix } from 'path';

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

export function buildFileIndex(vaultPath) {
  const index = new Map();
  const files = walkDir(vaultPath);

  for (const filePath of files) {
    const relative = filePath
      .slice(vaultPath.length + 1)
      .replace(/\.md$/, '')
      .split('/').join('/'); // normalize separators

    const name = basename(filePath, '.md');

    // first wins to avoid ambiguity on duplicate filenames
    if (!index.has(name)) {
      index.set(name, relative);
    }

    index.set(relative, relative);

    const source = extractSource(filePath);
    if (source) {
      index.set(source, relative);

      try {
        const url = new URL(source);
        const urlPath = url.pathname;

        index.set(urlPath, relative);

        if (urlPath.endsWith('.html')) {
          index.set(urlPath.replace(/\.html$/, ''), relative);
        }

        if (urlPath.endsWith('/')) {
          index.set(urlPath.replace(/\/$/, ''), relative);
        }

        if (url.hash) {
          index.set(urlPath + url.hash, relative);
        }
      } catch {}
    }
  }

  return index;
}

const SKIP_HREF_RE = /^(https?:\/\/|mailto:|#)/;
const ASSET_EXT_RE = /\.(png|jpg|jpeg|gif|svg|css|js|pdf)$/i;
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

export function convertLinks(content, fromFilePath, fileIndex) {
  return content.replace(LINK_RE, (match, text, href) => {
    if (SKIP_HREF_RE.test(href)) return match;

    const hrefWithoutAnchor = href.split('#')[0];
    if (ASSET_EXT_RE.test(hrefWithoutAnchor)) return match;

    const hashIdx = href.indexOf('#');
    const anchor = hashIdx !== -1 ? href.slice(hashIdx) : '';
    const rawPath = hashIdx !== -1 ? href.slice(0, hashIdx) : href;

    const resolved = resolveLink(rawPath, fromFilePath, fileIndex);

    if (resolved) {
      return `[${text}](${resolved}${anchor})`;
    }

    return match;
  });
}

function resolveLink(rawPath, fromFilePath, fileIndex) {
  const cleanPath = rawPath.replace(/\.html$/, '');

  // resolve relative to current file
  const fromDir = dirname(fromFilePath);
  const absoluteish = posix.normalize(posix.join(fromDir, cleanPath));

  if (fileIndex.has(absoluteish)) {
    return fileIndex.get(absoluteish);
  }

  if (fileIndex.has(cleanPath)) {
    return fileIndex.get(cleanPath);
  }

  const name = basename(cleanPath);
  if (fileIndex.has(name)) {
    return fileIndex.get(name);
  }

  // jsdoc-style dotted names: "DocFile.setAttribute" -> "DocFile"
  const dotParts = name.split('.');
  if (dotParts.length > 1 && fileIndex.has(dotParts[0])) {
    return fileIndex.get(dotParts[0]);
  }

  return null;
}
