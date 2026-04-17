import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpServer } from './mcp-handler.js';
import { loadVaultRegistry } from './vault-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULTS_ROOT = process.env.VAULTS_ROOT || resolve(__dirname, '..', 'vaults');

try {
  const registry = loadVaultRegistry(VAULTS_ROOT);
  if (registry.length === 0) {
    console.error(`[mcp-stdio] WARNING: no vaults found under ${VAULTS_ROOT}`);
  }
  const server = createMcpServer(registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (err) {
  console.error(`[mcp-stdio] failed to start: ${err.message}`);
  process.exit(1);
}
