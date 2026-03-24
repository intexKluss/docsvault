import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { handleOverview } from './tools/overview.js';
import { handleSearch } from './tools/search.js';
import { handleRead } from './tools/read.js';
import { handleList } from './tools/list.js';
import { handleStatus } from './tools/status.js';

const sseSessions = new Map();

export function createMcpServer(vaultPath) {
  const server = new McpServer({
    name: 'otris-docs-mcp',
    version: '0.1.0',
  });

  server.tool('otris_overview', 'Get an overview of the otris DOCUMENTS documentation vault. Without parameters, returns a compact summary of all sections with page counts. With a section parameter, returns a detailed listing of all pages grouped by subfolder.', { section: z.string().optional().describe('Section name to get detailed listing for (e.g. "portalscript-api", "howtos")') }, async (params) => {
    const result = handleOverview(vaultPath, params);
    return { content: [{ type: 'text', text: result }] };
  });

  server.tool('otris_search', 'Full-text search across the otris DOCUMENTS documentation. Returns matching files with context lines around each match. Use this to find specific API methods, classes, properties, or howto content.', { query: z.string().describe('Search query (case-insensitive text search)'), section: z.string().optional().describe('Limit search to a specific section (e.g. "portalscript-api")'), max_results: z.number().optional().describe('Maximum number of results (default: 10)'), context_lines: z.number().optional().describe('Number of context lines around each match (default: 3)') }, async (params) => {
    const results = handleSearch(vaultPath, params);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });

  server.tool('otris_read', 'Read the full content of a specific documentation page. Use the path from otris_overview or otris_search results. Returns title, source URL, and markdown content.', { path: z.string().describe('Document path relative to vault root, without .md extension (e.g. "portalscript-api/classes/DocFile")'), max_length: z.number().optional().describe('Maximum content length in characters (default: 50000). Content beyond this is truncated.') }, async (params) => {
    const result = handleRead(vaultPath, params);
    if (result.error) {
      return { content: [{ type: 'text', text: result.error }], isError: true };
    }
    let text = '';
    if (result.title) text += `# ${result.title}\n\n`;
    if (result.source) text += `Source: ${result.source}\n\n`;
    text += result.content;
    if (result.truncated) text += '\n\n⚠️ Content was truncated.';
    return { content: [{ type: 'text', text }] };
  });

  server.tool('otris_list', 'List all documentation pages in a section or subfolder. Returns an array of {name, path} objects. Use this to enumerate available pages before reading them.', { section: z.string().describe('Section name (e.g. "portalscript-api", "howtos", "properties")'), subfolder: z.string().optional().describe('Subfolder within the section (e.g. "classes", "interfaces")') }, async (params) => {
    const files = handleList(vaultPath, params);
    return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] };
  });

  server.tool('otris_status', 'Check the status of the local otris DOCUMENTS documentation vault. Returns freshness, page count, PDF count, and whether an update is recommended.', {}, async () => {
    const result = handleStatus(vaultPath);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

export async function handleSseGet(req, res, vaultPath) {
  const transport = new SSEServerTransport('/messages', res);
  const server = createMcpServer(vaultPath);

  sseSessions.set(transport.sessionId, transport);
  res.on('close', () => {
    sseSessions.delete(transport.sessionId);
  });

  await server.connect(transport);
}

export async function handleSsePost(req, res) {
  const sessionId = req.query.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'Missing sessionId parameter' });
    return;
  }
  const transport = sseSessions.get(sessionId);
  if (!transport) {
    res.status(400).json({ error: 'No active SSE session' });
    return;
  }
  await transport.handlePostMessage(req, res);
}

export async function initStreamableHttp() {
  try {
    await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    return true;
  } catch {
    return false;
  }
}

export async function handleStreamablePost(req, res, vaultPath) {
  let StreamableHTTPServerTransport;
  try {
    const mod = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    StreamableHTTPServerTransport = mod.StreamableHTTPServerTransport;
  } catch {
    res.status(500).json({ error: 'StreamableHTTPServerTransport not available in this SDK version' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(vaultPath);
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
