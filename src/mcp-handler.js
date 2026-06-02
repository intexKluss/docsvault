import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { handleOverview } from './tools/overview.js';
import { handleSearch } from './tools/search.js';
import { handleRead } from './tools/read.js';
import { handleList } from './tools/list.js';
import { handleStatus } from './tools/status.js';

const sseSessions = new Map();

// Obergrenze gleichzeitiger SSE-Verbindungen. Verhindert dass die sseSessions-Map
// unbegrenzt waechst (eine haengende/nie geschlossene Verbindung = ein Server + Transport).
const MAX_SSE_SESSIONS = parseInt(process.env.MAX_SSE_SESSIONS || '100', 10);

// Unterscheidet den "unbekannte Section"-Fehler ({ error }) vom normalen
// Treffer-Array (auch leer = kein Match). Nur ein Nicht-Array-Objekt mit
// String-error gilt als Fehler; ein leeres Array bleibt ein gueltiges Ergebnis.
function isErrorResult(value) {
  return value != null
    && !Array.isArray(value)
    && typeof value === 'object'
    && typeof value.error === 'string';
}

function registerVaultTools(server, vault) {
  const { toolPrefix, description } = vault;
  const vaultPath = vault.path;

  // Jedes neue Tool hier muss auch in TOOL_SUFFIXES in vault-registry.js ergaenzt werden,
  // sonst wird es nicht in describeVaults()/System-Prompt auftauchen.

  server.tool(
    `${toolPrefix}_overview`,
    `Get an overview of: ${description}\n\nStart here. Typical flow: ${toolPrefix}_overview to learn the section names, then ${toolPrefix}_search to find the relevant page, then ${toolPrefix}_read to read it in full.\n\nWithout parameters, returns a compact summary of all sections with page counts. With a section parameter, returns a detailed listing of all pages grouped by subfolder.`,
    {
      section: z.string().optional().describe(`Section name to get detailed listing for. Use exact names as shown by ${toolPrefix}_overview.`),
    },
    async (params) => {
      const result = handleOverview(vaultPath, params, vault.name);
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    `${toolPrefix}_search`,
    `Full-text search across: ${description}\n\nReturns a JSON array of result objects, each shaped like { "file": "<path>", "title": "<page title>", "matches": [{ "line": <n>, "text": "<line text>", "heading": "<nearest heading>" }], "titleMatch": <bool>, "score": <number> }.\n\nTo read a hit, pass its "file" value verbatim as the "path" argument to ${toolPrefix}_read; "file" IS the document path. Never guess or construct paths. Read the result with titleMatch:true (and the highest "score") first, as it marks the canonical page for the query. An empty array means no matches.`,
    {
      query: z.string().describe('Search query (case-insensitive text search)'),
      section: z.string().optional().describe(`Limit search to a specific section. Use exact names as shown by ${toolPrefix}_overview.`),
      max_results: z.number().int().min(1).max(100).optional().describe('Maximum number of results (default: 10, max: 100)'),
      context_lines: z.number().int().min(0).max(20).optional().describe('Number of context lines around each match (default: 3, max: 20)'),
    },
    async (params) => {
      const results = handleSearch(vaultPath, params);
      if (isErrorResult(results)) {
        return { content: [{ type: 'text', text: results.error }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }
  );

  server.tool(
    `${toolPrefix}_read`,
    `Read the full content of a specific page in: ${description}\n\nPass the "file" value from a ${toolPrefix}_search or ${toolPrefix}_list result as the "path" argument here. IMPORTANT: Always use that exact path, never guess or construct paths yourself, as filenames may contain typos or unexpected spelling.`,
    {
      path: z.string().describe(`Exact document path (the "file" field) from ${toolPrefix}_search or ${toolPrefix}_list results, without .md extension.`),
      max_length: z.number().int().min(1).max(200000).optional().describe('Maximum content length in characters (default: 50000, max: 200000).'),
      heading: z.string().optional().describe('Optional heading text from a search result. When set, returns only that section instead of the full page.'),
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
    `List all pages in a section or subfolder of: ${description}\n\nReturns a JSON array of { "name": "<title>", "path": "<path>" } objects. Pass a "path" value verbatim as the "path" argument to ${toolPrefix}_read to read that page; never guess paths.`,
    {
      section: z.string().describe(`Section name. Use exact names as shown by ${toolPrefix}_overview.`),
      subfolder: z.string().optional().describe('Subfolder within the section'),
    },
    async (params) => {
      const files = handleList(vaultPath, params);
      if (isErrorResult(files)) {
        return { content: [{ type: 'text', text: files.error }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(files) }] };
    }
  );

  server.tool(
    `${toolPrefix}_status`,
    `Check the freshness status of: ${description}\n\nReturns page count, PDF count, and how old the vault is.`,
    {},
    async () => {
      const result = handleStatus(vaultPath);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}

export function createMcpServer(vaultRegistry) {
  const server = new McpServer({
    name: 'docsvault',
    version: '0.2.0',
  });

  for (const vault of vaultRegistry) {
    registerVaultTools(server, vault);
  }

  return server;
}

export async function handleSseGet(req, res, vaultRegistry) {
  // Cap erreicht: neue Verbindung ablehnen statt die Map weiter wachsen zu lassen.
  if (sseSessions.size >= MAX_SSE_SESSIONS) {
    res.status(503).json({ error: 'Too many active SSE sessions. Try again later.' });
    return;
  }

  const transport = new SSEServerTransport('/messages', res);
  const server = createMcpServer(vaultRegistry);

  sseSessions.set(transport.sessionId, transport);
  res.on('close', () => {
    sseSessions.delete(transport.sessionId);
    // Transport und Server beim Verbindungsabbruch aufraeumen, sonst bleiben
    // sie samt Listenern haengen (Leak ueber viele Verbindungen).
    Promise.resolve(transport.close?.()).catch(() => {});
    Promise.resolve(server.close?.()).catch(() => {});
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
