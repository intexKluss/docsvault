import { searchDocs, getSections } from './vault.js';

export function handleSearch(vaultPath, params) {
  const { query, section, max_results = 10, context_lines = 3 } = params;

  // unbekannte Section von "keine Treffer" unterscheiden (Punkt 13): die
  // mcp/api-Schicht kann das `error`-Signal in einen echten Fehler verwandeln.
  if (section && !getSections(vaultPath).includes(section)) {
    return { error: `Section "${section}" not found. Use the overview tool to see valid sections.` };
  }

  return searchDocs(vaultPath, query, { section, maxResults: max_results, contextLines: context_lines });
}
