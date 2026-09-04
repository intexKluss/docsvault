import { searchDocs, getSections } from './vault.js';
import { existsSync, statSync } from 'fs';
import { join, normalize } from 'path';

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
  if (section) {
    const normalizedSection = normalize(section).split(/[\\/]+/).join('/');
    const parts = normalizedSection.split('/').filter(Boolean);
    const sectionPath = join(vaultPath, ...parts);
    if (normalizedSection !== section || !parts.length || !getSections(vaultPath).includes(parts[0]) || !existsSync(sectionPath)) {
      return { error: `Section "${section}" not found. Use the overview tool to see valid sections.` };
    }
  }

  try {
    if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
      throw new Error('Vault path is not a directory');
    }
    return searchDocs(vaultPath, query, {
      section,
      maxResults: max_results,
      contextLines: context_lines,
      detailed: response_format === 'detailed',
      maxTokens: max_tokens,
    });
  } catch (err) {
    return { error: `Search index unavailable: ${err.message}` };
  }
}
