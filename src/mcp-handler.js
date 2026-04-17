import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { handleOverview } from './tools/overview.js';
import { handleSearch } from './tools/search.js';
import { handleRead } from './tools/read.js';
import { handleList } from './tools/list.js';
import { handleStatus } from './tools/status.js';

const sseSessions = new Map();

function registerVaultTools(server, vault) {
  const { toolPrefix, description } = vault;
  const vaultPath = vault.path;

  server.tool(
    `${toolPrefix}_overview`,
    `Get an overview of: ${description} Without parameters, returns a compact summary of all sections with page counts. With a section parameter, returns a detailed listing of all pages grouped by subfolder.`,
    {
      section: z.string().optional().describe('Section name to get detailed listing for'),
    },
    async (params) => {
      const result = handleOverview(vaultPath, params);
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    `${toolPrefix}_search`,
    `Full-text search across: ${description} Returns matching files with context lines around each match. Use this to find specific content in this vault.`,
    {
      query: z.string().describe('Search query (case-insensitive text search)'),
      section: z.string().optional().describe('Limit search to a specific section'),
      max_results: z.number().optional().describe('Maximum number of results (default: 10)'),
      context_lines: z.number().optional().describe('Number of context lines around each match (default: 3)'),
    },
    async (params) => {
      const results = handleSearch(vaultPath, params);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    `${toolPrefix}_read`,
    `Read the full content of a specific page in: ${description} Use the path from the _overview or _search results. Returns title, source URL, and markdown content.`,
    {
      path: z.string().describe('Document path relative to vault root, without .md extension'),
      max_length: z.number().optional().describe('Maximum content length in characters (default: 50000).'),
    },
    async (params) => {
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
    }
  );

  server.tool(
    `${toolPrefix}_list`,
    `List all pages in a section or subfolder of: ${description} Returns an array of {name, path} objects.`,
    {
      section: z.string().describe('Section name'),
      subfolder: z.string().optional().describe('Subfolder within the section'),
    },
    async (params) => {
      const files = handleList(vaultPath, params);
      return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] };
    }
  );

  server.tool(
    `${toolPrefix}_status`,
    `Check the freshness status of: ${description} Returns page count, PDF count, and how old the vault is.`,
    {},
    async () => {
      const result = handleStatus(vaultPath);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

export function createMcpServer(vaultRegistry) {
  const server = new McpServer({
    name: 'otris-docs-mcp',
    version: '0.2.0',
  });

  for (const vault of vaultRegistry) {
    registerVaultTools(server, vault);
  }

  return server;
}

export async function handleSseGet(req, res, vaultRegistry) {
  const transport = new SSEServerTransport('/messages', res);
  const server = createMcpServer(vaultRegistry);

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

export async function handleStreamablePost(req, res, vaultRegistry) {
  let StreamableHTTPServerTransport;
  try {
    const mod = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    StreamableHTTPServerTransport = mod.StreamableHTTPServerTransport;
  } catch {
    res.status(500).json({ error: 'StreamableHTTPServerTransport not available in this SDK version' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(vaultRegistry);
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
