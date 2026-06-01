import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative, basename, sep, resolve } from 'path';
import { execFileSync } from 'child_process';
import { isSkippedDir } from '../vault-registry.js';

function isInsideVault(vaultPath, targetPath) {
  const resolvedVault = resolve(vaultPath);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget.startsWith(resolvedVault + sep) || resolvedTarget === resolvedVault;
}

export function getSections(vaultPath) {
  try {
    return readdirSync(vaultPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !isSkippedDir(d.name))
      .map(d => d.name)
      .sort();
  } catch {
    return [];
  }
}

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

// Baut einen Zeilen-Index fuer eine roh eingelesene Datei:
//  - frontmatterEnd: 1-basierte Zeilennummer des schliessenden '---' (0 = kein Frontmatter)
//  - headings: { line, text } aller Markdown-Ueberschriften (#, ##, ...)
function buildLineIndex(raw) {
  const lines = raw.split('\n');
  let frontmatterEnd = 0;

  // Frontmatter nur wenn die allererste Zeile genau '---' ist (CRLF-tolerant)
  if (lines.length && lines[0].replace(/\r$/, '') === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].replace(/\r$/, '') === '---') {
        frontmatterEnd = i + 1; // 1-basiert
        break;
      }
    }
  }

  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) headings.push({ line: i + 1, text: m[2].replace(/\r$/, '') });
  }

  return { frontmatterEnd, headings };
}

// Naechste vorausgehende Ueberschrift fuer eine Trefferzeile (oder '').
function headingForLine(headings, line) {
  let current = '';
  for (const h of headings) {
    if (h.line <= line) current = h.text;
    else break;
  }
  return current;
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

// splits query into tokens, searches each, ranks by number of distinct token hits
export function searchDocs(vaultPath, query, options = {}) {
  const { section, contextLines = 2, maxResults = 10 } = options;
  const searchPath = section ? join(vaultPath, section) : vaultPath;

  if (!isInsideVault(vaultPath, searchPath)) return [];

  if (!existsSync(searchPath)) {
    return [];
  }

  const tokens = query.trim().split(/\s+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return [];

  // single token or exact phrase: search as-is.
  // ueberhole etwas, damit das Title-/Pfad-Ranking (enrichResults) eine
  // kanonische Seite auch dann nach vorne ziehen kann, wenn sie nicht
  // unter den ersten maxResults Datei-Treffern liegt.
  if (tokens.length === 1) {
    let raw;
    try {
      raw = searchWithRipgrep(vaultPath, searchPath, query, contextLines, maxResults * 3);
    } catch {
      raw = searchWithNode(vaultPath, searchPath, query, contextLines, maxResults * 3);
    }
    return enrichResults(vaultPath, raw, tokens).slice(0, maxResults);
  }

  // multi-token: search with OR pattern, then rank by distinct token hits
  // use context 0 for ranking pass to keep output size manageable
  const orPattern = tokens.map(escapeRegex).join('|');
  let raw;
  try {
    raw = searchWithRipgrep(vaultPath, searchPath, orPattern, 0, maxResults * 3);
  } catch {
    raw = searchWithNodeRegex(vaultPath, searchPath, new RegExp(orPattern, 'i'), 0, maxResults * 3);
  }

  const ranked = rankByTokenCoverage(raw, tokens);

  // trim matches per file to keep response size down
  for (const result of ranked) {
    if (result.matches.length > 10) {
      result.matches = result.matches.slice(0, 10);
    }
  }

  // erst anreichern/title-ranken (Frontmatter-Treffer koennen ganze Dateien
  // droppen), dann auf maxResults begrenzen
  return enrichResults(vaultPath, ranked, tokens).slice(0, maxResults);
}

// Post-processing fuer beide Suchpfade (ripgrep + node fallback):
//  - filtert Treffer aus dem YAML-Frontmatter-Block raus (Punkt 1)
//  - haengt pro Treffer die naechste vorausgehende Ueberschrift als `heading` an (Punkt 2)
//  - markiert Dateien deren Titel/Pfad/Name auf einen Token passt mit `titleMatch` und
//    sortiert diese nach vorne, stabil zur Eingangsreihenfolge (Punkt 3)
//  - strippt trailing \r aus dem Treffer-Text (Punkt 5)
// Das bestehende Schema { file, title, matches: [{ line, text }] } bleibt erhalten,
// neue Felder kommen nur additiv dazu.
function enrichResults(vaultPath, results, tokens) {
  const tokenRegexes = tokens.map(t => new RegExp(escapeRegex(t), 'i'));
  const enriched = [];

  for (const result of results) {
    let frontmatterEnd = 0;
    let headings = [];
    try {
      const raw = readFileSync(join(vaultPath, result.file + '.md'), 'utf-8');
      ({ frontmatterEnd, headings } = buildLineIndex(raw));
    } catch {
      // Datei nicht lesbar: ohne Index weiter, nichts wird gefiltert/angereichert
    }

    const matches = [];
    for (const m of result.matches) {
      // Treffer innerhalb des Frontmatter-Blocks raushalten
      if (frontmatterEnd && m.line <= frontmatterEnd) continue;
      matches.push({
        line: m.line,
        text: typeof m.text === 'string' ? m.text.replace(/\r$/, '') : m.text,
        heading: headingForLine(headings, m.line),
      });
    }

    // alle verbliebenen Treffer waren Frontmatter-Laerm: Datei droppen
    if (matches.length === 0) continue;

    const haystack = `${result.title} ${result.file} ${basename(result.file)}`;
    const titleMatch = tokenRegexes.some(re => re.test(haystack));

    enriched.push({ ...result, matches, titleMatch });
  }

  // titleMatch zuerst, sonst stabile Eingangsreihenfolge
  enriched.sort((a, b) => (b.titleMatch === true) - (a.titleMatch === true));
  return enriched;
}

function rankByTokenCoverage(results, tokens) {
  const tokenRegexes = tokens.map(t => new RegExp(escapeRegex(t), 'i'));

  for (const result of results) {
    const allText = result.matches.map(m => m.text).join(' ');
    let hits = 0;
    for (const re of tokenRegexes) {
      if (re.test(allText) || re.test(result.title)) hits++;
    }
    result._score = hits;
  }

  results.sort((a, b) => b._score - a._score);

  for (const result of results) {
    delete result._score;
  }

  return results;
}

function searchWithRipgrep(vaultPath, searchPath, query, contextLines, maxResults) {
  // dieselbe Skip-Semantik wie der node-fallback: crawl/, node_modules/ und
  // _-/.-praefixierte Ordner sind kein Vault-Content (Punkt 4)
  const args = [
    '-i', '-n', '--no-heading', '-C', String(contextLines),
    '--glob', '*.md',
    '--glob', '!**/crawl/**',
    '--glob', '!**/node_modules/**',
    '--glob', '!**/_*/**',
    '--glob', '!**/.*/**',
    '--max-count', String(maxResults * 2), query, searchPath,
  ];

  let output;
  try {
    output = execFileSync('rg', args, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err) {
    // rg exits with code 1 when no matches found
    if (err.status === 1 && err.stdout !== undefined) {
      return [];
    }
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
  return searchWithNodeRegex(vaultPath, searchPath, new RegExp(escapeRegex(query), 'i'), contextLines, maxResults);
}

function searchWithNodeRegex(vaultPath, searchPath, regex, contextLines, maxResults) {
  const results = [];

  const mdFiles = [];
  collectMdFilePaths(searchPath, mdFiles);

  for (const filePath of mdFiles) {
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n');
    const matchingLines = [];

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
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
    if (entry.isDirectory() && !isSkippedDir(entry.name)) {
      collectMdFilePaths(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getManifest(vaultPath) {
  const manifestPath = join(vaultPath, '_manifest.json');
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
