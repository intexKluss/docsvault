import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpServer } from './mcp-handler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_PATH = process.env.VAULT_PATH || resolve(__dirname, '..', 'vault');

const server = createMcpServer(VAULT_PATH);
const transport = new StdioServerTransport();
await server.connect(transport);
