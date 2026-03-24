import { listFiles } from './vault.js';

export function handleList(vaultPath, params) {
  const { section, subfolder } = params;
  return listFiles(vaultPath, section, subfolder);
}
