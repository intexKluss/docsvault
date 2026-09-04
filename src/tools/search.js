import { searchDocs, getSections } from './vault.js';
import { existsSync, statSync } from 'fs';
import { join, normalize } from 'path';

var DEFAULT_MAX_RESULTS = 5;

export function handleSearch(vaultPath, params) {
  var query = params.query;
  var section = params.section;
  var maxResults = params.max_results;
  if (maxResults === undefined) maxResults = DEFAULT_MAX_RESULTS;
  var contextLines = params.context_lines;
  if (contextLines === undefined) contextLines = 3;
  var responseFormat = params.response_format || 'concise';

  try {
    if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
      throw new Error('Vault path is not a directory');
    }
    if (section) {
      var normalizedSection = normalize(section).replace(/\\/g, '/');
      var rawParts = normalizedSection.split('/');
      var parts = [];
      for (var partIndex = 0; partIndex < rawParts.length; partIndex++) {
        if (rawParts[partIndex]) parts.push(rawParts[partIndex]);
      }
      var sectionPath = join(vaultPath, ...parts);
      if (normalizedSection !== section || !parts.length || !getSections(vaultPath).includes(parts[0]) || !existsSync(sectionPath)) {
        return { error: `Section "${section}" not found. Use the overview tool to see valid sections.` };
      }
    }
    return searchDocs(vaultPath, query, {
      section,
      maxResults,
      contextLines,
      detailed: responseFormat === 'detailed',
      maxTokens: params.max_tokens,
    });
  } catch (err) {
    return { error: `Search index unavailable: ${err.message}` };
  }
}
