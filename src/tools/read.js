import { readDoc, DEFAULT_READ_LENGTH, MAX_READ_LENGTH } from './vault.js';

export function handleRead(vaultPath, params) {
  const { path, heading, max_tokens } = params;
  // Context bewusst begrenzen: zu grosse reads überladen schwache Modelle und
  // fressen unnötig Tokens. Wer mehr will, setzt max_length explizit, bis zur
  // harten Obergrenze.
  const maxLength = Math.min(params.max_length || DEFAULT_READ_LENGTH, MAX_READ_LENGTH);
  const doc = readDoc(vaultPath, path, maxLength, { heading, maxTokens: max_tokens });
  if (!doc) return { error: `Document not found: ${path}` };
  // Self-Healing lieferte mehrdeutige Kandidaten: "did you mean"
  if (doc.error) {
    return doc.candidates && doc.candidates.length
      ? { error: `${doc.error}\n${doc.candidates.join('\n')}` }
      : { error: doc.error };
  }
  return doc;
}
