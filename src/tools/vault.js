import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative, basename, sep, resolve } from 'path';
import { getCachedManifest, getCachedSections, getCachedTitleIndex, getCachedSearchIndex } from './vault-cache.js';
import { foldText, tokenize, queryTerms, splitIntoSections } from './search-index.js';

export { foldText };

var MAX_MATCHES_PER_FILE = 10;
var MAX_HEADINGS_PER_RESULT = 3;
var MAX_SNIPPET_CHARS = 300;
var MAX_SNIPPET_LINE_CHARS = 200;
export var DEFAULT_READ_LENGTH = 8000;
export var MAX_READ_LENGTH = 200000;
var TOC_MIN_HEADINGS = 5;
var MAX_TOC_ENTRIES = 200;
var STALE_SOURCE_FACTOR = 0.5;
var STALE_SOURCE_PATTERNS = [
  /(^|\/)samples?(\/|$)/i,
  /(^|\/)archiv(\/|$)/i,
];

export function getSections(vaultPath) {
  return getCachedSections(vaultPath);
}

export function listFiles(vaultPath, section, subfolder) {
  var searchDirectory = join(vaultPath, section);
  if (subfolder) searchDirectory = join(vaultPath, section, subfolder);
  if (!isInsideVault(vaultPath, searchDirectory)) return [];
  if (!existsSync(searchDirectory) || !statSync(searchDirectory).isDirectory()) return [];

  var results = [];
  collectMdFiles(searchDirectory, vaultPath, results);
  results.sort(function (first, second) {
    return first.name.localeCompare(second.name);
  });
  return results;
}

export function readDoc(vaultPath, docPath, maxLength = DEFAULT_READ_LENGTH, options = {}) {
  maxLength = clampInt(maxLength, 200, MAX_READ_LENGTH, DEFAULT_READ_LENGTH);
  var heading = options.heading;
  var locator = options.locator;
  if (Number.isFinite(Number(options.maxTokens))) {
    var budget = clampInt(options.maxTokens, 50, 50000, maxLength / 4) * 4;
    maxLength = Math.min(maxLength, budget);
  }

  var resolvedPath = docPath;
  var filePath = join(vaultPath, docPath + '.md');
  if (!isInsideVault(vaultPath, filePath) || !existsSync(filePath)) {
    var healed = healDocPath(vaultPath, docPath);
    if (healed && healed.path) {
      resolvedPath = healed.path;
      filePath = join(vaultPath, resolvedPath + '.md');
    } else if (healed && healed.candidates) {
      return { error: healed.error, candidates: healed.candidates };
    } else {
      return null;
    }
  }
  if (!isInsideVault(vaultPath, filePath) || !existsSync(filePath)) return null;

  var raw = readFileSync(filePath, 'utf-8');
  var parsed = parseFrontmatter(raw);
  var frontmatter = parsed.frontmatter;
  var body = parsed.body;
  var meta = {
    title: frontmatter.title || '',
    source: frontmatter.source || '',
    path: resolvedPath,
  };

  var bodySections = splitIntoSections(body);
  var subHeadings = [];
  for (var sectionIndex = 0; sectionIndex < bodySections.length; sectionIndex++) {
    if (bodySections[sectionIndex].level < 2) continue;
    subHeadings.push({
      text: bodySections[sectionIndex].heading,
      level: bodySections[sectionIndex].level,
      line: bodySections[sectionIndex].startLine - 1,
    });
  }

  if (locator) {
    var locatorMatch = String(locator).match(/^L([1-9]\d*)$/);
    var locatorSection = '';
    if (locatorMatch) {
      var wantedStartLine = Number(locatorMatch[1]);
      var rawSections = splitIntoSections(raw);
      for (var sectionIndex = 0; sectionIndex < rawSections.length; sectionIndex++) {
        if (rawSections[sectionIndex].startLine !== wantedStartLine) continue;

        var rawLines = raw.split('\n');
        for (var lineIndex = wantedStartLine - 1; lineIndex < rawSections[sectionIndex].endLine; lineIndex++) {
          if (locatorSection) locatorSection += '\n';
          locatorSection += rawLines[lineIndex];
        }
        locatorSection = locatorSection.trimEnd();
        break;
      }
    }

    if (locatorSection) {
      var cutSection = cutAtLineBoundary(locatorSection, maxLength);
      return {
        ...meta,
        content: cutSection,
        truncated: cutSection.length < locatorSection.length,
        mode: 'heading',
      };
    }

    var content = `Abschnitt mit Locator "${locator}" existiert auf dieser Seite nicht.`;
    var toc = renderToc(subHeadings, `Seite: ${resolvedPath}`, maxLength - content.length);
    if (content.length + toc.length <= maxLength) {
      return {
        ...meta,
        content: content + toc,
        truncated: true,
        mode: 'heading-not-found',
      };
    }
    return {
      ...meta,
      content: renderToc(subHeadings, `Seite: ${resolvedPath}`, maxLength),
      truncated: true,
      mode: 'heading-not-found',
    };
  }

  if (heading) {
    var section = extractHeadingSection(body, heading, bodySections);
    if (section) {
      var cutSection = cutAtLineBoundary(section, maxLength);
      return {
        ...meta,
        content: cutSection,
        truncated: cutSection.length < section.length,
        mode: 'heading',
      };
    }

    var content = `Abschnitt "${heading}" existiert auf dieser Seite nicht.`;
    var toc = renderToc(subHeadings, `Seite: ${resolvedPath}`, maxLength - content.length);
    if (content.length + toc.length <= maxLength) {
      return {
        ...meta,
        content: content + toc,
        truncated: true,
        mode: 'heading-not-found',
      };
    }
    return {
      ...meta,
      content: renderToc(subHeadings, `Seite: ${resolvedPath}`, maxLength),
      truncated: true,
      mode: 'heading-not-found',
    };
  }

  if (body.length <= maxLength) {
    return { ...meta, content: body, truncated: false, mode: 'full' };
  }

  if (subHeadings.length >= TOC_MIN_HEADINGS) {
    var bodyLines = body.split('\n');
    var introEnd = '';
    for (var lineIndex = 0; lineIndex < subHeadings[0].line; lineIndex++) {
      if (lineIndex > 0) introEnd += '\n';
      introEnd += bodyLines[lineIndex];
    }
    introEnd = introEnd.trimEnd();

    var intro = cutAtLineBoundary(introEnd, Math.floor(maxLength / 3));
    var prefix = intro;
    if (!prefix) prefix = `# ${meta.title || resolvedPath}`;
    if (prefix.length > maxLength) prefix = '';
    var toc = renderToc(
      subHeadings,
      `Seite gekürzt (${body.length} Zeichen, ${subHeadings.length} Abschnitte). Nur Intro oben.`,
      maxLength - prefix.length
    );
    return {
      ...meta,
      content: prefix + toc,
      truncated: true,
      mode: 'toc',
    };
  }

  var cut = cutAtLineBoundary(body, Math.floor(maxLength / 2));
  var cutLine = cut.split('\n').length - 1;
  var remaining = [];
  for (var headingIndex = 0; headingIndex < subHeadings.length; headingIndex++) {
    if (subHeadings[headingIndex].line > cutLine) remaining.push(subHeadings[headingIndex]);
  }
  return {
    ...meta,
    content: cut + renderToc(remaining, `Ab hier gekürzt (${body.length} Zeichen gesamt).`, maxLength - cut.length),
    truncated: true,
    mode: 'truncated',
  };
}

export function searchDocs(vaultPath, query, options = {}) {
  var section = options.section;
  var detailed = options.detailed === true;
  var contextLines = clampInt(options.contextLines, 0, 20, 3);
  var maxResults = clampInt(options.maxResults, 1, 100, 5);

  if (section) {
    var searchPath = join(vaultPath, section);
    if (!isInsideVault(vaultPath, searchPath) || !existsSync(searchPath)) return [];
  }
  if (!existsSync(vaultPath)) return [];

  var terms = queryTerms(query);
  if (terms.length === 0) return [];

  var index = getCachedSearchIndex(vaultPath);
  if (!index || !index.segmentCount) return [];

  var sectionPrefix = '';
  var filter;
  if (section) {
    sectionPrefix = normalizeSlashes(section) + '/';
    filter = function (result) {
      var segment = index.segments.get(result.id);
      return !!segment && segment.file.startsWith(sectionPrefix);
    };
  }

  var hits = index.mini.search(query, { filter });
  if (hits.length === 0) {
    hits = index.mini.search(query, { filter, fuzzy: 0.2, prefix: true });
  }
  if (hits.length === 0) return [];

  var queryFold = foldText(query.trim());
  var termSet = new Set(terms);
  var ranked = aggregateByFile(hits, index, terms, queryFold, termSet);
  var top = ranked.slice(0, maxResults);
  var lineStore = new Map();
  var snippetSpan = Math.min(contextLines, 1);
  if (detailed) snippetSpan = 1;
  var results = [];

  for (var resultIndex = 0; resultIndex < top.length; resultIndex++) {
    var entry = top[resultIndex];
    var group = entry.group;
    var lines = cachedLines(vaultPath, group.file, lineStore);
    var resultHeadings = [];
    for (var segmentIndex = 0; segmentIndex < group.segs.length; segmentIndex++) {
      var segment = group.segs[segmentIndex];
      if (segment.level >= 2 && segment.heading && !resultHeadings.includes(segment.heading)) {
        resultHeadings.push(segment.heading);
      }
      if (resultHeadings.length >= MAX_HEADINGS_PER_RESULT) break;
    }

    var result = {
      file: group.file,
      title: group.title,
      headings: resultHeadings,
      locator: group.segs[0].locator,
      snippet: buildSnippet(lines, group.segs[0], terms, index.idf, snippetSpan),
      score: Math.round(entry.score * 10) / 10,
    };

    if (detailed) {
      var titleFold = foldText(group.title || '');
      var titleTerms = new Set(queryTerms(group.title || ''));
      var baseTerms = new Set(queryTerms(basename(group.file)));
      var pathTerms = new Set(queryTerms(group.file));
      var exactTitleMatch = titleFold === queryFold;
      var allTermsInTitle = true;
      var titleTermMatch = false;
      var baseTermMatch = false;
      var pathTermMatch = false;
      for (var termIndex = 0; termIndex < terms.length; termIndex++) {
        if (!titleTerms.has(terms[termIndex])) allTermsInTitle = false;
        if (titleTerms.has(terms[termIndex])) titleTermMatch = true;
        if (baseTerms.has(terms[termIndex])) baseTermMatch = true;
        if (pathTerms.has(terms[termIndex])) pathTermMatch = true;
      }
      result.titleMatch = exactTitleMatch
        || allTermsInTitle
        || titleTermMatch
        || baseTermMatch
        || pathTermMatch;
      result.matches = buildMatches(lines, group.segs.slice(0, 3), terms, index.idf, contextLines);
      if (result.matches.length === 0) {
        var topSegment = group.segs[0];
        var syntheticText = '';
        var headingTermMatch = false;
        var headingTerms = new Set(queryTerms(topSegment.heading));
        for (var matchedTermIndex = 0; matchedTermIndex < topSegment.matchedTerms.length; matchedTermIndex++) {
          if (!headingTerms.has(foldText(topSegment.matchedTerms[matchedTermIndex]))) continue;
          headingTermMatch = true;
          break;
        }
        if (headingTermMatch) {
          syntheticText = topSegment.heading;
        } else if (result.titleMatch) {
          syntheticText = group.title;
          if (!exactTitleMatch && !allTermsInTitle && !titleTermMatch) syntheticText = group.file;
        }
        if (!syntheticText) syntheticText = result.snippet;
        if (!syntheticText) syntheticText = group.file;
        result.matches.push({
          line: topSegment.startLine,
          text: syntheticText,
          heading: topSegment.heading,
        });
      }
    }
    results.push(result);
  }

  return applyTokenBudget(results, options.maxTokens);
}

export function getManifest(vaultPath) {
  return getCachedManifest(vaultPath);
}

export function parseRipgrepJson(vaultPath, output, maxResults) {
  var fileGroups = new Map();
  var distinctFiles = 0;
  var lines = output.split(/\r?\n/);

  for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (!lines[lineIndex].trim()) continue;

    try {
      var event = JSON.parse(lines[lineIndex]);
    } catch {
      continue;
    }
    if (event.type !== 'match' && event.type !== 'context') continue;

    var data = event.data;
    if (!data || !data.path || typeof data.path.text !== 'string') continue;
    var relativePath = normalizeSlashes(relative(vaultPath, data.path.text).replace(/\.md$/, ''));
    if (!fileGroups.has(relativePath)) {
      if (distinctFiles >= maxResults) continue;
      distinctFiles++;
      fileGroups.set(relativePath, { file: relativePath, title: '', matches: [] });
    }

    var text = '';
    if (data.lines && typeof data.lines.text === 'string') {
      text = data.lines.text.replace(/\r?\n$/, '');
    }
    if (typeof data.line_number !== 'number') continue;

    var group = fileGroups.get(relativePath);
    group.matches.push({ line: data.line_number, text });
  }

  return Array.from(fileGroups.values());
}

function isInsideVault(vaultPath, targetPath) {
  var resolvedVault = resolve(vaultPath);
  var resolvedTarget = resolve(targetPath);
  return resolvedTarget.startsWith(resolvedVault + sep) || resolvedTarget === resolvedVault;
}

function clampInt(value, min, max, fallback) {
  var number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function collectMdFiles(directory, vaultRoot, results) {
  var entries = readdirSync(directory, { withFileTypes: true });
  for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    var entry = entries[entryIndex];
    var fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectMdFiles(fullPath, vaultRoot, results);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    results.push({
      name: basename(entry.name, '.md'),
      path: normalizeSlashes(relative(vaultRoot, fullPath).replace(/\.md$/, '')),
    });
  }
}

function normalizeSlashes(filePath) {
  var parts = filePath.split(sep);
  var normalized = '';
  for (var partIndex = 0; partIndex < parts.length; partIndex++) {
    if (partIndex > 0) normalized += '/';
    normalized += parts[partIndex];
  }
  return normalized;
}

function healDocPath(vaultPath, docPath) {
  var index = getCachedTitleIndex(vaultPath);
  if (!index.length) return null;

  var wantedBase = foldText(basename(docPath).toLowerCase());
  var wantedFull = foldText(normalizeSlashes(docPath.toLowerCase()));
  var exact = [];
  for (var entryIndex = 0; entryIndex < index.length; entryIndex++) {
    var entry = index[entryIndex];
    if (foldText(entry.name.toLowerCase()) === wantedBase || foldText(entry.title.toLowerCase()) === wantedBase) {
      exact.push(entry);
    }
  }
  if (exact.length === 1) return { path: exact[0].path };
  if (exact.length > 1) {
    var candidates = [];
    for (var entryIndex = 0; entryIndex < exact.length && entryIndex < 8; entryIndex++) {
      candidates.push(exact[entryIndex].path);
    }
    return {
      error: `Document not found: ${docPath}. Did you mean one of these?`,
      candidates,
    };
  }

  var near = [];
  for (var entryIndex = 0; entryIndex < index.length; entryIndex++) {
    var entry = index[entryIndex];
    if (
      foldText(entry.name.toLowerCase()).includes(wantedBase)
      || foldText(entry.title.toLowerCase()).includes(wantedBase)
      || foldText(entry.path.toLowerCase()).includes(wantedFull)
    ) {
      near.push(entry);
    }
  }
  if (near.length === 0) return null;

  var candidates = [];
  for (var entryIndex = 0; entryIndex < near.length && entryIndex < 8; entryIndex++) {
    candidates.push(near[entryIndex].path);
  }
  return {
    error: `Document not found: ${docPath}. Did you mean one of these?`,
    candidates,
  };
}

function parseFrontmatter(raw) {
  var match = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  var frontmatter = {};
  var lines = match[1].split('\n');
  for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    var entry = lines[lineIndex].match(/^(\w+)\s*:\s*"?(.+?)"?\s*$/);
    if (entry) frontmatter[entry[1]] = entry[2].replace(/\r$/, '');
  }
  return { frontmatter, body: match[2] };
}

function extractHeadingSection(body, heading, sections) {
  var wanted = foldText(heading.trim());
  var lines = body.split('\n');
  var startIndex = -1;
  var startLevel = 0;
  var matchedSectionIndex = -1;

  for (var sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    if (foldText(sections[sectionIndex].heading.trim()) !== wanted) continue;
    startIndex = sections[sectionIndex].startLine - 1;
    startLevel = sections[sectionIndex].level;
    matchedSectionIndex = sectionIndex;
    break;
  }
  if (startIndex === -1) return '';

  var endIndex = lines.length;
  for (var sectionIndex = matchedSectionIndex + 1; sectionIndex < sections.length; sectionIndex++) {
    if (sections[sectionIndex].level > startLevel) continue;
    endIndex = sections[sectionIndex].startLine - 1;
    break;
  }

  var section = '';
  for (var lineIndex = startIndex; lineIndex < endIndex; lineIndex++) {
    if (section) section += '\n';
    section += lines[lineIndex];
  }
  return section.trimEnd();
}

function cutAtLineBoundary(text, maxLength) {
  if (text.length <= maxLength) return text;
  var slice = text.slice(0, maxLength);
  var lastNewline = slice.lastIndexOf('\n');
  if (lastNewline > maxLength * 0.5) return slice.slice(0, lastNewline);
  return slice;
}

function renderToc(headings, note, budget = Infinity) {
  if (!headings.length) return '';

  var output = `\n\n---\n${note}\nWeiter mit heading="<name>", zum Beispiel heading="${headings[0].text}".\n\nAbschnitte (${headings.length}):\n`;
  if (output.length > budget) {
    output = `\n\nWeiter mit heading="${headings[0].text}".\n\nAbschnitte (${headings.length}):\n`;
  }
  if (output.length > budget) output = `\n\nAbschnitte (${headings.length}):\n`;

  var shown = 0;
  for (var headingIndex = 0; headingIndex < headings.length; headingIndex++) {
    if (shown >= MAX_TOC_ENTRIES) break;
    var separator = '';
    if (shown > 0) separator = ' | ';
    if (output.length + separator.length + headings[headingIndex].text.length > budget) break;
    output += separator + headings[headingIndex].text;
    shown++;
  }

  var rest = headings.length - shown;
  var restText = ` | ... +${rest} weitere, hol sie mit einem größeren max_length`;
  if (rest > 0 && output.length + restText.length <= budget) output += restText;
  return output;
}

function staleFactor(filePath) {
  for (var patternIndex = 0; patternIndex < STALE_SOURCE_PATTERNS.length; patternIndex++) {
    if (STALE_SOURCE_PATTERNS[patternIndex].test(filePath)) return STALE_SOURCE_FACTOR;
  }
  return 1;
}

function isNoiseLine(text) {
  var line = String(text).trim();
  if (!line) return true;
  if (/^`{3,}/.test(line)) return true;
  if (/^#{1,6}(\s|$)/.test(line)) return true;
  if (/^[|\-+:=_*~\s]+$/.test(line)) return true;
  if (/^[<>{}[\]()]+$/.test(line)) return true;
  return false;
}

function cachedLines(vaultPath, relativePath, store) {
  if (store.has(relativePath)) return store.get(relativePath);

  var filePath = join(vaultPath, relativePath + '.md');
  try {
    var lines = readFileSync(filePath, 'utf-8').split('\n');
  } catch (error) {
    throw new Error(`Failed to read Markdown file "${filePath}": ${error.message}`);
  }
  store.set(relativePath, lines);
  return lines;
}

function lineWeight(line, terms, idf) {
  var folded = foldText(line);
  var weight = 0;
  for (var termIndex = 0; termIndex < terms.length; termIndex++) {
    if (folded.includes(terms[termIndex])) weight += idf(terms[termIndex]);
  }
  return weight;
}

function buildSnippet(lines, segment, terms, idf, span) {
  var start = Math.max(0, segment.startLine - 1);
  var end = Math.min(lines.length, segment.endLine);
  var bestIndex = -1;
  var bestWeight = 0;

  for (var lineIndex = start; lineIndex < end; lineIndex++) {
    var text = lines[lineIndex].replace(/\r$/, '');
    if (isNoiseLine(text)) continue;
    var weight = lineWeight(text, terms, idf);
    if (weight <= bestWeight) continue;
    bestWeight = weight;
    bestIndex = lineIndex;
  }

  if (bestIndex === -1) {
    var longest = 0;
    for (var lineIndex = start; lineIndex < end; lineIndex++) {
      var text = lines[lineIndex].replace(/\r$/, '').trim();
      if (isNoiseLine(text) || text.length <= longest) continue;
      longest = text.length;
      bestIndex = lineIndex;
    }
  }
  if (bestIndex === -1) return '';

  var snippet = '';
  var snippetStart = Math.max(start, bestIndex - span);
  var snippetEnd = Math.min(end, bestIndex + span + 1);
  for (var lineIndex = snippetStart; lineIndex < snippetEnd; lineIndex++) {
    var text = lines[lineIndex].replace(/\r$/, '').trim();
    if (lineIndex !== bestIndex && isNoiseLine(text)) continue;
    if (text.length > MAX_SNIPPET_LINE_CHARS) text = text.slice(0, MAX_SNIPPET_LINE_CHARS) + '…';
    if (snippet) snippet += '\n';
    snippet += text;
  }

  if (snippet.length > MAX_SNIPPET_CHARS) snippet = snippet.slice(0, MAX_SNIPPET_CHARS) + '…';
  return snippet;
}

function buildMatches(lines, segments, terms, idf, contextLines) {
  var seen = new Set();
  var matches = [];
  for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    var segment = segments[segmentIndex];
    var from = Math.max(0, segment.startLine - 1);
    var to = Math.min(lines.length, segment.endLine);
    for (var lineIndex = from; lineIndex < to && matches.length < MAX_MATCHES_PER_FILE; lineIndex++) {
      var text = lines[lineIndex].replace(/\r$/, '');
      if (isNoiseLine(text) || lineWeight(text, terms, idf) <= 0) continue;

      var start = Math.max(from, lineIndex - contextLines);
      var end = Math.min(to - 1, lineIndex + contextLines);
      for (var contextIndex = start; contextIndex <= end && matches.length < MAX_MATCHES_PER_FILE; contextIndex++) {
        if (seen.has(contextIndex)) continue;
        var context = lines[contextIndex].replace(/\r$/, '');
        if (context.trim() === '') continue;
        seen.add(contextIndex);
        matches.push({ line: contextIndex + 1, text: context, heading: segment.heading });
      }
    }
    if (matches.length >= MAX_MATCHES_PER_FILE) break;
  }
  matches.sort(function (first, second) {
    return first.line - second.line;
  });
  return matches;
}

function headingIsQuerySubset(heading, termSet) {
  var parts = tokenize(heading);
  if (!parts.length) return false;
  for (var partIndex = 0; partIndex < parts.length; partIndex++) {
    if (!termSet.has(foldText(parts[partIndex]))) return false;
  }
  return true;
}

function aggregateByFile(hits, index, terms, queryFold, termSet) {
  var knownTerms = [];
  for (var termIndex = 0; termIndex < terms.length; termIndex++) {
    if (index.hasTerm(terms[termIndex])) knownTerms.push(terms[termIndex]);
  }
  var scoringTerms = terms;
  if (knownTerms.length) scoringTerms = knownTerms;

  var idfTotal = 0;
  for (var termIndex = 0; termIndex < scoringTerms.length; termIndex++) {
    idfTotal += index.idf(scoringTerms[termIndex]);
  }
  if (!idfTotal) idfTotal = 1;

  var files = new Map();
  for (var hitIndex = 0; hitIndex < hits.length; hitIndex++) {
    var hit = hits[hitIndex];
    var segment = index.segments.get(hit.id);
    if (!segment) continue;

    var group = files.get(segment.file);
    if (!group) {
      group = { file: segment.file, title: segment.title, terms: new Set(), segs: [] };
      files.set(segment.file, group);
    }
    for (var termIndex = 0; termIndex < hit.terms.length; termIndex++) {
      group.terms.add(hit.terms[termIndex]);
    }

    var matchedIdf = 0;
    for (var termIndex = 0; termIndex < hit.terms.length; termIndex++) {
      matchedIdf += index.idf(hit.terms[termIndex]);
    }
    var segmentCoverage = matchedIdf / idfTotal;
    var score = hit.score * segmentCoverage;
    if (segment.level >= 2 && segment.heading && headingIsQuerySubset(segment.heading, termSet)) {
      var headingTokens = tokenize(segment.heading);
      var headingIdf = 0;
      for (var termIndex = 0; termIndex < headingTokens.length; termIndex++) {
        headingIdf += index.idf(foldText(headingTokens[termIndex]));
      }
      score *= 1 + 3 * Math.min(1, headingIdf / idfTotal);
    }
    group.segs.push({ ...segment, score, matchedTerms: hit.terms });
  }

  var results = [];
  var groups = Array.from(files.values());
  for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    var group = groups[groupIndex];
    group.segs.sort(function (first, second) {
      return second.score - first.score;
    });

    var groupTerms = Array.from(group.terms);
    var coveredIdf = 0;
    for (var termIndex = 0; termIndex < groupTerms.length; termIndex++) {
      coveredIdf += index.idf(groupTerms[termIndex]);
    }
    var coverage = coveredIdf / idfTotal;
    var score = group.segs[0].score * coverage * coverage;
    if (group.title && foldText(group.title) === queryFold) score *= 2;
    score *= staleFactor(group.file);
    results.push({ group, score, coverage });
  }

  results.sort(function (first, second) {
    return second.score - first.score;
  });
  return results;
}

function applyTokenBudget(results, maxTokens) {
  var budget = Number(maxTokens);
  if (!Number.isFinite(budget) || budget <= 0) return results;

  var maxChars = Math.trunc(budget) * 4;
  var output = results;
  while (output.length > 1 && JSON.stringify(output).length > maxChars) {
    output = output.slice(0, output.length - 1);
  }
  if (JSON.stringify(output).length > maxChars) return [];
  return output;
}
