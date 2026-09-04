import { readDoc, DEFAULT_READ_LENGTH, MAX_READ_LENGTH } from './vault.js';

export var MAX_MCP_READ_LENGTH = 25000;

export function handleRead(vaultPath, params, maxReadLength = MAX_READ_LENGTH) {
  var path = params.path;
  var maxLength = Math.min(params.max_length || DEFAULT_READ_LENGTH, maxReadLength);
  var doc = readDoc(vaultPath, path, maxLength, {
    heading: params.heading,
    locator: params.locator,
    maxTokens: params.max_tokens,
  });
  if (!doc) return { error: `Document not found: ${path}` };
  if (doc.error) {
    if (!doc.candidates || !doc.candidates.length) return { error: doc.error };

    var error = doc.error;
    for (var candidateIndex = 0; candidateIndex < doc.candidates.length; candidateIndex++) {
      error += `\n${doc.candidates[candidateIndex]}`;
    }
    return { error };
  }
  return doc;
}
