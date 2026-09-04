import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpServer } from './mcp-handler.js';
import { loadVaultRegistry } from './vault-registry.js';
import { warmSearchIndex } from './tools/vault-cache.js';

var __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VAULTS_ROOT = process.env.VAULTS_ROOT || resolve(__dirname, '..', 'vaults');

export async function startMcpStdio(options = {}) {
  var vaultsRoot = options.vaultsRoot || VAULTS_ROOT;
  var registryLoader = options.loadVaultRegistry || loadVaultRegistry;
  var warmIndex = options.warmSearchIndex || warmSearchIndex;
  var createServer = options.createMcpServer || createMcpServer;
  var Transport = options.StdioServerTransport || StdioServerTransport;
  var registry = registryLoader(vaultsRoot);

  if (registry.length === 0) {
    console.error(`[mcp-stdio] WARNING: no vaults found under ${vaultsRoot}`);
  }
  for (var vaultIndex = 0; vaultIndex < registry.length; vaultIndex++) {
    var vault = registry[vaultIndex];
    var index = warmIndex(vault.path);
    if (index) {
      console.error(`[mcp-stdio] ${vault.toolPrefix}: ${index.fileCount} pages, ${index.segmentCount} sections indexed in ${index.buildMs}ms`);
    }
  }
  var server = createServer(registry);
  var transport = new Transport();
  await server.connect(transport);
}

if (process.argv[1] === __filename) {
  if (process.env.VAULT_PATH && !process.env.VAULTS_ROOT) {
    console.error('[mcp-stdio] VAULT_PATH is deprecated, use VAULTS_ROOT (pointing to the parent dir containing vault folders).');
  }
  try {
    await startMcpStdio();
  } catch (err) {
    console.error(`[mcp-stdio] failed to start: ${err.message}`);
    process.exit(1);
  }
}
