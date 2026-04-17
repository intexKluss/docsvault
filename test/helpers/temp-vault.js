// test/helpers/temp-vault.js
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Erstellt ein temporaeres VAULTS_ROOT mit beliebigen Vaults darin.
// vaults: { [folderName]: { meta?: object, files?: { [relPath]: string } } }
// Returns: { root: string, cleanup: () => void }
export function createTempVaultsRoot(vaults = {}) {
  const root = mkdtempSync(join(tmpdir(), 'otris-vaults-'));

  for (const [folderName, config] of Object.entries(vaults)) {
    const vaultDir = join(root, folderName);
    mkdirSync(vaultDir, { recursive: true });

    if (config.meta !== undefined) {
      const content = typeof config.meta === 'string'
        ? config.meta
        : JSON.stringify(config.meta, null, 2);
      writeFileSync(join(vaultDir, '_meta.json'), content);
    }

    for (const [relPath, content] of Object.entries(config.files || {})) {
      const full = join(vaultDir, relPath);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
  }

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
