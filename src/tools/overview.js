import { getSections, listFiles, getManifest } from './vault.js';

export function handleOverview(vaultPath, params) {
  const { section } = params;

  if (section) {
    const files = listFiles(vaultPath, section);
    if (files.length === 0) return `Section "${section}" not found or empty.`;
    const groups = {};
    for (const f of files) {
      const parts = f.path.split('/');
      const group = parts.length > 2 ? parts[1] : '_root';
      if (!groups[group]) groups[group] = [];
      groups[group].push(f.name);
    }
    let out = `## ${section} (${files.length} pages)\n\n`;
    for (const [group, names] of Object.entries(groups).sort()) {
      if (group !== '_root') out += `### ${group}\n`;
      for (const n of names.sort()) out += `- ${n}\n`;
      out += '\n';
    }
    return out;
  }

  const manifest = getManifest(vaultPath);
  const sections = getSections(vaultPath);
  let out = `# otris DOCUMENTS Documentation`;
  if (manifest?.crawledAt) out += ` (crawled: ${manifest.crawledAt.split('T')[0]})`;
  out += '\n\n';
  for (const sec of sections.sort()) {
    const files = listFiles(vaultPath, sec);
    const subfolders = new Set();
    for (const f of files) {
      const parts = f.path.split('/');
      if (parts.length > 2) subfolders.add(parts[1]);
    }
    const sfInfo = subfolders.size > 0 ? ` (${[...subfolders].sort().join(', ')})` : '';
    out += `- ${sec}: ${files.length} pages${sfInfo}\n`;
  }
  return out;
}
