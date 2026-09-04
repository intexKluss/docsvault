import MiniSearch from 'minisearch';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, basename, sep } from 'path';
import { isSkippedDir } from '../vault-registry.js';

export var FIELD_BOOSTS = { title: 2, heading: 3, path: 1, body: 1 };
var TOKEN_SPLIT = /[^\p{L}\p{N}_$]+/u;

export function foldText(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

export function tokenize(text) {
  var parts = String(text).split(TOKEN_SPLIT);
  var tokens = [];
  for (var partIndex = 0; partIndex < parts.length; partIndex++) {
    if (parts[partIndex].length >= 2) tokens.push(parts[partIndex]);
  }
  return tokens;
}

export function queryTerms(query) {
  var seen = new Set();
  var tokens = tokenize(query);
  for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    seen.add(foldText(tokens[tokenIndex]));
  }
  return Array.from(seen);
}

export function buildSearchIndex(vaultPath) {
  var started = Date.now();
  var files = [];
  collectMdFilePaths(vaultPath, files);

  var documents = [];
  var segments = new Map();
  var documentFrequency = new Map();
  var fileCount = 0;
  var nextId = 0;

  for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
    var fullPath = files[fileIndex];
    try {
      var raw = readFileSync(fullPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read Markdown file "${fullPath}": ${error.message}`);
    }
    fileCount++;

    var pathParts = relative(vaultPath, fullPath).replace(/\.md$/, '').split(sep);
    var relativePath = '';
    for (var pathPartIndex = 0; pathPartIndex < pathParts.length; pathPartIndex++) {
      if (pathPartIndex > 0) relativePath += '/';
      relativePath += pathParts[pathPartIndex];
    }
    var title = readTitle(raw, basename(fullPath, '.md'));
    var pathWords = relativePath.replace(/\//g, ' ');
    var sections = splitIntoSections(raw);

    for (var sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      var section = sections[sectionIndex];
      var indexedHeading = section.heading;
      var indexedBody = section.body;
      if (section.level === 1) {
        indexedHeading = '';
        indexedBody = section.heading;
        if (section.body) indexedBody += '\n' + section.body;
      }
      var id = nextId++;
      var document = {
        id,
        title,
        heading: indexedHeading,
        path: pathWords,
        body: indexedBody,
      };
      documents.push(document);
      segments.set(id, {
        file: relativePath,
        title,
        heading: indexedHeading,
        locator: `L${section.startLine}`,
        startLine: section.startLine,
        endLine: section.endLine,
      });

      var seen = new Set();
      var fields = ['title', 'heading', 'path', 'body'];
      for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
        var tokens = tokenize(document[fields[fieldIndex]]);
        for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
          seen.add(foldText(tokens[tokenIndex]));
        }
      }

      var uniqueTokens = Array.from(seen);
      for (var tokenIndex = 0; tokenIndex < uniqueTokens.length; tokenIndex++) {
        var token = uniqueTokens[tokenIndex];
        documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
      }
    }
  }

  var miniSearch = new MiniSearch({
    fields: ['title', 'heading', 'path', 'body'],
    storeFields: [],
    tokenize,
    processTerm,
    searchOptions: { boost: FIELD_BOOSTS, combineWith: 'OR' },
  });
  miniSearch.addAll(documents);

  // MiniSearch hält den benötigten Text selbst. Die zweite Kopie kann weg.
  documents.length = 0;

  var segmentCount = segments.size || 1;
  var idf = function (term) {
    var frequency = documentFrequency.get(term) || 0;
    return Math.log(1 + (segmentCount - frequency + 0.5) / (frequency + 0.5));
  };
  var hasTerm = function (term) {
    return documentFrequency.has(term);
  };

  return {
    mini: miniSearch,
    segments,
    fileCount,
    segmentCount: segments.size,
    idf,
    hasTerm,
    buildMs: Date.now() - started,
  };
}

function collectMdFilePaths(directory, results) {
  try {
    var entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Failed to read directory "${directory}": ${error.message}`);
  }

  for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    var entry = entries[entryIndex];
    var fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isSkippedDir(entry.name)) collectMdFilePaths(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) results.push(fullPath);
  }
}

export function splitIntoSections(raw) {
  var lines = raw.split('\n');
  var start = 0;
  if (lines.length && lines[0].replace(/\r$/, '').replace(/^﻿/, '') === '---') {
    for (var lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      if (lines[lineIndex].replace(/\r$/, '') !== '---') continue;
      start = lineIndex + 1;
      break;
    }
  }

  var sections = [];
  var heading = '';
  var level = 0;
  var sectionStart = start;
  var body = '';
  var bodyLineCount = 0;
  var fenceCharacter = '';
  var fenceLength = 0;

  for (var lineIndex = start; lineIndex < lines.length; lineIndex++) {
    var line = lines[lineIndex].replace(/\r$/, '');
    var fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    var headingMatch;
    if (fenceCharacter) {
      if (
        fenceMatch
        && fenceMatch[1][0] === fenceCharacter
        && fenceMatch[1].length >= fenceLength
        && fenceMatch[2].trim() === ''
      ) {
        fenceCharacter = '';
        fenceLength = 0;
      }
    } else if (fenceMatch) {
      fenceCharacter = fenceMatch[1][0];
      fenceLength = fenceMatch[1].length;
    } else {
      headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    }
    if (!headingMatch) {
      if (bodyLineCount > 0) body += '\n';
      body += line;
      bodyLineCount++;
      continue;
    }

    body = body.trim();
    if (body || heading) {
      sections.push({ heading, level, body, startLine: sectionStart + 1, endLine: lineIndex });
    }
    heading = headingMatch[2];
    level = headingMatch[1].length;
    sectionStart = lineIndex;
    body = '';
    bodyLineCount = 0;
  }

  body = body.trim();
  if (body || heading) {
    sections.push({ heading, level, body, startLine: sectionStart + 1, endLine: lines.length });
  }
  return sections;
}

function readTitle(raw, fallback) {
  if (raw.replace(/^﻿/, '').slice(0, 3) !== '---') return fallback;

  var frontmatter = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return fallback;

  var lines = frontmatter[1].split('\n');
  for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    var title = lines[lineIndex].match(/^title\s*:\s*"?(.+?)"?\s*$/);
    if (title) return title[1].replace(/\r$/, '');
  }
  return fallback;
}

function processTerm(term) {
  var folded = foldText(term);
  if (folded.length < 2) return null;
  return folded;
}
