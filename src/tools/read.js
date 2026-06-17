import { readDoc } from './vault.js';

export function handleRead(vaultPath, params) {
  const { path, heading } = params;
  // context bewusst begrenzen: zu grosse reads überladen schwache modelle (mini
  // verliert dann details wie das return-gerüst) und fressen unnötig tokens. das
  // grundgerüst liefert eh der prompt, hier reicht der inhaltliche teil.
  const max_length = Math.min(params.max_length || 20000, 25000);
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
