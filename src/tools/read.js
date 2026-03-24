import { readDoc } from './vault.js';

export function handleRead(vaultPath, params) {
  const { path, max_length = 50000 } = params;
  const doc = readDoc(vaultPath, path, max_length);
  if (!doc) return { error: `Document not found: ${path}` };
  return doc;
}
