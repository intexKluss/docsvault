import { getSections, listFiles, getManifest } from './vault.js';

// max. Anzahl Subfolder die inline pro Section in der Gesamt-Übersicht
// gelistet werden, bevor auf "+N weitere" gekürzt wird (Punkt 16).
const MAX_INLINE_SUBFOLDERS = 8;

export function handleOverview(vaultPath, params, vaultName = 'Documentation') {
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
  let out = `# ${vaultName}`;
  if (manifest?.crawledAt) out += ` (updated: ${manifest.crawledAt.split('T')[0]})`;
  out += '\n\n';
  for (const sec of sections.slice().sort()) {
    const files = listFiles(vaultPath, sec);
    const subfolders = new Set();
    for (const f of files) {
      const parts = f.path.split('/');
      if (parts.length > 2) subfolders.add(parts[1]);
    }
    let sfInfo = '';
    if (subfolders.size > 0) {
      const sorted = [...subfolders].sort();
      // große Sections nicht voll auflisten, sonst sprengt es das Token-Budget
      if (sorted.length > MAX_INLINE_SUBFOLDERS) {
        const shown = sorted.slice(0, MAX_INLINE_SUBFOLDERS).join(', ');
        const rest = sorted.length - MAX_INLINE_SUBFOLDERS;
        sfInfo = ` (${shown}, +${rest} weitere, nutze overview(${sec}))`;
      } else {
        sfInfo = ` (${sorted.join(', ')})`;
      }
    }
    out += `- ${sec}: ${files.length} pages${sfInfo}\n`;
  }
  return out;
}
