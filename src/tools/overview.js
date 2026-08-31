import { getSections, listFiles, getManifest } from './vault.js';

// max. Anzahl Subfolder die inline pro Section in der Gesamt-Übersicht
// gelistet werden, bevor auf "+N weitere" gekürzt wird.
const MAX_INLINE_SUBFOLDERS = 8;

// Bis zu sovielen Seiten listet overview(section) noch die Titel selbst.
// Darüber gibt es nur noch Subfolder mit Seitenzahlen, die Titel-Ebene
// gehört dann in list(section, subfolder).
const MAX_INLINE_TITLES = 40;

export function handleOverview(vaultPath, params, vaultName = 'Documentation') {
  const { section } = params;

  if (section) return sectionOverview(vaultPath, section);

  const manifest = getManifest(vaultPath);
  const sections = getSections(vaultPath);
  let out = `# ${vaultName}`;
  if (manifest?.crawledAt) out += ` (updated: ${manifest.crawledAt.split('T')[0]})`;
  out += '\n\n';
  for (const sec of sections.slice().sort()) {
    const files = listFiles(vaultPath, sec);
    const sorted = [...subfolderCounts(files).keys()].sort();
    let sfInfo = '';
    if (sorted.length > 0) {
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

// Subfolder (erste Ebene unter der Section) mit Seitenzahl. '_root' sammelt
// die Seiten die direkt in der Section liegen.
function subfolderCounts(files) {
  const counts = new Map();
  for (const f of files) {
    const parts = f.path.split('/');
    const group = parts.length > 2 ? parts[1] : '_root';
    counts.set(group, (counts.get(group) || 0) + 1);
  }
  return counts;
}

// Section-Übersicht: bei großen Sections nur Subfolder mit Seitenzahlen, nicht
// hunderte Titel. Die Titel holt man sich gezielt per list(section, subfolder).
function sectionOverview(vaultPath, section) {
  const files = listFiles(vaultPath, section);
  if (files.length === 0) return `Section "${section}" not found or empty.`;

  const counts = subfolderCounts(files);
  const groups = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (files.length <= MAX_INLINE_TITLES) {
    let out = `## ${section} (${files.length} pages)\n\n`;
    const byGroup = new Map();
    for (const f of files) {
      const parts = f.path.split('/');
      const group = parts.length > 2 ? parts[1] : '_root';
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push(f.name);
    }
    for (const [group, names] of [...byGroup.entries()].sort()) {
      if (group !== '_root') out += `### ${group}\n`;
      for (const n of names.sort()) out += `- ${n}\n`;
      out += '\n';
    }
    return out;
  }

  let out = `## ${section} (${files.length} pages, ${groups.length} subfolders)\n\n`;
  for (const [group, count] of groups) {
    out += group === '_root'
      ? `- (direkt in ${section}): ${count} pages\n`
      : `- ${group}: ${count} pages\n`;
  }
  const example = groups.find(g => g[0] !== '_root')?.[0] || groups[0][0];
  out += `\nSeitentitel: list(section="${section}", subfolder="${example}").`;
  out += `\nDirekt suchen ist meist schneller als durchblaettern.`;
  return out;
}
