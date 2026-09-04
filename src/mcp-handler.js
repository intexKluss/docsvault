import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { handleOverview } from './tools/overview.js';
import { handleSearch } from './tools/search.js';
import { handleRead, MAX_MCP_READ_LENGTH } from './tools/read.js';
import { handleListPaged } from './tools/list.js';
import { handleStatus } from './tools/status.js';

const sseSessions = new Map();

// Obergrenze gleichzeitiger SSE-Verbindungen. Verhindert dass die sseSessions-Map
// unbegrenzt wächst (eine hängende/nie geschlossene Verbindung = ein Server + Transport).
const MAX_SSE_SESSIONS = parseInt(process.env.MAX_SSE_SESSIONS || '100', 10);

// Unterscheidet den "unbekannte Section"-Fehler ({ error }) vom normalen
// Treffer-Array (auch leer = kein Match). Nur ein Nicht-Array-Objekt mit
// String-error gilt als Fehler; ein leeres Array bleibt ein gültiges Ergebnis.
function isErrorResult(value) {
  return value != null
    && !Array.isArray(value)
    && typeof value === 'object'
    && typeof value.error === 'string';
}

// alle docsvault-tools lesen nur, nie schreiben. die annotation sagt codex das,
// sonst schiebt die cli sie unter read-only-sandbox in einen approval-flow und
// cancelt den call headless ("user cancelled MCP tool call").
const READONLY_TOOL = { readOnlyHint: true, openWorldHint: false };

// Die Recherche-Methodik steht bewusst NICHT in jeder Tool-Beschreibung.
// Tool-Beschreibungen liegen dauerhaft im Kontext, einmal pro Vault; die
// initialize-instructions gibt es einmal pro Server. Jede Tool-Beschreibung
// ist deshalb ein bis zwei Sätze, alles Methodische steht hier.
export function buildInstructions(vaultRegistry) {
  const lines = [
    'Read-only documentation vaults. Each vault has its own tool prefix.',
    '',
    'Flow: <prefix>_overview for section names, <prefix>_search for the term, <prefix>_read for the page.',
    '',
    'Search results are section-level. Each hit is { file, title, headings, snippet, score }.',
    'Pass "file" verbatim as _read\'s "path" and one of "headings" as its "heading" to get just that',
    'section. Reading without a heading returns intro plus table of contents on long pages, by design.',
    '',
    'Rules:',
    '- Never guess or construct a path. Only use "file"/"path" values a tool returned.',
    '- Snippets are pointers, not the answer. Open the page before answering.',
    '- Thin results: search again with other words (synonym, German and English, method and concept name).',
    '- Concept/handbook, API reference and properties/config pages answer different parts of a question.',
    '  Check every relevant type, not just the first hit.',
    '- Tight context budget: set max_tokens on search and read.',
  ];

  if (vaultRegistry.length) {
    lines.push('', 'Vaults:');
    for (const vault of vaultRegistry) {
      lines.push(`- ${vault.toolPrefix}_*: ${vault.description}`);
      if (vault.searchHint) lines.push(`  ${vault.searchHint}`);
    }
  }

  return lines.join('\n');
}

function registerVaultTools(server, vault) {
  const { toolPrefix, description } = vault;
  const vaultPath = vault.path;
  // vault-spezifischer Hinweis aus _meta.json: nur noch als Verweis, der Text
  // selbst steht in den Server-instructions.
  const hintRef = vault.searchHint ? ` See this server's instructions for what lives where.` : '';

  // Jedes neue Tool hier muss auch in TOOL_SUFFIXES in vault-registry.js ergänzt werden,
  // sonst wird es nicht in describeVaults()/System-Prompt auftauchen.

  server.tool(
    `${toolPrefix}_overview`,
    `Sections and page counts of: ${description}\nStart here, then ${toolPrefix}_search, then ${toolPrefix}_read. With "section": its subfolders and their page counts.`,
    {
      section: z.string().optional().describe('Section name, exactly as listed without this parameter.'),
    },
    READONLY_TOOL,
    async (params) => {
      const result = handleOverview(vaultPath, params, vault.name);
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    `${toolPrefix}_search`,
    `Full-text search in: ${description}\nReturns hits as { file, title, headings, snippet, score }, best first. Pass "file" verbatim to ${toolPrefix}_read, plus one of "headings" to read just that section.${hintRef}`,
    {
      query: z.string().describe('Search terms.'),
      section: z.string().optional().describe('Limit to one section.'),
      max_results: z.number().int().min(1).max(100).optional().describe('Default 5.'),
      context_lines: z.number().int().min(0).max(20).optional().describe('Only for "detailed". Default 3.'),
      response_format: z.enum(['concise', 'detailed']).optional().describe('"detailed" adds every matching line.'),
      max_tokens: z.number().int().min(50).max(50000).optional().describe('Hard response budget.'),
    },
    READONLY_TOOL,
    async (params) => {
      const results = handleSearch(vaultPath, params);
      if (isErrorResult(results)) {
        return { content: [{ type: 'text', text: results.error }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }
  );

  if (toolPrefix === 'otris') {
    server.tool(
      'otris_technical_search',
      'Exact otris TypeScript API search.',
      {
        query: z.string().describe('API term.'),
        max_results: z.number().int().min(1).max(100).optional(),
        context_lines: z.number().int().min(0).max(20).optional(),
        response_format: z.enum(['concise', 'detailed']).optional(),
        max_tokens: z.number().int().min(50).max(50000).optional(),
      },
      READONLY_TOOL,
      async (params) => {
        const results = handleSearch(vaultPath, { ...params, section: 'Scripting/TERAS API' });
        if (isErrorResult(results)) {
          return { content: [{ type: 'text', text: results.error }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      }
    );
  }

  server.tool(
    `${toolPrefix}_read`,
    `Read one page of: ${description}\nUse a "file" value from ${toolPrefix}_search verbatim. Set "heading" to read a single section; without it, long pages return intro plus a table of contents to pick from.`,
    {
      path: z.string().describe('Exact "file" value from a search/list result, without .md.'),
      heading: z.string().optional().describe('Returns only that section. Preferred on API/properties pages.'),
      max_length: z.number().int().min(1).max(MAX_MCP_READ_LENGTH).optional().describe('Characters. Default 8000, capped at 25000.'),
      max_tokens: z.number().int().min(50).max(50000).optional().describe('Hard response budget.'),
    },
    READONLY_TOOL,
    async (params) => {
      const result = handleRead(vaultPath, params, MAX_MCP_READ_LENGTH);
      if (result.error) {
        return { content: [{ type: 'text', text: result.error }], isError: true };
      }
      let text = '';
      if (result.title) text += `# ${result.title}\n\n`;
      if (result.source) text += `Source: ${result.source}\n\n`;
      text += result.content;
      // 'toc', 'truncated' und 'heading-not-found' tragen ihren Hinweis schon
      // im Text; nur der abgeschnittene Einzelabschnitt braucht noch einen.
      if (result.truncated && result.mode === 'heading') {
        text += `\n\n[section truncated, raise max_length]`;
      }
      if (Number.isFinite(Number(params.max_tokens))) {
        text = text.slice(0, Number(params.max_tokens) * 4);
      }
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    `${toolPrefix}_list`,
    `Page titles in a section or subfolder of: ${description}\nSection and subfolder names come from ${toolPrefix}_overview. Long listings are capped.`,
    {
      section: z.string().describe('Section name.'),
      subfolder: z.string().optional().describe('Subfolder within the section.'),
      max_results: z.number().int().min(1).max(500).optional().describe('Default 50.'),
    },
    READONLY_TOOL,
    async (params) => {
      const result = handleListPaged(vaultPath, params);
      if (isErrorResult(result)) {
        return { content: [{ type: 'text', text: result.error }], isError: true };
      }
      let text = JSON.stringify(result.files);
      if (result.truncated) text += `\n${result.note}`;
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    `${toolPrefix}_status`,
    `Freshness of: ${description}\nPage count, PDF count, vault age.`,
    {},
    READONLY_TOOL,
    async () => {
      const result = handleStatus(vaultPath);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}

export function createMcpServer(vaultRegistry) {
  const server = new McpServer(
    {
      name: 'docsvault',
      version: '0.2.0',
    },
    {
      instructions: buildInstructions(vaultRegistry),
    }
  );

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
    // Transport und Server beim Verbindungsabbruch aufräumen, sonst bleiben
    // sie samt Listenern hängen (Leak über viele Verbindungen).
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
