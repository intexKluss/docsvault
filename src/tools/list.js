import { listFiles, getSections } from './vault.js';

export function handleList(vaultPath, params) {
  const { section, subfolder } = params;

  // unbekannte Section von "leere Section" unterscheiden (Punkt 13)
  if (section && !getSections(vaultPath).includes(section)) {
    return { error: `Section "${section}" not found. Use the overview tool to see valid sections.` };
  }

  return listFiles(vaultPath, section, subfolder);
}
