import { listFiles, getSections } from './vault.js';

export var DEFAULT_LIST_LIMIT = 50;
var MAX_LIST_LIMIT = 500;

export function handleList(vaultPath, params) {
  const { section, subfolder } = params;

  if (section && !getSections(vaultPath).includes(section)) {
    return { error: `Section "${section}" not found. Use the overview tool to see valid sections.` };
  }

  return listFiles(vaultPath, section, subfolder);
}

export function handleListPaged(vaultPath, params) {
  var files = handleList(vaultPath, params);
  if (!Array.isArray(files)) return files;

  var limit = Number(params.max_results);
  if (!Number.isFinite(limit)) limit = DEFAULT_LIST_LIMIT;
  limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(limit)));

  var shown = files.slice(0, limit);
  var rest = files.length - shown.length;
  var note = '';
  if (rest > 0) {
    if (params.subfolder) {
      note = `+${rest} weitere Seiten in diesem Subfolder, nutze max_results.`;
    } else {
      note = `+${rest} weitere Seiten, nutze subfolder=... (siehe overview("${params.section}")) oder max_results.`;
    }
  }

  return { files: shown, total: files.length, truncated: rest > 0, note };
}
