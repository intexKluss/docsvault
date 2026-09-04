import { getSections, listFiles, getManifest } from './vault.js';

var MAX_INLINE_SUBFOLDERS = 8;
var MAX_INLINE_TITLES = 40;

export function handleOverview(vaultPath, params, vaultName = 'Documentation') {
  var section = params.section;

  if (section) {
    var files = listFiles(vaultPath, section);
    if (files.length === 0) return `Section "${section}" not found or empty.`;

    var groupCounts = new Map();
    for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
      var pathParts = files[fileIndex].path.split('/');
      var group = '_root';
      if (pathParts.length > 2) group = pathParts[1];
      groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    }
    var groups = Array.from(groupCounts.entries());
    groups.sort(function (first, second) {
      return first[0].localeCompare(second[0]);
    });

    if (files.length <= MAX_INLINE_TITLES) {
      var result = `## ${section} (${files.length} pages)\n\n`;
      var filesByGroup = new Map();
      for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
        var pathParts = files[fileIndex].path.split('/');
        var group = '_root';
        if (pathParts.length > 2) group = pathParts[1];
        if (!filesByGroup.has(group)) filesByGroup.set(group, []);
        filesByGroup.get(group).push(files[fileIndex].name);
      }
      var entries = Array.from(filesByGroup.entries());
      entries.sort();
      for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        var names = entries[entryIndex][1];
        names.sort();
        if (entries[entryIndex][0] !== '_root') result += `### ${entries[entryIndex][0]}\n`;
        for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
          result += `- ${names[nameIndex]}\n`;
        }
        result += '\n';
      }
      return result;
    }

    var result = `## ${section} (${files.length} pages, ${groups.length} subfolders)\n\n`;
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      var group = groups[groupIndex][0];
      var count = groups[groupIndex][1];
      if (group === '_root') {
        result += `- (direkt in ${section}): ${count} pages\n`;
      } else {
        result += `- ${group}: ${count} pages\n`;
      }
    }

    var example = groups[0][0];
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      if (groups[groupIndex][0] === '_root') continue;
      example = groups[groupIndex][0];
      break;
    }
    result += `\nSeitentitel: list(section="${section}", subfolder="${example}").`;
    result += '\nDirekt suchen ist meist schneller als durchblättern.';
    return result;
  }

  var manifest = getManifest(vaultPath);
  var sections = getSections(vaultPath);
  var out = `# ${vaultName}`;
  if (manifest?.crawledAt) out += ` (updated: ${manifest.crawledAt.split('T')[0]})`;
  out += '\n\n';
  sections = sections.slice();
  sections.sort();
  for (var sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    var sectionName = sections[sectionIndex];
    var files = listFiles(vaultPath, sectionName);
    var subfolders = new Set();
    for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
      var pathParts = files[fileIndex].path.split('/');
      var group = '_root';
      if (pathParts.length > 2) group = pathParts[1];
      subfolders.add(group);
    }
    var sorted = Array.from(subfolders);
    sorted.sort();
    var sfInfo = '';
    if (sorted.length > 0) {
      if (sorted.length > MAX_INLINE_SUBFOLDERS) {
        var shown = '';
        for (var folderIndex = 0; folderIndex < MAX_INLINE_SUBFOLDERS; folderIndex++) {
          if (shown) shown += ', ';
          shown += sorted[folderIndex];
        }
        var rest = sorted.length - MAX_INLINE_SUBFOLDERS;
        sfInfo = ` (${shown}, +${rest} weitere, nutze overview(${sectionName}))`;
      } else {
        var shown = '';
        for (var folderIndex = 0; folderIndex < sorted.length; folderIndex++) {
          if (shown) shown += ', ';
          shown += sorted[folderIndex];
        }
        sfInfo = ` (${shown})`;
      }
    }
    out += `- ${sectionName}: ${files.length} pages${sfInfo}\n`;
  }
  return out;
}
