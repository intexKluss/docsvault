import { searchDocs, getSections } from './vault.js';

export const DEFAULT_MAX_RESULTS = 5;

export function handleSearch(vaultPath, params) {
  const {
    query,
    section,
    max_results = DEFAULT_MAX_RESULTS,
    context_lines = 3,
    response_format = 'concise',
    max_tokens,
  } = params;

  // unbekannte Section von "keine Treffer" unterscheiden: die mcp/api-Schicht
  // kann das `error`-Signal in einen echten Fehler verwandeln.
  if (section && !getSections(vaultPath).includes(section)) {
    return { error: `Section "${section}" not found. Use the overview tool to see valid sections.` };
  }

  return searchDocs(vaultPath, query, {
    section,
    maxResults: max_results,
    contextLines: context_lines,
    detailed: response_format === 'detailed',
    maxTokens: max_tokens,
  });
}
