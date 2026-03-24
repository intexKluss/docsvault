import { existsSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { getAuthPath, getDocsPath } from './config.mjs';

export async function loginInteractive() {
  const { chromium } = await loadPlaywright();
  const authPath = getAuthPath();
  const docsPath = getDocsPath();
  if (!existsSync(docsPath)) mkdirSync(docsPath, { recursive: true });
  const gitignorePath = join(docsPath, '.gitignore');
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, '.auth.json\n');

  console.log('Opening browser for otris.software login...');
  console.log('Log in, then close the browser window.');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://otris.software/documents/');
  await page.waitForEvent('close', { timeout: 300000 }).catch(() => {});
  await context.storageState({ path: authPath });
  await browser.close();
  chmodSync(authPath, 0o600);
  console.log(`Auth saved to ${authPath}`);
}

export function loadAuthState() {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) throw new Error('No auth state found. Run: otris-docs-mcp crawl --login');
  return authPath;
}

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.error('Playwright not found. Install it:');
    console.error('  npm install -g playwright && npx playwright install chromium');
    process.exit(1);
  }
}
