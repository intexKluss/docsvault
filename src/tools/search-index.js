import MiniSearch from 'minisearch';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, basename, sep } from 'path';
import { isSkippedDir } from '../vault-registry.js';

// BM25-Index auf Abschnittsebene.
//
// Statt Live-ripgrep + Handscoring wird pro Vault einmal ein In-Memory-Index
// gebaut. Ein Index-Eintrag ist NICHT eine Datei, sondern ein Abschnitt
// (## / ### bis zur naechsten Ueberschrift gleichen oder hoeheren Levels).
// Damit liefert jeder Treffer direkt das passende `heading` mit, und ein
// Folge-read kann gezielt nur diesen Abschnitt holen.
//
// Warum MiniSearch und nicht Orama: beide sind reines JS ohne native Deps und
// beide koennen BM25. MiniSearch passt hier besser, weil
//  - `addAll` synchron ist (searchDocs/handleSearch sind synchron und werden so
//    auch aus den Express-Routen und dem MCP-Handler aufgerufen),
//  - `tokenize`/`processTerm` als simple Funktions-Hooks das bestehende
//    Umlaut-Folding unveraendert uebernehmen koennen (Orama braucht dafuer
//    einen eigenen Tokenizer-/Plugin-Aufbau),
//  - es keine Schema-/Instanz-Verwaltung mitbringt die wir nicht brauchen.

// Feld-Boosts. heading > title > path > body: die Ueberschrift ist bei
// API-/Property-Seiten der eigentliche Bezeichner.
export const FIELD_BOOSTS = { title: 2, heading: 3, path: 1, body: 1 };

// Umlaut-/ss-Folding: normalisiert deutschen Text so dass ae/ä, oe/ö, ue/ü,
// ss/ß als gleich gelten. Wird symmetrisch auf Query-Tokens UND Indexinhalt
// angewandt, damit "uebersicht" auch "Übersicht" findet.
export function foldText(str) {
  return String(str)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

// Tokenizer: split auf allem was kein Buchstabe/Ziffer/_/$ ist. Damit zerfaellt
// "context.getDocument()" in "context" und "getDocument", Identifier bleiben
// aber ganz. Min. Laenge 2.
const TOKEN_SPLIT = /[^\p{L}\p{N}_$]+/u;

export function tokenize(text) {
  const out = [];
  for (const part of String(text).split(TOKEN_SPLIT)) {
    if (part.length >= 2) out.push(part);
  }
  return out;
}

// gefaltete, deduplizierte Query-Tokens
export function queryTerms(query) {
  const seen = new Set();
  for (const t of tokenize(query)) seen.add(foldText(t));
  return [...seen];
}

function processTerm(term) {
  const folded = foldText(term);
  return folded.length >= 2 ? folded : null;
}

function collectMdFilePaths(dir, results) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!isSkippedDir(entry.name)) collectMdFilePaths(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
}

// Zerlegt eine Markdown-Datei in Abschnitte. Der Text vor der ersten
// ##-Ueberschrift wird zum Intro-Abschnitt (heading '').
// Rueckgabe: [{ heading, level, body, startLine, endLine }] (1-basierte Zeilen)
export function splitIntoSections(raw) {
  const lines = raw.split('\n');
  let start = 0;

  // Frontmatter ueberspringen (nur wenn die allererste Zeile genau '---' ist)
  if (lines.length && lines[0].replace(/\r$/, '').replace(/^﻿/, '') === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].replace(/\r$/, '') === '---') {
        start = i + 1;
        break;
      }
    }
  }

  const sections = [];
  let heading = '';
  let level = 0;
  let sectionStart = start;
  let buf = [];

  function flush(endLine) {
    const body = buf.join('\n').trim();
    if (!body && !heading) return;
    sections.push({ heading, level, body, startLine: sectionStart + 1, endLine });
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const m = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (!m) {
      buf.push(line);
      continue;
    }
    flush(i);
    heading = m[2];
    level = m[1].length;
    sectionStart = i;
    buf = [];
  }
  flush(lines.length);

  return sections;
}

function readTitle(raw, fallback) {
  if (raw.replace(/^﻿/, '').slice(0, 3) !== '---') return fallback;
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return fallback;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^title\s*:\s*"?(.+?)"?\s*$/);
    if (kv) return kv[1].replace(/\r$/, '');
  }
  return fallback;
}

// Baut den kompletten Abschnitts-Index eines Vaults.
// Rueckgabe: { mini, segments, fileCount, idf(term), buildMs }
export function buildSearchIndex(vaultPath) {
  const started = Date.now();
  const files = [];
  collectMdFilePaths(vaultPath, files);

  const docs = [];
  const segments = new Map(); // id -> { file, title, heading, startLine, endLine }
  const df = new Map();       // gefalteter Term -> Anzahl Abschnitte
  let nextId = 0;

  for (const full of files) {
    let raw;
    try {
      raw = readFileSync(full, 'utf-8');
    } catch {
      continue;
    }
    const relPath = relative(vaultPath, full).replace(/\.md$/, '').split(sep).join('/');
    const title = readTitle(raw, basename(full, '.md'));
    const pathWords = relPath.split('/').join(' ');

    for (const sec of splitIntoSections(raw)) {
      const id = nextId++;
      const doc = {
        id,
        title,
        heading: sec.heading,
        path: pathWords,
        body: sec.body,
      };
      docs.push(doc);
      segments.set(id, {
        file: relPath,
        title,
        heading: sec.heading,
        startLine: sec.startLine,
        endLine: sec.endLine,
      });

      // eigene Dokumentfrequenz-Tabelle: MiniSearch legt sie nicht offen, wir
      // brauchen die IDF fuer das Re-Ranking auf Dateiebene.
      const seen = new Set();
      for (const field of ['title', 'heading', 'path', 'body']) {
        for (const t of tokenize(doc[field])) seen.add(foldText(t));
      }
      for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
    }
  }

  const mini = new MiniSearch({
    fields: ['title', 'heading', 'path', 'body'],
    storeFields: [],
    tokenize,
    processTerm,
    searchOptions: { boost: FIELD_BOOSTS, combineWith: 'OR' },
  });
  mini.addAll(docs);

  // Bodies nach dem Indexieren freigeben, sonst haelt der Cache den kompletten
  // Vault-Text ein zweites Mal im Speicher.
  docs.length = 0;

  const n = segments.size || 1;
  const idf = (term) => {
    const d = df.get(term) || 0;
    return Math.log(1 + (n - d + 0.5) / (d + 0.5));
  };

  return {
    mini,
    segments,
    fileCount: files.length,
    segmentCount: segments.size,
    idf,
    buildMs: Date.now() - started,
  };
}
