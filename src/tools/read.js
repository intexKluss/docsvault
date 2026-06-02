import { readDoc } from './vault.js';

export function handleRead(vaultPath, params) {
  const { path, max_length = 50000, heading } = params;
  const doc = readDoc(vaultPath, path, max_length, { heading });
  if (!doc) return { error: `Document not found: ${path}` };
  // Self-Healing lieferte mehrdeutige Kandidaten (Punkt 17): "did you mean"
  if (doc.error) {
    return doc.candidates && doc.candidates.length
      ? { error: `${doc.error}\n${doc.candidates.join('\n')}` }
      : { error: doc.error };
  }
  return doc;
}
