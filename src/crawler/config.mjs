import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getDocsPath() {
  const envPath = process.env.OTRIS_DOCS_PATH;
  if (envPath) return resolve(envPath.replace(/^~/, homedir()));

  const bundledVault = join(__dirname, '..', '..', 'vault');
  if (existsSync(bundledVault)) return bundledVault;

  return join(homedir(), '.otris-docs');
}

export function getAuthPath() {
  return join(getDocsPath(), '.auth.json');
}

export function getManifestPath() {
  return join(getDocsPath(), '_manifest.json');
}
