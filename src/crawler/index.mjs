import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { loginInteractive, loadAuthState, loadPlaywright } from './auth.mjs';
import { SECTIONS, BASE_URL } from './sections.mjs';
import { extractFromPage } from './extractors.mjs';
import { buildFileIndex, convertLinks } from './link-converter.mjs';
import { getDocsPath, getManifestPath } from './config.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 80);
}

function makeFrontmatter(title, sourceUrl) {
  const escaped = (title || '').replace(/"/g, '\\"');
  return `---\ntitle: "${escaped}"\nsource: "${sourceUrl}"\n---\n\n`;
}

function writeDoc(filePath, title, sourceUrl, content) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, makeFrontmatter(title, sourceUrl) + content);
}

/**
 * Delete all non-dot-prefixed directories and files in docsPath,
 * but keep .auth.json, .gitignore, _manifest.json, etc.
 */
function cleanDocs(docsPath) {
  if (!existsSync(docsPath)) return;
  for (const entry of readdirSync(docsPath)) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const full = join(docsPath, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      rmSync(full, { recursive: true, force: true });
    } else {
      rmSync(full, { force: true });
    }
  }
}

/**
 * Walk all .md files in a directory tree.
 */
function walkMd(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkMd(full));
    } else if (entry.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Link collection helpers
// ---------------------------------------------------------------------------

async function collectSidebarLinks(page, sectionUrl) {
  await page.goto(sectionUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  const links = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll('[class*=sidebar] a, .tsd-navigation a, .tsd-index-list a')
    ).map(a => ({
      text: a.textContent.trim(),
      href: a.href,
    })).filter(l => l.href.includes('otris.software') && !l.href.includes('#'));
  });

  // Deduplicate
  const seen = new Set();
  return links.filter(l => {
    if (seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  });
}

async function collectHowtoLinks(page) {
  await page.goto(BASE_URL + '/howto/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  return page.evaluate(() => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a'))
      .filter(a =>
        a.href.includes('/documents/howto/') &&
        a.href.endsWith('.html') &&
        a.textContent.trim().length > 0
      )
      .map(a => ({ text: a.textContent.trim(), href: a.href }))
      .filter(l => { if (seen.has(l.href)) return false; seen.add(l.href); return true; });
  });
}

async function collectManualLinks(page) {
  await page.goto(BASE_URL + '/manuals/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  const allLinks = await page.evaluate(() => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a'))
      .filter(a =>
        a.href.includes('/documents/manuals/') &&
        a.textContent.trim().length > 0 &&
        !a.href.endsWith('#')
      )
      .map(a => ({ text: a.textContent.trim(), href: a.href }))
      .filter(l => { if (seen.has(l.href)) return false; seen.add(l.href); return true; });
  });

  return {
    books: allLinks.filter(l => l.href.includes('/books/')),
    pdfs: allLinks.filter(l => l.href.endsWith('.pdf')),
  };
}

async function collectBookSubPages(page, bookHref) {
  await page.goto(bookHref, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  return page.evaluate((href) => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a'))
      .filter(a =>
        a.href.includes('.html') &&
        a.href.startsWith(href.replace(/\/$/, '')) &&
        a.textContent.trim().length > 0
      )
      .map(a => ({ text: a.textContent.trim(), href: a.href }))
      .filter(l => { if (seen.has(l.href)) return false; seen.add(l.href); return true; });
  }, bookHref);
}

// ---------------------------------------------------------------------------
// Section crawlers
// ---------------------------------------------------------------------------

async function crawlApiSection(page, section, docsPath, stats) {
  const sectionUrl = BASE_URL + section.urlPath;
  const sectionDir = join(docsPath, sanitize(section.name));
  const sectionBaseUrl = sectionUrl.replace(/\/$/, '');

  console.log(`\n=== ${section.name} (${sectionUrl}) ===`);

  const links = await collectSidebarLinks(page, sectionUrl);

  // Always include the index page itself
  const allUrls = [{ text: section.name, href: sectionUrl }, ...links];
  const uniqueUrls = [...new Map(allUrls.map(l => [l.href, l])).values()];
  console.log(`  Found ${uniqueUrls.length} pages`);

  for (let i = 0; i < uniqueUrls.length; i++) {
    const link = uniqueUrls[i];

    // Skip PDF URLs (would trigger download error)
    if (link.href.endsWith('.pdf')) {
      console.log(`  Skipping PDF: ${link.href}`);
      continue;
    }

    // Compute file path from URL structure
    const urlPart = link.href.split(sectionBaseUrl)[1] || '';
    const clean = urlPart.replace(/\.html$/, '').replace(/^\/|\/$/g, '');
    const filePath = clean
      ? join(sectionDir, ...clean.split('/').map(sanitize)) + '.md'
      : join(sectionDir, '_index.md');

    try {
      await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(500);

      const { title, content } = await extractFromPage(page, section.type);
      writeDoc(filePath, title, link.href, content);
      stats.pages++;

      if ((i + 1) % 10 === 0 || i === uniqueUrls.length - 1) {
        console.log(`  [${i + 1}/${uniqueUrls.length}] ${link.text}`);
      }
    } catch (err) {
      stats.errors.push({ url: link.href, error: err.message });
      console.error(`  ERROR: ${link.href} - ${err.message}`);
    }
  }
}

async function crawlOtrTools(page, section, docsPath, stats) {
  console.log(`\n=== ${section.name} ===`);

  for (const sub of section.subsections) {
    const subSection = {
      name: sub.name,
      urlPath: sub.urlPath,
      type: 'jsdoc', // otr tools use jsdoc/typedoc style
    };
    await crawlApiSection(page, subSection, docsPath, stats);
  }
}

async function crawlHowTos(page, docsPath, stats) {
  console.log('\n=== HowTos ===');
  const howtoDir = join(docsPath, 'HowTos');

  try {
    const links = await collectHowtoLinks(page);
    console.log(`  Found ${links.length} pages`);

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      try {
        await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(500);

        const { title, content } = await extractFromPage(page, 'otris-book');
        const filename = sanitize(link.text || title || 'page_' + i) + '.md';
        writeDoc(join(howtoDir, filename), title, link.href, content);
        stats.pages++;

        if ((i + 1) % 10 === 0 || i === links.length - 1) {
          console.log(`  [${i + 1}/${links.length}] ${link.text}`);
        }
      } catch (err) {
        stats.errors.push({ url: link.href, error: err.message });
        console.error(`  ERROR: ${link.href} - ${err.message}`);
      }
    }
  } catch (err) {
    stats.errors.push({ url: 'howtos', error: err.message });
    console.error(`  HOWTO ERROR: ${err.message}`);
  }
}

async function crawlProperties(page, docsPath, stats) {
  console.log('\n=== Properties ===');
  const propsDir = join(docsPath, 'Properties');
  const propsUrl = BASE_URL + '/api/properties/';

  try {
    await page.goto(propsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const { title, content } = await extractFromPage(page, 'properties');
    const filePath = join(propsDir, 'All Properties.md');
    writeDoc(filePath, 'DOCUMENTS Properties', propsUrl, content);
    stats.pages++;
    console.log(`  Saved as single file (${(content.length / 1024).toFixed(0)}KB)`);
  } catch (err) {
    stats.errors.push({ url: propsUrl, error: err.message });
    console.error(`  PROPERTIES ERROR: ${err.message}`);
  }
}

async function crawlManuals(page, authPath, docsPath, stats) {
  console.log('\n=== Manuals ===');
  const manualsDir = join(docsPath, 'Manuals');

  try {
    const { books, pdfs } = await collectManualLinks(page);

    // --- PDFs ---
    console.log(`\n  --- PDFs (${pdfs.length}) ---`);
    const pdfDir = join(manualsDir, 'PDFs');
    if (!existsSync(pdfDir)) mkdirSync(pdfDir, { recursive: true });

    // Parse auth cookies from storageState for curl
    const authData = JSON.parse(readFileSync(authPath, 'utf-8'));
    const cookieStr = authData.cookies.map(c => c.name + '=' + c.value).join('; ');

    for (let i = 0; i < pdfs.length; i++) {
      const pdf = pdfs[i];
      const filename = sanitize(pdf.text) + '.pdf';
      try {
        execFileSync('curl', ['-sL', '-b', cookieStr, pdf.href, '-o', join(pdfDir, filename)], { timeout: 30000 });
        stats.pages++;
        stats.pdfs++;
        if ((i + 1) % 10 === 0 || i === pdfs.length - 1) {
          console.log(`  [${i + 1}/${pdfs.length}] ${pdf.text}`);
        }
      } catch (err) {
        stats.errors.push({ url: pdf.href, error: err.message });
        console.error(`  PDF ERROR: ${pdf.text} - ${err.message}`);
      }
    }

    // --- Books ---
    console.log(`\n  --- Books (${books.length}) ---`);
    for (let bi = 0; bi < books.length; bi++) {
      const book = books[bi];
      const bookDir = join(manualsDir, sanitize(book.text));

      try {
        const subPages = await collectBookSubPages(page, book.href);

        // Include the index page itself
        const allPages = [{ text: book.text, href: book.href }, ...subPages];
        const uniquePages = [...new Map(allPages.map(l => [l.href, l])).values()];

        for (let i = 0; i < uniquePages.length; i++) {
          const sp = uniquePages[i];

          // Skip PDF links inside book pages
          if (sp.href.endsWith('.pdf')) continue;

          try {
            await page.goto(sp.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(300);

            const { title, content } = await extractFromPage(page, 'manuals');
            if (content.length < 5) continue;

            const filename = sanitize(sp.text || title || 'page_' + i) + '.md';
            writeDoc(join(bookDir, filename), title, sp.href, content);
            stats.pages++;
          } catch (err) {
            stats.errors.push({ url: sp.href, error: err.message });
          }
        }

        console.log(`  [${bi + 1}/${books.length}] ${book.text} (${uniquePages.length} pages)`);
      } catch (err) {
        stats.errors.push({ url: book.href, error: err.message });
        console.error(`  BOOK ERROR: ${book.text} - ${err.message}`);
      }
    }
  } catch (err) {
    stats.errors.push({ url: 'manuals', error: err.message });
    console.error(`  MANUALS ERROR: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Link conversion pass
// ---------------------------------------------------------------------------

function convertAllLinks(docsPath) {
  console.log('\n=== Converting Links ===');
  const fileIndex = buildFileIndex(docsPath);
  const mdFiles = walkMd(docsPath);
  let converted = 0;

  for (const filePath of mdFiles) {
    const relPath = filePath.slice(docsPath.length + 1).replace(/\.md$/, '');
    const content = readFileSync(filePath, 'utf-8');
    const updated = convertLinks(content, relPath, fileIndex);
    if (updated !== content) {
      writeFileSync(filePath, updated);
      converted++;
    }
  }

  console.log(`  Converted links in ${converted} files (${mdFiles.length} total)`);
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function writeManifest(docsPath, stats) {
  const manifest = {
    crawledAt: new Date().toISOString(),
    crawlerVersion: '0.1.0',
    pageCount: stats.pages,
    pdfCount: stats.pdfs || 0,
    errorCount: stats.errors.length,
    sections: stats.sections,
  };
  writeFileSync(getManifestPath(), JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${getManifestPath()}`);
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runCrawl({ login, section }) {
  // Step 1: Interactive login if requested
  if (login) {
    await loginInteractive();
    if (!section) {
      console.log('Login complete. Run again without --login to crawl.');
      return;
    }
  }

  // Step 2: Load auth state
  const authPath = loadAuthState();

  // Step 3: Load Playwright
  const { chromium } = await loadPlaywright();

  const docsPath = getDocsPath();
  if (!existsSync(docsPath)) mkdirSync(docsPath, { recursive: true });

  // Step 4: Clean existing docs
  console.log(`Cleaning ${docsPath}...`);
  cleanDocs(docsPath);

  // Step 5: Launch browser
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: authPath });
  const page = await context.newPage();

  const stats = { pages: 0, pdfs: 0, errors: [], sections: [] };

  // Determine which sections to crawl
  const sectionsToProcess = section
    ? SECTIONS.filter(s => s.id === section || s.name.toLowerCase() === section.toLowerCase())
    : SECTIONS;

  if (section && sectionsToProcess.length === 0) {
    console.error(`Unknown section: ${section}`);
    console.error(`Available: ${SECTIONS.map(s => s.id).join(', ')}`);
    await browser.close();
    return;
  }

  // Step 6: Crawl each section
  for (const sec of sectionsToProcess) {
    stats.sections.push(sec.id);
    try {
      switch (sec.type) {
        case 'typedoc':
        case 'jsdoc':
          await crawlApiSection(page, sec, docsPath, stats);
          break;

        case 'mixed':
          await crawlOtrTools(page, sec, docsPath, stats);
          break;

        case 'otris-book':
          await crawlHowTos(page, docsPath, stats);
          break;

        case 'properties':
          await crawlProperties(page, docsPath, stats);
          break;

        case 'manuals':
          await crawlManuals(page, authPath, docsPath, stats);
          break;

        default:
          console.warn(`Unknown section type: ${sec.type} for ${sec.name}`);
      }
    } catch (err) {
      stats.errors.push({ url: sec.name, error: err.message });
      console.error(`SECTION ERROR [${sec.name}]: ${err.message}`);
    }
  }

  // Step 7: Close browser
  await browser.close();

  // Step 8: Convert links
  convertAllLinks(docsPath);

  // Step 9: Write manifest
  writeManifest(docsPath, stats);

  // Summary
  console.log(`\n=== DONE ===`);
  console.log(`Total pages saved: ${stats.pages}`);
  console.log(`Errors: ${stats.errors.length}`);
  if (stats.errors.length > 0) {
    const errPath = join(docsPath, '_errors.json');
    writeFileSync(errPath, JSON.stringify(stats.errors, null, 2));
    console.log(`Error details: ${errPath}`);
  }
}
