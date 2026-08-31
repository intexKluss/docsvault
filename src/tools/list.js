import { listFiles, getSections } from './vault.js';

// Default-Obergrenze für die Anzahl gelisteter Seiten. Ohne Cap liefert eine
// grosse Section zehntausende Zeichen.
export const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

export function handleList(vaultPath, params) {
  const { section, subfolder } = params;

  // unbekannte Section von "leere Section" unterscheiden
  if (section && !getSections(vaultPath).includes(section)) {
    return { error: `Section "${section}" not found. Use the overview tool to see valid sections.` };
  }

  return listFiles(vaultPath, section, subfolder);
}

// Gedeckelte Variante für die MCP-Schicht: liefert zusätzlich die Gesamtzahl
// und einen Hinweis wie man den Rest bekommt.
// Rückgabe: { error } | { files, total, truncated, note }
export function handleListPaged(vaultPath, params) {
  const files = handleList(vaultPath, params);
  if (!Array.isArray(files)) return files;

  const limit = clampLimit(params.max_results);
  const shown = files.slice(0, limit);
  const rest = files.length - shown.length;

  let note = '';
  if (rest > 0) {
    note = params.subfolder
      ? `+${rest} weitere Seiten in diesem Subfolder, nutze max_results.`
      : `+${rest} weitere Seiten, nutze subfolder=... (siehe overview("${params.section}")) oder max_results.`;
  }

  return { files: shown, total: files.length, truncated: rest > 0, note };
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(n)));
}
