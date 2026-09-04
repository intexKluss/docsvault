import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative, basename, sep, resolve } from 'path';
import { getCachedManifest, getCachedSections, getCachedTitleIndex, getCachedSearchIndex } from './vault-cache.js';
import { foldText, tokenize, queryTerms } from './search-index.js';

export { foldText };

// --- Konstanten -------------------------------------------------------------

// Obergrenze für Treffer-Zeilen pro Datei im detailed-Format.
const MAX_MATCHES_PER_FILE = 10;
// Wieviele gematchte Überschriften pro Datei zurückgegeben werden. Überschriften
// werden NIE gekürzt, sie müssen als heading-Parameter verbatim wieder
// reingehen; deshalb wird stattdessen ihre Anzahl klein gehalten.
const MAX_HEADINGS_PER_RESULT = 3;
// Harte Obergrenze für ein Snippet, damit ein Treffer nie ausufert.
const MAX_SNIPPET_CHARS = 300;
const MAX_SNIPPET_LINE_CHARS = 200;

// read: Default-Budget. Bewusst klein, damit heading-Targeting der Normalfall
// wird statt einer Option die niemand nutzt.
export const DEFAULT_READ_LENGTH = 8000;
// harte Obergrenze auch bei explizit grossem max_length
export var MAX_READ_LENGTH = 200000;
// ab sovielen Überschriften gilt eine Seite als "navigierbar" und bekommt bei
// fehlendem heading-Parameter Intro + Inhaltsverzeichnis statt der Rohseite.
const TOC_MIN_HEADINGS = 5;
// Obergrenze für Einträge im Inhaltsverzeichnis.
const MAX_TOC_ENTRIES = 200;

// Manche Quellen zeigen veraltete Stile (z.B. samples.md baut Gadgets noch per
// `new otris.gadget.gui.X()` statt der aktuellen funktionalen gadgetAPI). Solche
// Treffer werden abgesenkt, nicht ausgeschlossen: fehlt eine Alternative,
// rankt die Quelle weiter.
const STALE_SOURCE_FACTOR = 0.5;
const STALE_SOURCE_PATTERNS = [
  /(^|\/)samples?(\/|$)/i,
  /(^|\/)archiv(\/|$)/i,
];

// --- Basics -----------------------------------------------------------------

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

// --- read -------------------------------------------------------------------

// Liefert nur den gewünschten Abschnitt (von der passenden Überschrift bis zur
// nächsten Überschrift gleichen oder höheren Levels). '' wenn nichts passt.
function extractHeadingSection(body, heading) {
  const wanted = foldText(heading.trim());
  const lines = body.split('\n');
  let startLevel = 0;
  let startIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].replace(/\r$/, '').match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    if (foldText(m[2].trim()) === wanted) {
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

// Alle Überschriften eines Bodys als { text, level, line } (0-basierte Zeile).
function listHeadings(body) {
  const lines = body.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].replace(/\r$/, '').match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) out.push({ text: m[2], level: m[1].length, line: i });
  }
  return out;
}

// Rendert ein Inhaltsverzeichnis als "weiter mit heading=..."-Hinweis.
// budget begrenzt die Zeichen die die Überschriften-Liste belegen darf, sonst
// sprengt eine Seite mit 200 Abschnitten das Limit über den Umweg der TOC.
function renderToc(headings, note, budget = Infinity) {
  if (!headings.length) return '';
  var out = `\n\n---\n${note}\nWeiter mit heading="<name>", zum Beispiel heading="${headings[0].text}".\n\nAbschnitte (${headings.length}):\n`;
  if (out.length > budget) {
    out = `\n\nWeiter mit heading="${headings[0].text}".\n\nAbschnitte (${headings.length}):\n`;
  }
  if (out.length > budget) out = `\n\nAbschnitte (${headings.length}):\n`;

  var shown = 0;
  for (const h of headings) {
    if (shown >= MAX_TOC_ENTRIES) break;
    var separator = '';
    if (shown > 0) separator = ' | ';
    if (out.length + separator.length + h.text.length > budget) break;
    out += separator + h.text;
    shown++;
  }
  var rest = headings.length - shown;
  var restText = ` | ... +${rest} weitere, hol sie mit einem größeren max_length`;
  if (rest > 0 && out.length + restText.length <= budget) out += restText;
  return out;
}

// Schneidet an einer Zeilengrenze statt mitten im Wort.
function cutAtLineBoundary(text, maxLength) {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastNl = slice.lastIndexOf('\n');
  return lastNl > maxLength * 0.5 ? slice.slice(0, lastNl) : slice;
}

// Liest ein Dokument.
// options: { heading, maxTokens }
// Rückgabe: { title, source, content, truncated, mode, headings? }
//   mode: 'full' | 'heading' | 'toc' | 'truncated' | 'heading-not-found'
export function readDoc(vaultPath, docPath, maxLength = DEFAULT_READ_LENGTH, options = {}) {
  maxLength = clampInt(maxLength, 200, MAX_READ_LENGTH, DEFAULT_READ_LENGTH);
  const { heading } = options;
  if (Number.isFinite(Number(options.maxTokens))) {
    const budget = clampInt(options.maxTokens, 50, 50000, maxLength / 4) * 4;
    maxLength = Math.min(maxLength, budget);
  }

  let resolvedPath = docPath;
  let filePath = join(vaultPath, docPath + '.md');

  // Self-Healing: wenn der exakte Pfad nicht existiert, über den Titel-/Pfad-
  // Index nach Basename/Titel suchen.
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
  const meta = {
    title: frontmatter.title || '',
    source: frontmatter.source || '',
    path: resolvedPath,
  };
  // nur ##/### sind sinnvolle Sprungziele, # ist der Seitentitel
  const subHeadings = listHeadings(body).filter(h => h.level >= 2);

  // 1) heading-Targeting
  if (heading) {
    const section = extractHeadingSection(body, heading);
    if (section) {
      const cut = cutAtLineBoundary(section, maxLength);
      return {
        ...meta,
        content: cut,
        truncated: cut.length < section.length,
        mode: 'heading',
      };
    }
    // heading existiert nicht: NICHT still die ganze Seite ausliefern (das war
    // der teuerste Fehlerfall), sondern das Inhaltsverzeichnis anbieten.
    var content = `Abschnitt "${heading}" existiert auf dieser Seite nicht.`;
    var toc = renderToc(subHeadings, `Seite: ${resolvedPath}`, maxLength - content.length);
    if (content.length + toc.length <= maxLength) return {
      ...meta,
      content: content + toc,
      truncated: true,
      mode: 'heading-not-found',
    };
    return {
      ...meta,
      content: renderToc(subHeadings, `Seite: ${resolvedPath}`, maxLength),
      truncated: true,
      mode: 'heading-not-found',
    };
  }

  // 2) Seite passt ins Budget: komplett ausliefern
  if (body.length <= maxLength) {
    return { ...meta, content: body, truncated: false, mode: 'full' };
  }

  // 3) viele Abschnitte: Intro + Inhaltsverzeichnis statt Rohseite
  if (subHeadings.length >= TOC_MIN_HEADINGS) {
    const introEnd = body.split('\n').slice(0, subHeadings[0].line).join('\n').trimEnd();
    const intro = cutAtLineBoundary(introEnd, Math.floor(maxLength / 3));
    var prefix = intro;
    if (!prefix) prefix = `# ${meta.title || resolvedPath}`;
    if (prefix.length > maxLength) prefix = '';
    var toc = renderToc(
      subHeadings,
      `Seite gekuerzt (${body.length} Zeichen, ${subHeadings.length} Abschnitte). Nur Intro oben.`,
      maxLength - prefix.length
    );
    return {
      ...meta,
      content: prefix + toc,
      truncated: true,
      mode: 'toc',
    };
  }

  // 4) wenige Abschnitte: abschneiden und die verbleibenden Überschriften nennen
  const cut = cutAtLineBoundary(body, Math.floor(maxLength / 2));
  const cutLine = cut.split('\n').length - 1;
  const remaining = subHeadings.filter(h => h.line > cutLine);
  return {
    ...meta,
    content: cut + renderToc(remaining, `Ab hier gekuerzt (${body.length} Zeichen gesamt).`, maxLength - cut.length),
    truncated: true,
    mode: 'truncated',
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

  // 2) Nähe-Treffer werden NIE still als einzelnes Dokument aufgelöst. Ein
  // blosser Substring (z.B. "doc" in "DocFile") ist inhärent mehrdeutig und
  // würde sonst stillschweigend das falsche Dokument liefern statt eines 404.
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

// --- search -----------------------------------------------------------------

function staleFactor(filePath) {
  return STALE_SOURCE_PATTERNS.some(re => re.test(filePath)) ? STALE_SOURCE_FACTOR : 1;
}

// Zeilen die als Snippet nichts aussagen.
function isNoiseLine(text) {
  const t = String(text).trim();
  if (!t) return true;
  if (/^`{3,}/.test(t)) return true;            // Code-Fence
  if (/^#{1,6}(\s|$)/.test(t)) return true;     // Überschrift, steht schon in headings
  if (/^[|\-+:=_*~\s]+$/.test(t)) return true;  // Tabellen-/Trennlinie
  if (/^[<>{}[\]()]+$/.test(t)) return true;
  return false;
}

function cachedLines(vaultPath, relPath, store) {
  if (store.has(relPath)) return store.get(relPath);
  let lines = [];
  try {
    lines = readFileSync(join(vaultPath, relPath + '.md'), 'utf-8').split('\n');
  } catch {
    lines = [];
  }
  store.set(relPath, lines);
  return lines;
}

// IDF-Masse der Query-Tokens die in einer Zeile vorkommen.
function lineWeight(line, terms, idf) {
  const folded = foldText(line);
  let sum = 0;
  for (const t of terms) {
    if (folded.includes(t)) sum += idf(t);
  }
  return sum;
}

// Baut EIN Snippet: die aussagekräftigste Zeile des besten Abschnitts plus
// bis zu `span` Zeilen Kontext, ohne Rauschzeilen.
function buildSnippet(lines, seg, terms, idf, span) {
  const from = Math.max(0, seg.startLine - 1);
  const to = Math.min(lines.length, seg.endLine);

  let bestIdx = -1;
  let bestWeight = 0;
  for (let i = from; i < to; i++) {
    const text = lines[i].replace(/\r$/, '');
    if (isNoiseLine(text)) continue;
    const w = lineWeight(text, terms, idf);
    if (w > bestWeight) {
      bestWeight = w;
      bestIdx = i;
    }
  }

  // Keine Zeile trägt einen Query-Token (z.B. Property-Abschnitte, die den
  // Namen nur in der Überschrift führen): dann die längste inhaltliche Zeile
  // nehmen, das ist praktisch immer der Beschreibungstext und nicht eine
  // "- **Typ:** enum"-Metazeile.
  if (bestIdx === -1) {
    let longest = 0;
    for (let i = from; i < to; i++) {
      const text = lines[i].replace(/\r$/, '').trim();
      if (isNoiseLine(text)) continue;
      if (text.length > longest) {
        longest = text.length;
        bestIdx = i;
      }
    }
  }
  if (bestIdx === -1) return '';

  const picked = [];
  for (let i = Math.max(from, bestIdx - span); i < Math.min(to, bestIdx + span + 1); i++) {
    const text = lines[i].replace(/\r$/, '').trim();
    if (i !== bestIdx && isNoiseLine(text)) continue;
    picked.push(text.length > MAX_SNIPPET_LINE_CHARS ? text.slice(0, MAX_SNIPPET_LINE_CHARS) + '…' : text);
  }

  let snippet = picked.join('\n');
  if (snippet.length > MAX_SNIPPET_CHARS) snippet = snippet.slice(0, MAX_SNIPPET_CHARS) + '…';
  return snippet;
}

// detailed-Format: echte Treffer-Zeilen mit Kontext, wie vor der Umstellung.
function buildMatches(lines, segs, terms, idf, contextLines) {
  const seen = new Set();
  const out = [];
  for (const seg of segs) {
    const from = Math.max(0, seg.startLine - 1);
    const to = Math.min(lines.length, seg.endLine);
    for (let i = from; i < to && out.length < MAX_MATCHES_PER_FILE; i++) {
      const text = lines[i].replace(/\r$/, '');
      if (isNoiseLine(text)) continue;
      if (lineWeight(text, terms, idf) <= 0) continue;
      const start = Math.max(from, i - contextLines);
      const end = Math.min(to - 1, i + contextLines);
      for (let j = start; j <= end && out.length < MAX_MATCHES_PER_FILE; j++) {
        if (seen.has(j)) continue;
        const ctx = lines[j].replace(/\r$/, '');
        if (ctx.trim() === '') continue;
        seen.add(j);
        out.push({ line: j + 1, text: ctx, heading: seg.heading });
      }
    }
    if (out.length >= MAX_MATCHES_PER_FILE) break;
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

// true wenn die Überschrift komplett aus Query-Tokens besteht. Das ist das
// stärkste "hier ist die Definition"-Signal: `## hasInvoicePlugin` bei der
// Query "Mappentyp Eigenschaft hasInvoicePlugin".
function headingIsQuerySubset(heading, termSet) {
  const parts = tokenize(heading).map(foldText);
  if (!parts.length) return false;
  return parts.every(p => termSet.has(p));
}

// Aggregiert die Abschnitts-Treffer zu Datei-Treffern.
//
// Der entscheidende Punkt gegen den alten IDF-Fehler: primärer Diskriminator
// ist nicht die rohe BM25-Summe, sondern wieviel IDF-MASSE der Query eine Datei
// abdeckt. Eine Datei die den seltenen Token trifft schlägt damit eine Datei
// die nur zwei häufige Tokens trifft, egal wie oft.
function aggregateByFile(hits, index, terms, queryFold) {
  // Tokens die im Vault gar nicht vorkommen zählen nicht in den Nenner. Sonst
  // drückt ein Tippfehler die Coverage aller Treffer gleichmässig nach unten
  // und die Scores werden ohne Grund winzig.
  const known = terms.filter(t => index.hasTerm(t));
  const scoring = known.length ? known : terms;
  const idfTotal = scoring.reduce((s, t) => s + index.idf(t), 0) || 1;
  const termSet = new Set(terms);
  const byFile = new Map();

  for (const hit of hits) {
    const seg = index.segments.get(hit.id);
    if (!seg) continue;

    let group = byFile.get(seg.file);
    if (!group) {
      group = { file: seg.file, title: seg.title, terms: new Set(), segs: [] };
      byFile.set(seg.file, group);
    }
    for (const t of hit.terms) group.terms.add(t);

    // Abschnitts-Score: BM25, gewichtet mit der IDF-Masse die dieser Abschnitt
    // selbst abdeckt, plus Boost wenn die Überschrift der gesuchte Bezeichner ist.
    const segCoverage = hit.terms.reduce((s, t) => s + index.idf(t), 0) / idfTotal;
    let score = hit.score * segCoverage;
    if (seg.heading && headingIsQuerySubset(seg.heading, termSet)) {
      const headingIdf = tokenize(seg.heading).map(foldText).reduce((s, t) => s + index.idf(t), 0);
      score *= 1 + 3 * Math.min(1, headingIdf / idfTotal);
    }
    group.segs.push({ ...seg, score, matchedTerms: hit.terms });
  }

  const results = [];
  for (const group of byFile.values()) {
    group.segs.sort((a, b) => b.score - a.score);
    const coverage = [...group.terms].reduce((s, t) => s + index.idf(t), 0) / idfTotal;
    // quadratisch: eine Datei die den seltenen Token gar nicht enthält fällt
    // deutlich zurück, auch wenn sie die häufigen Tokens oft trifft.
    let score = group.segs[0].score * coverage * coverage;
    if (group.title && foldText(group.title) === queryFold) score *= 2;
    score *= staleFactor(group.file);
    results.push({ group, score, coverage });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// Volltextsuche über den BM25-Abschnitts-Index.
// options: { section, maxResults, contextLines, detailed, maxTokens }
export function searchDocs(vaultPath, query, options = {}) {
  const { section, detailed = false } = options;
  const contextLines = clampInt(options.contextLines, 0, 20, 3);
  const maxResults = clampInt(options.maxResults, 1, 100, 5);

  if (section) {
    const searchPath = join(vaultPath, section);
    if (!isInsideVault(vaultPath, searchPath) || !existsSync(searchPath)) return [];
  }
  if (!existsSync(vaultPath)) return [];

  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  var index = getCachedSearchIndex(vaultPath);
  if (!index || !index.segmentCount) return [];

  const sectionPrefix = section ? section.split(sep).join('/') + '/' : '';
  const filter = section
    ? (result) => {
      const seg = index.segments.get(result.id);
      return !!seg && (seg.file === section || seg.file.startsWith(sectionPrefix));
    }
    : undefined;

  let hits = index.mini.search(query, { filter });
  if (hits.length === 0) {
    // Tippfehler-/Teilwort-Rettung, nur wenn exakt gar nichts kam
    hits = index.mini.search(query, { filter, fuzzy: 0.2, prefix: true });
  }
  if (hits.length === 0) return [];

  const ranked = aggregateByFile(hits, index, terms, foldText(query.trim()));
  const top = ranked.slice(0, maxResults);

  const lineStore = new Map();
  const snippetSpan = detailed ? 1 : Math.min(contextLines, 1);
  const out = [];

  for (const entry of top) {
    const { group } = entry;
    const lines = cachedLines(vaultPath, group.file, lineStore);
    const headings = [];
    for (const seg of group.segs) {
      if (seg.heading && !headings.includes(seg.heading)) headings.push(seg.heading);
      if (headings.length >= MAX_HEADINGS_PER_RESULT) break;
    }

    const result = {
      file: group.file,
      title: group.title,
      headings,
      snippet: buildSnippet(lines, group.segs[0], terms, index.idf, snippetSpan),
      score: Math.round(entry.score * 10) / 10,
    };

    if (detailed) {
      const titleFold = foldText(group.title || '');
      const baseFold = foldText(basename(group.file));
      result.titleMatch = terms.every(t => titleFold.includes(t))
        || terms.every(t => baseFold.includes(t));
      result.matches = buildMatches(lines, group.segs.slice(0, 3), terms, index.idf, contextLines);
    }

    out.push(result);
  }

  return applyTokenBudget(out, options.maxTokens);
}

// Optionales hartes Budget: schneidet Treffer weg (und zur Not Snippets) bis die
// serialisierte Antwort unter max_tokens bleibt. ~4 Zeichen pro Token.
function applyTokenBudget(results, maxTokens) {
  const budget = Number(maxTokens);
  if (!Number.isFinite(budget) || budget <= 0) return results;
  const maxChars = Math.trunc(budget) * 4;

  let out = results;
  while (out.length > 1 && JSON.stringify(out).length > maxChars) {
    out = out.slice(0, out.length - 1);
  }
  if (JSON.stringify(out).length > maxChars) return [];
  return out;
}

export function getManifest(vaultPath) {
  return getCachedManifest(vaultPath);
}
