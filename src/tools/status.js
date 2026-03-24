import { getManifest, getSections, listFiles } from './vault.js';
import { existsSync } from 'fs';

export function handleStatus(vaultPath) {
  if (!existsSync(vaultPath)) {
    return {
      status: 'not_installed',
      message: 'No documentation found. Run: otris-docs-mcp crawl --login && otris-docs-mcp crawl'
    };
  }

  const manifest = getManifest(vaultPath);
  const sections = getSections(vaultPath);

  let totalPages = 0;
  for (const sec of sections) {
    totalPages += listFiles(vaultPath, sec).length;
  }

  if (!manifest) {
    return {
      status: 'unknown',
      message: `Documentation found (${totalPages} pages, ${sections.length} sections) but no manifest. Consider re-crawling.`,
      pages: totalPages,
      sections: sections.length
    };
  }

  const crawledAt = new Date(manifest.crawledAt);
  const now = new Date();
  const daysOld = Math.floor((now - crawledAt) / (1000 * 60 * 60 * 24));

  let status, message;
  if (daysOld <= 7) {
    status = 'current';
    message = `Documentation is up to date (crawled ${daysOld === 0 ? 'today' : daysOld + ' days ago'}).`;
  } else if (daysOld <= 30) {
    status = 'aging';
    message = `Documentation is ${daysOld} days old. Consider running: otris-docs-mcp crawl`;
  } else {
    status = 'stale';
    message = `Documentation is ${daysOld} days old! Run: otris-docs-mcp crawl`;
  }

  return {
    status,
    message,
    crawledAt: manifest.crawledAt,
    daysOld,
    pages: manifest.pageCount || totalPages,
    pdfs: manifest.pdfCount || 0,
    errors: manifest.errorCount || 0,
    sections: manifest.sections || sections,
    crawlerVersion: manifest.crawlerVersion || 'unknown'
  };
}
