# MCP Server Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a remote MCP endpoint (SSE + Streamable HTTP) to the Express server so external coding agents can query the otris docs vault over the network, plus Dockerize the whole thing.

**Architecture:** The existing Express server gets new routes (`/sse`, `/messages`, `/mcp`) that expose the 5 otris-docs tools over MCP network transports. Tool handler functions are imported from the `otris-docs-mcp` package (added as file dependency). The vault (Markdown files) is copied into the repo and baked into the Docker image.

**Tech Stack:** Express, `@modelcontextprotocol/sdk` (McpServer, SSEServerTransport, StreamableHTTPServerTransport), `otris-docs-mcp` (tool handlers + vault reader), Docker

**Spec:** `docs/superpowers/specs/2026-03-24-mcp-server-deployment-design.md`

---

## File Structure

```
NEW FILES:
  src/mcp-handler.js         MCP server factory + Express route handlers
  Dockerfile                  Single-stage Node 20 image
  .dockerignore               Excludes .git, node_modules, docs, test
  .gitattributes              Mark vault as linguist-generated
  test/mcp-handler.test.js    Tests for MCP handler

MODIFIED FILES:
  src/server.js               Add /sse, /messages, /mcp routes
  src/claude-bridge.js        Update MCP command path to node_modules/.bin/
  .mcp.json                   Update MCP command path for Codex bridge
  package.json                Add dependencies

COPIED:
  vault/                      Entire vault directory from otris-docs-mcp (995 MD files)
```

**Key decisions:**
- `otris-docs-mcp` added as file dependency (`"file:../otris-docs-mcp"`). This gives us both the CLI binary (for bridges) and importable tool handlers (for MCP endpoint).
- For Docker: the Dockerfile copies the otris-docs-mcp source into the image before npm install, then references it as file dependency.
- The 5 tool handlers (`handleOverview`, `handleSearch`, `handleRead`, `handleList`, `handleStatus`) are imported from `otris-docs-mcp/src/server/tools/` — NOT reimplemented. This ensures the remote MCP endpoint returns identical results to the stdio MCP.

---

### Task 1: Add dependencies to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add new dependencies**

Add to `dependencies` in `package.json`:
```json
"otris-docs-mcp": "file:../otris-docs-mcp",
"@modelcontextprotocol/sdk": "^1.27.0",
"zod": "^3.23.0"
```

The `file:` dependency means npm creates a symlink in node_modules. This works for local dev. For Docker, see Task 7.

- [ ] **Step 2: Run npm install**

Run: `cd /Users/manu/Desktop/coding/arbeit/otris-docs-web && npm install`
Expected: All 3 new packages install. `node_modules/.bin/otris-docs-mcp` exists.

- [ ] **Step 3: Verify binary exists**

Run: `ls -la node_modules/.bin/otris-docs-mcp`
Expected: Symlink to otris-docs-mcp bin.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add otris-docs-mcp, MCP SDK, and zod dependencies"
```

---

### Task 2: Copy vault into repo

**Files:**
- Create: `vault/` (entire directory from otris-docs-mcp)
- Create: `.gitattributes`

- [ ] **Step 1: Copy vault**

```bash
cp -r /Users/manu/Desktop/coding/arbeit/otris-docs-mcp/vault /Users/manu/Desktop/coding/arbeit/otris-docs-web/vault
```

- [ ] **Step 2: Create .gitattributes**

```
vault/** linguist-generated
```

- [ ] **Step 3: Verify vault contents**

Run: `ls vault/ | head -10`
Expected: Section folders like `portalscript-api/`, `howtos/`, etc.

- [ ] **Step 4: Commit**

```bash
git add vault/ .gitattributes
git commit -m "Add documentation vault (995 pages)"
```

---

### Task 3: Create mcp-handler.js

**Files:**
- Create: `src/mcp-handler.js`

This file creates an `McpServer`, registers the 5 tools using the handler functions from `otris-docs-mcp`, and exports route handlers for Express.

- [ ] **Step 1: Create src/mcp-handler.js**

```javascript
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

// Import tool handlers from otris-docs-mcp (file dependency)
import { handleOverview } from 'otris-docs-mcp/src/server/tools/overview.mjs';
import { handleSearch } from 'otris-docs-mcp/src/server/tools/search.mjs';
import { handleRead } from 'otris-docs-mcp/src/server/tools/read.mjs';
import { handleList } from 'otris-docs-mcp/src/server/tools/list.mjs';
import { handleStatus } from 'otris-docs-mcp/src/server/tools/status.mjs';

export function createMcpServer(vaultPath) {
  const server = new McpServer({
    name: 'otris-docs',
    version: '0.1.0',
  });

  // Tool registrations copied from otris-docs-mcp/src/server/index.mjs
  // Uses the SAME handler functions to ensure identical behavior

  server.tool(
    'otris_overview',
    'Get an overview of the otris DOCUMENTS documentation vault. Without parameters, returns a compact summary. With a section parameter, returns a detailed listing.',
    {
      section: z.string().optional().describe('Section name to get detailed listing for'),
    },
    async (params) => {
      const result = handleOverview(vaultPath, params);
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'otris_search',
    'Full-text search across the otris DOCUMENTS documentation. Returns matching files with context lines.',
    {
      query: z.string().describe('Search query (case-insensitive)'),
      section: z.string().optional().describe('Limit search to a specific section'),
      max_results: z.number().optional().describe('Maximum number of results (default: 10)'),
      context_lines: z.number().optional().describe('Context lines around each match (default: 3)'),
    },
    async (params) => {
      const results = handleSearch(vaultPath, params);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    'otris_read',
    'Read the full content of a specific documentation page. Returns title, source URL, and markdown content.',
    {
      path: z.string().describe('Document path relative to vault root, without .md extension'),
      max_length: z.number().optional().describe('Maximum content length in characters (default: 50000)'),
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
      if (result.truncated) text += '\n\n--- Content truncated ---';
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'otris_list',
    'List all documentation pages in a section or subfolder.',
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
    'otris_status',
    'Check the status of the local documentation vault. Returns freshness, page count, and update recommendation.',
    {},
    async () => {
      const result = handleStatus(vaultPath);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}

// --- SSE Transport (deprecated but widely supported) ---

const sseSessions = new Map();

export function handleSseGet(req, res, vaultPath) {
  const server = createMcpServer(vaultPath);
  const transport = new SSEServerTransport('/messages', res);
  sseSessions.set(transport.sessionId, { server, transport });

  transport.onclose = () => {
    sseSessions.delete(transport.sessionId);
  };

  server.connect(transport);
  console.log(`[mcp] SSE session ${transport.sessionId} connected`);
}

export function handleSsePost(req, res) {
  const sessionId = req.query.sessionId;
  const session = sseSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  session.transport.handlePostMessage(req, res, req.body);
}

// --- Streamable HTTP Transport (newer) ---

let StreamableHTTPTransport = null;

export async function initStreamableHttp() {
  try {
    const mod = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    StreamableHTTPTransport = mod.StreamableHTTPServerTransport;
    console.log('[mcp] Streamable HTTP transport available');
    return true;
  } catch {
    console.log('[mcp] Streamable HTTP transport not available, SSE only');
    return false;
  }
}

export async function handleStreamablePost(req, res, vaultPath) {
  if (!StreamableHTTPTransport) {
    res.status(501).json({ error: 'Streamable HTTP not available' });
    return;
  }
  const server = createMcpServer(vaultPath);
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
```

- [ ] **Step 2: Verify imports work**

Run: `node -e "import('./src/mcp-handler.js').then(() => console.log('OK'))"`
Expected: "OK" (no import errors)

- [ ] **Step 3: Commit**

```bash
git add src/mcp-handler.js
git commit -m "Add MCP handler with 5 tools for remote access"
```

---

### Task 4: Write tests for mcp-handler

**Files:**
- Create: `test/mcp-handler.test.js`

- [ ] **Step 1: Write tests**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer, initStreamableHttp } from '../src/mcp-handler.js';

describe('MCP Handler', () => {
  it('creates MCP server instance', () => {
    const server = createMcpServer('./vault');
    assert.ok(server);
    assert.equal(server.server.name, 'otris-docs');
  });

  it('initStreamableHttp resolves without error', async () => {
    const result = await initStreamableHttp();
    assert.equal(typeof result, 'boolean');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `node --test test/mcp-handler.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/mcp-handler.test.js
git commit -m "Add MCP handler tests"
```

---

### Task 5: Add MCP routes to server.js

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add imports at top of server.js**

After the existing imports (line 8), add:

```javascript
import {
  handleSseGet, handleSsePost,
  handleStreamablePost, initStreamableHttp
} from './mcp-handler.js';
```

- [ ] **Step 2: Add VAULT_PATH constant**

After the `BRIDGE_MODE` constant (line 13), add:

```javascript
const VAULT_PATH = process.env.VAULT_PATH || join(__dirname, '..', 'vault');
```

- [ ] **Step 3: Initialize Streamable HTTP at server start**

Inside `createServer()`, after bridge loading (after line 34), add:

```javascript
await initStreamableHttp();
```

- [ ] **Step 4: Add MCP routes before static middleware**

After the CSP middleware (after line 54) and BEFORE `app.use(express.static(...))`, add:

```javascript
// MCP remote endpoint — SSE transport
app.get('/sse', (req, res) => {
  handleSseGet(req, res, VAULT_PATH);
});

app.post('/messages', express.json(), (req, res) => {
  handleSsePost(req, res);
});

// MCP remote endpoint — Streamable HTTP transport
app.post('/mcp', express.json(), async (req, res) => {
  await handleStreamablePost(req, res, VAULT_PATH);
});
app.get('/mcp', (req, res) => { res.writeHead(405).end(); });
app.delete('/mcp', (req, res) => { res.writeHead(405).end(); });
```

- [ ] **Step 5: Test SSE endpoint manually**

Run: `npm run dev`
Then in another terminal: `curl -N http://localhost:3000/sse`
Expected: SSE stream opens, sends an `endpoint` event with a URL containing `/messages?sessionId=...`

- [ ] **Step 6: Commit**

```bash
git add src/server.js
git commit -m "Add MCP remote endpoints (SSE + Streamable HTTP)"
```

---

### Task 6: Update bridge MCP command paths

**Files:**
- Modify: `src/claude-bridge.js`
- Modify: `.mcp.json`

The Claude bridge uses `MCP_SERVERS` in code. The Codex bridge reads `.mcp.json` from the working directory (`MCP_CWD`).

- [ ] **Step 1: Update claude-bridge.js**

Change `src/claude-bridge.js` line 34-38 from:
```javascript
const MCP_SERVERS = {
  'otris-docs': {
    command: 'otris-docs-mcp',
  }
};
```
to:
```javascript
const MCP_SERVERS = {
  'otris-docs': {
    command: join(__dirname, '..', 'node_modules', '.bin', 'otris-docs-mcp'),
  }
};
```

`join` is already imported from `node:path` (line 4).

- [ ] **Step 2: Update .mcp.json**

Change `.mcp.json` from:
```json
{ "mcpServers": { "otris-docs": { "command": "otris-docs-mcp" } } }
```
to:
```json
{ "mcpServers": { "otris-docs": { "command": "node_modules/.bin/otris-docs-mcp" } } }
```

This is used by the Codex bridge (reads MCP config from the working directory).

- [ ] **Step 3: Commit**

```bash
git add src/claude-bridge.js .mcp.json
git commit -m "Update MCP command paths to use local node_modules binary"
```

---

### Task 7: Create Dockerfile and .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
.git
node_modules
docs
test
reports.json
README.md
ARCHITECTURE.md
CLAUDE.md
```

Note: vault/ is NOT excluded — it needs to be in the image.

- [ ] **Step 2: Create Dockerfile**

The tricky part: `otris-docs-mcp` is a `file:` dependency pointing to `../otris-docs-mcp`. Inside Docker there's no sibling directory. So the Dockerfile must:
1. Copy the otris-docs-mcp source into the build context
2. Adjust the dependency path

```dockerfile
FROM node:20-slim

WORKDIR /app

# Copy otris-docs-mcp into the image (file dependency needs it)
COPY ../otris-docs-mcp /otris-docs-mcp
```

Wait — Docker can't COPY from outside the build context. Two options:

**Option A:** Change the file dependency to a git URL before building:
```json
"otris-docs-mcp": "github:user/otris-docs-mcp"
```

**Option B:** Use a build script that creates a temporary build context:
```bash
# build.sh
mkdir -p .docker-build
cp -r ../otris-docs-mcp .docker-build/otris-docs-mcp
docker build -t otris-docs .
rm -rf .docker-build
```

**Option C (simplest):** Set the Docker build context one level up:
```bash
docker build -f otris-docs-web/Dockerfile -t otris-docs ..
```

Then the Dockerfile can reference both directories:

```dockerfile
FROM node:20-slim
WORKDIR /app

# Copy otris-docs-mcp for file dependency
COPY otris-docs-mcp /otris-docs-mcp

# Copy web app
COPY otris-docs-web/package*.json ./
RUN npm ci --omit=dev
COPY otris-docs-web/src/ ./src/
COPY otris-docs-web/public/ ./public/
COPY otris-docs-web/vault/ ./vault/
COPY otris-docs-web/.mcp.json ./

EXPOSE 3000
ENV NODE_ENV=production
ENV VAULT_PATH=/app/vault
CMD ["node", "src/server.js"]
```

And in `package.json`, the file dependency path is `"file:../otris-docs-mcp"` which resolves correctly because npm ci runs in `/app` and `otris-docs-mcp` is at `/otris-docs-mcp`.

Wait, that won't work either — `file:../otris-docs-mcp` from `/app` would look at `/otris-docs-mcp` which IS correct!

- [ ] **Step 3: Test Docker build**

```bash
cd /Users/manu/Desktop/coding/arbeit
docker build -f otris-docs-web/Dockerfile -t otris-docs .
```

Expected: Build succeeds.

- [ ] **Step 4: Test Docker run**

```bash
docker run -d --name otris-docs-test -p 3001:3000 -e ALLOW_NO_ORIGIN=true -e ALLOWED_ORIGINS=http://localhost:3001 otris-docs
curl http://localhost:3001/
curl -N http://localhost:3001/sse
docker stop otris-docs-test && docker rm otris-docs-test
```

Expected: HTML served, SSE endpoint responds.

Note: `ALLOW_NO_ORIGIN=true` is needed in Docker because there's no browser origin in the container context. It affects the WebSocket chat endpoint only, not the MCP endpoints (which use HTTP, not WebSocket).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "Add Dockerfile for single-container deployment"
```

---

### Task 8: Update help page with MCP agent setup

**Files:**
- Modify: files in `public/help/`

- [ ] **Step 1: Read current help page structure**

Check `public/help/` to understand the existing structure (markdown chapters, HTML, etc.).

- [ ] **Step 2: Add MCP agent setup section**

Add a new chapter/section explaining how to connect a coding agent to the MCP endpoint:

**Title:** "MCP mit deinem Coding-Agent nutzen"

**Content:**
- What it does (access to otris docs search, read, list from your agent)
- Config for Claude Code (add to `.claude/settings.json` or project `.mcp.json`):
  ```json
  {
    "mcpServers": {
      "otris-docs": {
        "url": "http://<SERVER-IP>:3000/sse"
      }
    }
  }
  ```
- Config for Codex CLI (add to `codex.json`):
  ```json
  {
    "mcpServers": {
      "otris-docs": {
        "url": "http://<SERVER-IP>:3000/sse"
      }
    }
  }
  ```
- Replace `<SERVER-IP>` with actual LAN IP
- Available tools: otris_search, otris_read, otris_list, otris_overview, otris_status

- [ ] **Step 3: Commit**

```bash
git add public/help/
git commit -m "Add MCP agent setup instructions to help page"
```

---

### Task 9: Integration test

- [ ] **Step 1: Test local dev server**

```bash
npm run dev
```

Checklist:
1. `http://localhost:3000/` — Web UI loads
2. `curl -N http://localhost:3000/sse` — SSE stream opens
3. `curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test"}},"id":1}'` — Returns MCP init response

- [ ] **Step 2: Test Docker build and run**

```bash
cd /Users/manu/Desktop/coding/arbeit
docker build -f otris-docs-web/Dockerfile -t otris-docs .
docker run -d --name otris-docs-test -p 3001:3000 -e ALLOW_NO_ORIGIN=true -e ALLOWED_ORIGINS=http://localhost:3001 otris-docs
curl http://localhost:3001/
curl -N http://localhost:3001/sse
docker stop otris-docs-test && docker rm otris-docs-test
```

- [ ] **Step 3: Fix any issues and commit**

```bash
git add -A
git commit -m "Fix integration issues"
```

---

### Task 10: Update spec with final endpoint paths

**Files:**
- Modify: `docs/superpowers/specs/2026-03-24-mcp-server-deployment-design.md`

- [ ] **Step 1: Update spec routes to match implementation**

- `GET /sse` — SSE transport (unchanged)
- `POST /messages` — SSE message handler (was `/message` in spec)
- `POST /mcp` — Streamable HTTP (new, wasn't explicitly in spec)

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "Update spec with final endpoint paths"
```
