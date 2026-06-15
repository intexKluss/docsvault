import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative, basename, sep, resolve } from 'path';
import { execFileSync } from 'child_process';
import { isSkippedDir } from '../vault-registry.js';
import { getCachedManifest, getCachedSections, getCachedTitleIndex } from './vault-cache.js';

// geteilte Obergrenze für Treffer pro Datei (Punkt 4). Beide Suchpfade
// (single-token + multi-token) nutzen dieselbe Zahl damit ein einzelnes
// Dokument die Antwort nicht flutet.
const MAX_MATCHES_PER_FILE = 10;

function isInsideVault(vaultPath, targetPath) {
  const resolvedVault = resolve(vaultPath);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget.startsWith(resolvedVault + sep) || resolvedTarget === resolvedVault;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function getSections(vaultPath) {
  return getCachedSections(vaultPath);
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

// Liefert nur die gewünschte Abschnittsabschnitt (von der passenden Überschrift
// bis zur nächsten Überschrift gleichen oder höheren Levels). '' wenn nichts passt.
function extractHeadingSection(body, heading) {
  const wanted = heading.trim().toLowerCase();
  const lines = body.split('\n');
  let startLevel = 0;
  let startIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].replace(/\r$/, '').match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    if (m[2].trim().toLowerCase() === wanted) {
      startLevel = m[1].length;
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return '';

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].replace(/\r$/, '').match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n').trimEnd();
}

export function readDoc(vaultPath, docPath, maxLength = 50000, options = {}) {
  maxLength = clampInt(maxLength, 1, 200000, 50000);
  const { heading } = options;

  let resolvedPath = docPath;
  let filePath = join(vaultPath, docPath + '.md');

  // Self-Healing (Punkt 17): wenn der exakte Pfad nicht existiert, über den
  // Titel-/Pfad-Index nach Basename/Titel suchen.
  if (!isInsideVault(vaultPath, filePath) || !existsSync(filePath)) {
    const healed = healDocPath(vaultPath, docPath);
    if (healed && healed.path) {
      resolvedPath = healed.path;
      filePath = join(vaultPath, resolvedPath + '.md');
    } else if (healed && healed.candidates) {
      return { error: healed.error, candidates: healed.candidates };
    } else {
      return null;
    }
  }

  if (!isInsideVault(vaultPath, filePath) || !existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);

  let content = body;
  let truncated = false;

  // optionales heading-Targeting: nur den passenden Abschnitt zurückgeben
  if (heading) {
    const section = extractHeadingSection(body, heading);
    if (section) {
      content = section;
    }
  }

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

// Versucht einen nicht gefundenen Pfad über den Titel-Index zu heilen.
// Rückgabe:
//  - { path } bei eindeutigem/besten Treffer
//  - { error, candidates } wenn nur mehrdeutige Nähe-Treffer existieren
//  - null wenn gar nichts passt
function healDocPath(vaultPath, docPath) {
  const index = getCachedTitleIndex(vaultPath);
  if (!index.length) return null;

  const wantedBase = foldText(basename(docPath).toLowerCase());
  const wantedFull = foldText(docPath.toLowerCase().split(sep).join('/'));

  // 1) exakter Basename- oder Titel-Match (gefaltet)
  const exact = index.filter(e =>
    foldText(e.name.toLowerCase()) === wantedBase ||
    foldText(e.title.toLowerCase()) === wantedBase
  );
  if (exact.length === 1) return { path: exact[0].path };
  if (exact.length > 1) {
    return {
      error: `Document not found: ${docPath}. Did you mean one of these?`,
      candidates: exact.slice(0, 8).map(e => e.path),
    };
  }

  // 2) Nähe-Treffer: Basename/Titel/Pfad enthält den gesuchten Basename.
  // Anders als der exakte Treffer wird ein Nähe-Treffer NIE still als einzelnes
  // Dokument aufgelöst. Ein bloßer Substring (z.B. "doc" in "DocFile") ist
  // inhärent mehrdeutig und würde sonst stillschweigend das falsche Dokument
  // liefern statt eines 404. Nähe-Treffer kommen daher immer als "did you mean"-
  // Kandidaten zurück; der Aufrufer entscheidet (handleRead -> error -> 404).
  const near = index.filter(e =>
    foldText(e.name.toLowerCase()).includes(wantedBase) ||
    foldText(e.title.toLowerCase()).includes(wantedBase) ||
    foldText(e.path.toLowerCase()).includes(wantedFull)
  );
  if (near.length > 0) {
    return {
      error: `Document not found: ${docPath}. Did you mean one of these?`,
      candidates: near.slice(0, 8).map(e => e.path),
    };
  }

  return null;
}

// Baut einen Zeilen-Index für eine roh eingelesene Datei:
//  - frontmatterEnd: 1-basierte Zeilennummer des schließenden '---' (0 = kein Frontmatter)
//  - headings: { line, text, level } aller Markdown-Überschriften (#, ##, ...)
function buildLineIndex(raw) {
  const lines = raw.split('\n');
  let frontmatterEnd = 0;

  // Frontmatter nur wenn die allererste Zeile genau '---' ist (CRLF-tolerant)
  if (lines.length && lines[0].replace(/\r$/, '').replace(/^﻿/, '') === '---') {
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
    if (m) headings.push({ line: i + 1, text: m[2].replace(/\r$/, ''), level: m[1].length });
  }

  return { frontmatterEnd, headings, lines };
}

// Nächste vorausgehende Überschrift für eine Trefferzeile (oder '').
function headingForLine(headings, line) {
  let current = '';
  for (const h of headings) {
    if (h.line <= line) current = h.text;
    else break;
  }
  return current;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const yamlBlock = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w+)\s*:\s*"?(.+?)"?\s*$/);
    if (kv) {
      frontmatter[kv[1]] = kv[2].replace(/\r$/, '');
    }
  }

  return { frontmatter, body };
}

// Umlaut-/ss-Folding (Punkt 7): normalisiert deutschen Text so dass ae/ä,
// oe/ö, ue/ü, ss/ß als gleich gelten. Wird symmetrisch auf Query-Tokens UND
// Suchtext/Titel/Pfad angewandt damit "uebersicht" auch "Übersicht" findet.
function foldText(str) {
  return String(str)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

// Baut aus einem Token ein Regex-Fragment das beide Schreibweisen matcht:
// 'ue' -> (?:ue|ü), 'ü' -> (?:ü|ue), 'ss' -> (?:ss|ß) usw. Der Token wird zuerst
// regex-escaped, dann werden die gefoldeten Stellen zu Alternationen aufgeweitet.
function tokenToFoldedPattern(token) {
  // erst auf die gefaltete Form bringen, dann Stück für Stück escapen und
  // an ae/oe/ue/ss Alternationen einsetzen.
  const folded = foldText(token);
  let out = '';
  for (let i = 0; i < folded.length; i++) {
    const two = folded.slice(i, i + 2);
    if (two === 'ae') { out += '(?:ae|ä)'; i++; continue; }
    if (two === 'oe') { out += '(?:oe|ö)'; i++; continue; }
    if (two === 'ue') { out += '(?:ue|ü)'; i++; continue; }
    if (two === 'ss') { out += '(?:ss|ß)'; i++; continue; }
    out += escapeRegex(folded[i]);
  }
  return out;
}

function foldedTokenRegex(token, flags = 'i') {
  return new RegExp(tokenToFoldedPattern(token), flags);
}

// Tokenizer (Punkt 8): split auf Whitespace UND Identifier-trennende
// Interpunktion (. ( ) [ ] :: ->), min length >= 2. Die Original-Phrase bleibt
// für den Exact-Match-Boost separat erhalten.
function tokenize(query) {
  return query
    .trim()
    .split(/[\s.()[\]]+|::|->/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);
}

// splits query into tokens, searches each, ranks by number of distinct token hits
export function searchDocs(vaultPath, query, options = {}) {
  const { section } = options;
  // Defensive Clamps (Punkt 12): auch wenn zod schon begrenzt, hier hart machen.
  const contextLines = clampInt(options.contextLines, 0, 20, 3);
  const maxResults = clampInt(options.maxResults, 1, 100, 10);

  const searchPath = section ? join(vaultPath, section) : vaultPath;

  if (!isInsideVault(vaultPath, searchPath)) return [];

  if (!existsSync(searchPath)) {
    return [];
  }

  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  // Kandidaten-Obergrenze für das Lesen: rg/node streamen in Pfad-Reihenfolge,
  // nach ~maxResults*3 distinct Dateien hören wir auf zu sammeln (Punkt 2).
  const candidateCap = maxResults * 3;

  if (tokens.length === 1) {
    let raw;
    try {
      raw = searchWithRipgrep(vaultPath, searchPath, query, contextLines, candidateCap, true);
    } catch {
      raw = searchWithNode(vaultPath, searchPath, tokens[0], contextLines, candidateCap);
    }

    // Titel-/Pfad-Vorlauf (Punkt 3): kanonische Seiten mergen die nicht unter
    // den ersten Datei-Treffern lagen.
    raw = mergeTitleCandidates(vaultPath, searchPath, raw, tokens, contextLines);

    return enrichResults(vaultPath, raw, tokens, query).slice(0, maxResults);
  }

  // multi-token: search with folded OR pattern, then rank by distinct token hits
  const orPattern = tokens.map(tokenToFoldedPattern).join('|');
  let raw;
  try {
    raw = searchWithRipgrep(vaultPath, searchPath, orPattern, 0, candidateCap, false);
  } catch {
    raw = searchWithNodeRegex(vaultPath, searchPath, new RegExp(orPattern, 'i'), 0, candidateCap);
  }

  raw = mergeTitleCandidates(vaultPath, searchPath, raw, tokens, 0);

  const ranked = rankByTokenCoverage(vaultPath, raw, tokens, query);

  for (const result of ranked) {
    if (result.matches.length > MAX_MATCHES_PER_FILE) {
      result.matches = result.matches.slice(0, MAX_MATCHES_PER_FILE);
    }
  }

  // context_lines für multi-token nachreichen (Punkt 5): der Suchlauf lief mit
  // Kontext 0; nach Ranking/Trim die gewünschten Kontextzeilen um die
  // überlebenden Treffer hängen.
  const trimmed = ranked.slice(0, candidateCap);
  if (contextLines > 0) {
    attachContext(vaultPath, trimmed, contextLines);
  }

  return enrichResults(vaultPath, trimmed, tokens, query).slice(0, maxResults);
}

// Fügt für multi-token-Ergebnisse die gewünschten Kontextzeilen um jede
// Trefferzeile hinzu (Punkt 5). Liest jede Datei einmal.
function attachContext(vaultPath, results, contextLines) {
  for (const result of results) {
    let lines;
    try {
      lines = readFileSync(join(vaultPath, result.file + '.md'), 'utf-8').split('\n');
    } catch {
      continue;
    }
    const seen = new Set(result.matches.map(m => m.line));
    const expanded = [...result.matches];
    for (const m of result.matches) {
      const idx = m.line - 1;
      const start = Math.max(0, idx - contextLines);
      const end = Math.min(lines.length - 1, idx + contextLines);
      for (let j = start; j <= end; j++) {
        if (!seen.has(j + 1)) {
          seen.add(j + 1);
          expanded.push({ line: j + 1, text: lines[j] });
        }
      }
    }
    expanded.sort((a, b) => a.line - b.line);
    result.matches = expanded;
  }
}

// Titel-/Pfad-Vorlauf (Punkt 3): findet über den gecachten Titel-Index Dateien
// deren Basename oder Frontmatter-Titel auf IRGENDEINEN Token passt, und merged
// diese (deduped by file) in das Ergebnis-Set BEVOR auf maxResults geschnitten
// wird. So landet die kanonische Seite garantiert im Ranking.
function mergeTitleCandidates(vaultPath, searchPath, results, tokens, contextLines) {
  const index = getCachedTitleIndex(vaultPath);
  if (!index.length) return results;

  const tokenRes = tokens.map(t => foldedTokenRegex(t));
  const seen = new Set(results.map(r => r.file));
  const sectionRel = relative(vaultPath, searchPath).split(sep).join('/');

  for (const entry of index) {
    if (seen.has(entry.path)) continue;
    // section-scope respektieren
    if (sectionRel && sectionRel !== '.' && !(entry.path === sectionRel || entry.path.startsWith(sectionRel + '/'))) {
      continue;
    }
    const hay = foldText(`${entry.title} ${entry.name} ${entry.path}`);
    if (!tokenRes.some(re => re.test(hay))) continue;

    seen.add(entry.path);
    // Body-Treffer für diese Kandidaten ziehen damit echte Snippets entstehen.
    const matches = matchesForFile(vaultPath, entry.path, tokens, contextLines);
    results.push({ file: entry.path, title: entry.title, matches });
  }

  return results;
}

// Liest eine einzelne Datei und liefert Treffer-Zeilen (mit Kontext) für die
// gegebenen Tokens. Genutzt vom Titel-Vorlauf.
function matchesForFile(vaultPath, relPath, tokens, contextLines) {
  let lines;
  try {
    lines = readFileSync(join(vaultPath, relPath + '.md'), 'utf-8').split('\n');
  } catch {
    return [];
  }
  const tokenRes = tokens.map(t => foldedTokenRegex(t));
  const matchingLines = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (tokenRes.some(re => re.test(lines[i]))) {
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length - 1, i + contextLines);
      for (let j = start; j <= end; j++) {
        if (!seen.has(j + 1)) {
          seen.add(j + 1);
          matchingLines.push({ line: j + 1, text: lines[j] });
        }
      }
    }
  }
  matchingLines.sort((a, b) => a.line - b.line);
  return matchingLines;
}

// Post-processing für beide Suchpfade (ripgrep + node fallback):
//  - filtert Treffer aus dem YAML-Frontmatter-Block raus
//  - droppt leere/whitespace-only Treffer-Zeilen (Punkt 4)
//  - hängt pro Treffer die nächste vorausgehende Überschrift als `heading` an
//  - markiert Dateien deren Titel/Pfad/Name auf einen Token passt mit `titleMatch`
//  - vergibt einen numerischen `score` (graded titleMatch, Punkt 10) und sortiert danach
//  - strippt trailing \r aus dem Treffer-Text
//  - frontmatter-only-Snippet (Punkt 11): titleMatch-Dateien ohne Body-Treffer
//    bekommen einen synthetisierten Snippet statt gedroppt zu werden
// Das bestehende Schema { file, title, matches: [{ line, text, heading }], titleMatch }
// bleibt erhalten, `score` kommt additiv dazu.
function enrichResults(vaultPath, results, tokens, query) {
  const enriched = [];
  const titleByPath = new Map(getCachedTitleIndex(vaultPath).map(e => [e.path, e.title]));

  for (const result of results) {
    // Titel aus dem Index nachziehen wenn der Suchpfad keinen geliefert hat
    // (rg/node liefern leeren Titel, nur readDoc/Index kennt ihn).
    if (!result.title && titleByPath.has(result.file)) {
      result.title = titleByPath.get(result.file);
    }

    let frontmatterEnd = 0;
    let headings = [];
    let lines = [];
    try {
      const raw = readFileSync(join(vaultPath, result.file + '.md'), 'utf-8');
      ({ frontmatterEnd, headings, lines } = buildLineIndex(raw));
    } catch {
      // Datei nicht lesbar: ohne Index weiter, nichts wird gefiltert/angereichert
    }

    const matches = [];
    for (const m of result.matches) {
      // Treffer innerhalb des Frontmatter-Blocks raushalten
      if (frontmatterEnd && m.line <= frontmatterEnd) continue;
      const text = typeof m.text === 'string' ? m.text.replace(/\r$/, '') : m.text;
      // leere/whitespace-only Kontext-/Trefferzeilen droppen (Punkt 4)
      if (typeof text === 'string' && text.trim() === '') continue;
      matches.push({
        line: m.line,
        text,
        heading: headingForLine(headings, m.line),
      });
    }

    // geteilte Obergrenze für Treffer pro Datei (Punkt 4): gilt für BEIDE
    // Branches, damit auch single-token nicht eine Datei mit Treffern flutet.
    if (matches.length > MAX_MATCHES_PER_FILE) {
      matches.length = MAX_MATCHES_PER_FILE;
    }

    const { titleMatch, titleScore } = scoreTitle(result, tokens, query);

    if (matches.length === 0) {
      // frontmatter-only-Snippet (Punkt 11): titleMatch ohne echten Body-Treffer
      // nicht droppen, sondern aus erster Body-Zeile/Heading synthetisieren.
      if (titleMatch && lines.length) {
        const synth = synthesizeSnippet(lines, frontmatterEnd, headings);
        if (synth) {
          matches.push(synth);
        }
      }
      if (matches.length === 0) continue;
    }

    // term-frequency über alle Treffer-Texte (klein gewichtet, Punkt 9)
    const bodyScore = scoreBody(matches, tokens);
    const score = titleScore + bodyScore;

    enriched.push({ ...result, matches, titleMatch, score });
  }

  // höherer score zuerst, sonst stabile Eingangsreihenfolge
  enriched.sort((a, b) => b.score - a.score);
  return enriched;
}

// graded titleMatch (Punkt 10): liefert boolean titleMatch + numerischen Beitrag.
//  - normalisierter Titel == Query -> großer Boost
//  - alle Tokens im Titel -> mittlerer Boost
//  - Basename/Pfad-Token-Treffer -> kleiner Boost
function scoreTitle(result, tokens, query) {
  const titleFold = foldText(result.title || '');
  const baseFold = foldText(basename(result.file));
  const pathFold = foldText(result.file);
  const queryFold = foldText(query || '');

  const tokenRes = tokens.map(t => foldedTokenRegex(t));

  let titleScore = 0;
  let titleMatch = false;

  if (titleFold && titleFold === queryFold) {
    titleScore += 100;
    titleMatch = true;
  }

  if (titleFold && tokenRes.every(re => re.test(titleFold))) {
    titleScore += 30;
    titleMatch = true;
  }

  if (tokenRes.some(re => re.test(baseFold))) {
    titleScore += 10;
    titleMatch = true;
  }

  if (tokenRes.some(re => re.test(pathFold))) {
    titleScore += 5;
    titleMatch = true;
  }

  if (titleFold && tokenRes.some(re => re.test(titleFold))) {
    titleScore += 5;
    titleMatch = true;
  }

  return { titleMatch, titleScore };
}

// Body-Score (Punkt 9): distinct-token coverage + Phrasen-/Proximity-Bonus
// (alle Tokens auf einer Zeile) + kleiner, gedeckelter term-frequency-Anteil.
function scoreBody(matches, tokens) {
  const tokenRes = tokens.map(t => foldedTokenRegex(t));
  const lineTexts = matches.map(m => foldText(typeof m.text === 'string' ? m.text : ''));
  const allText = lineTexts.join('\n');

  // distinct-token coverage
  let coverage = 0;
  for (const re of tokenRes) {
    if (re.test(allText)) coverage++;
  }
  let score = coverage * 4;

  // Proximity: alle Tokens auf einer einzigen Zeile
  if (tokens.length > 1) {
    const allOnOneLine = lineTexts.some(line => tokenRes.every(re => re.test(line)));
    if (allOnOneLine) score += 6;
  }

  // gedeckelte term-frequency
  let tf = 0;
  for (const re of tokenRes) {
    const global = new RegExp(re.source, 'gi');
    const count = (allText.match(global) || []).length;
    tf += Math.min(count, 3);
  }
  score += Math.min(tf, 9);

  return score;
}

// synthetisiert einen Snippet aus der ersten nicht-leeren Body-Zeile, sonst
// aus der ersten Überschrift nach dem Frontmatter (Punkt 11).
function synthesizeSnippet(lines, frontmatterEnd, headings) {
  for (let i = frontmatterEnd; i < lines.length; i++) {
    const text = lines[i].replace(/\r$/, '');
    if (text.trim() !== '') {
      return { line: i + 1, text, heading: headingForLine(headings, i + 1) };
    }
  }
  if (headings.length) {
    const h = headings.find(hh => hh.line > frontmatterEnd) || headings[0];
    return { line: h.line, text: '#'.repeat(h.level) + ' ' + h.text, heading: h.text };
  }
  return null;
}

// Pre-Slice-Ranking: nutzt denselben Score wie enrichResults (titleScore +
// bodyScore), damit titleMatch-Seiten den candidateCap-Slice überleben und
// nicht hinter coverage-stärkeren Beispielseiten weggeschnitten werden.
// Titel werden vorab aus dem Index nachgezogen (rg/node liefern leeren Titel),
// sonst greift der Titel-Boost hier noch nicht.
function rankByTokenCoverage(vaultPath, results, tokens, query) {
  const titleByPath = new Map(getCachedTitleIndex(vaultPath).map(e => [e.path, e.title]));

  for (const result of results) {
    if (!result.title && titleByPath.has(result.file)) {
      result.title = titleByPath.get(result.file);
    }
    const { titleScore } = scoreTitle(result, tokens, query);
    result._score = titleScore + scoreBody(result.matches, tokens);
  }

  results.sort((a, b) => b._score - a._score);

  for (const result of results) {
    delete result._score;
  }

  return results;
}

// fixed: bei true wird -F/--fixed-strings gesetzt (literal match, Punkt 6).
function searchWithRipgrep(vaultPath, searchPath, query, contextLines, maxResults, fixed) {
  // dieselbe Skip-Semantik wie der node-fallback: crawl/, node_modules/ und
  // _-/.-präfixierte Ordner sind kein Vault-Content.
  // --json (Punkt 1): strukturierter Stream löst CRLF-, greedy-regex- und
  // embedded-path-Probleme in einem Schritt.
  const args = [
    '-i', '--json', '-C', String(contextLines),
    '--glob', '*.md',
    '--glob', '!**/crawl/**',
    '--glob', '!**/node_modules/**',
    '--glob', '!**/_*/**',
    '--glob', '!**/.*/**',
  ];
  if (fixed) {
    // single-token literal: -F damit es wie der node-Pfad matcht. Damit Umlaut-
    // Folding nicht schlechter ist als node, beide Varianten als separate
    // fixed-strings -e Patterns mitgeben.
    const variants = new Set([query, ...foldVariants(query)]);
    for (const v of variants) {
      args.push('-F', '-e', v);
    }
  } else {
    args.push('-e', query);
  }
  args.push(searchPath);

  let output;
  try {
    output = execFileSync('rg', args, { encoding: 'utf-8', timeout: 10000, maxBuffer: 64 * 1024 * 1024 }).trim();
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

  return parseRipgrepJson(vaultPath, output, maxResults);
}

// erzeugt die gefoldeten Schreibvarianten eines literalen Query-Strings, damit
// der rg-Pfad bei -F (keine Regex) trotzdem Umlaute findet (Punkt 7).
function foldVariants(query) {
  const out = new Set();
  out.add(foldText(query));
  // umgekehrt: ae->ä etc. (nur die häufigste Rückrichtung)
  out.add(query.toLowerCase()
    .replace(/ae/g, 'ä')
    .replace(/oe/g, 'ö')
    .replace(/ue/g, 'ü')
    .replace(/ss/g, 'ß'));
  out.delete('');
  return out;
}

// Parst den rg --json-Stream (Punkt 1). type:"match"-Events liefern
// data.path.text, data.line_number, data.lines.text verbatim. Kontextzeilen
// kommen als type:"context". Stoppt nach maxResults distinct Dateien (Punkt 2).
export function parseRipgrepJson(vaultPath, output, maxResults) {
  const fileGroups = new Map();
  let distinctFiles = 0;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type !== 'match' && evt.type !== 'context') continue;

    const data = evt.data;
    if (!data || !data.path || typeof data.path.text !== 'string') continue;
    const absPath = data.path.text;
    const relPath = relative(vaultPath, absPath).replace(/\.md$/, '').split(sep).join('/');

    if (!fileGroups.has(relPath)) {
      // Kandidaten-Obergrenze: nach maxResults distinct Dateien nicht mehr
      // sammeln (rg streamt in Pfad-Reihenfolge).
      if (distinctFiles >= maxResults) continue;
      distinctFiles++;
      fileGroups.set(relPath, { file: relPath, title: '', matches: [] });
    }

    const lineNumber = data.line_number;
    const text = data.lines && typeof data.lines.text === 'string'
      ? data.lines.text.replace(/\r?\n$/, '')
      : '';
    if (typeof lineNumber === 'number') {
      fileGroups.get(relPath).matches.push({ line: lineNumber, text });
    }
  }

  return Array.from(fileGroups.values());
}

function searchWithNode(vaultPath, searchPath, token, contextLines, maxResults) {
  return searchWithNodeRegex(vaultPath, searchPath, foldedTokenRegex(token), contextLines, maxResults);
}

function searchWithNodeRegex(vaultPath, searchPath, regex, contextLines, maxResults) {
  const results = [];

  const mdFiles = [];
  collectMdFilePaths(searchPath, mdFiles);

  for (const filePath of mdFiles) {
    // Kandidaten-Obergrenze BEVOR weitere Dateien gelesen werden (Punkt 2):
    // nicht erst den ganzen Vault lesen und dann slicen.
    if (results.length >= maxResults) break;

    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n');
    const matchingLines = [];
    const seen = new Set();

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length - 1, i + contextLines);
        for (let j = start; j <= end; j++) {
          if (!seen.has(j + 1)) {
            seen.add(j + 1);
            matchingLines.push({ line: j + 1, text: lines[j] });
          }
        }
      }
    }

    if (matchingLines.length > 0) {
      const relPath = relative(vaultPath, filePath).replace(/\.md$/, '').split(sep).join('/');
      matchingLines.sort((a, b) => a.line - b.line);
      results.push({
        file: relPath,
        title: '',
        matches: matchingLines,
      });
    }
  }

  return results;
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
  return getCachedManifest(vaultPath);
}
