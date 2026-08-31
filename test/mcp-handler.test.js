import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer, buildInstructions } from '../src/mcp-handler.js';

// grobe Token-Schaetzung, ~4 Zeichen pro Token
const tokens = (text) => Math.round(String(text).length / 4);

const REGISTRY = [
  { name: 'otris',       description: 'otris Docs',   toolPrefix: 'otris',        path: '/tmp/otris' },
  { name: 'Intex Regeln',description: 'Firmenregeln', toolPrefix: 'intex_regeln', path: '/tmp/intex' },
];

describe('MCP Handler', () => {
  it('accepts a vault registry', () => {
    const server = createMcpServer(REGISTRY);
    assert.ok(server);
    assert.ok(typeof server.tool === 'function');
  });

  it('registers 5 tools per vault', () => {
    // MCP server exposes registered tools via _registeredTools or listTools
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    const names = Object.keys(tools);

    for (const prefix of ['otris', 'intex_regeln']) {
      for (const suffix of ['search', 'read', 'list', 'overview', 'status']) {
        assert.ok(names.includes(`${prefix}_${suffix}`), `missing ${prefix}_${suffix}`);
      }
    }
    assert.equal(names.length, 10);
  });

  it('includes vault description in tool description', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    assert.ok(tools['otris_search']?.description?.includes('otris Docs'));
    assert.ok(tools['intex_regeln_search']?.description?.includes('Firmenregeln'));
  });

  it('handles empty registry', () => {
    const server = createMcpServer([]);
    assert.ok(server);
    const tools = server._registeredTools || {};
    assert.equal(Object.keys(tools).length, 0);
  });

  it('search description documents the file -> read chaining contract', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    const desc = tools['otris_search']?.description || '';
    assert.match(desc, /file/);
    assert.match(desc, /headings/);
    assert.match(desc, /otris_read/);
  });

  // Tool-Beschreibungen liegen dauerhaft im Kontext, einmal pro Vault.
  it('keeps all tool descriptions of one vault under 300 tokens', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    let chars = 0;
    for (const [name, tool] of Object.entries(tools)) {
      if (!name.startsWith('otris_')) continue;
      chars += (tool.description || '').length;
      for (const field of Object.values(tool.inputSchema?.shape || {})) {
        chars += (field.description || '').length;
      }
    }
    assert.ok(Math.round(chars / 4) < 300, `tool descriptions zu gross: ~${Math.round(chars / 4)} tokens`);
  });

  it('overview description explains the overview -> search -> read flow', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    const desc = tools['otris_overview']?.description || '';
    assert.match(desc, /otris_search/);
    assert.match(desc, /otris_read/);
  });

  it('read accepts an optional heading param and bounds max_length', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    const schema = tools['otris_read']?.inputSchema;
    assert.ok(schema, 'read tool should have an input schema');

    // heading ist optional und additiv
    assert.ok(schema.safeParse({ path: 'a/b' }).success);
    assert.ok(schema.safeParse({ path: 'a/b', heading: 'Intro' }).success);

    // max_length ist nach oben gedeckelt
    assert.ok(schema.safeParse({ path: 'a/b', max_length: 50000 }).success);
    assert.ok(!schema.safeParse({ path: 'a/b', max_length: 999999 }).success);
    assert.ok(!schema.safeParse({ path: 'a/b', max_length: 0 }).success);
  });

  it('search bounds max_results and context_lines', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    const schema = tools['otris_search']?.inputSchema;
    assert.ok(schema, 'search tool should have an input schema');

    assert.ok(schema.safeParse({ query: 'x' }).success);
    assert.ok(schema.safeParse({ query: 'x', max_results: 100, context_lines: 20 }).success);

    assert.ok(!schema.safeParse({ query: 'x', max_results: 101 }).success);
    assert.ok(!schema.safeParse({ query: 'x', max_results: 0 }).success);
    assert.ok(!schema.safeParse({ query: 'x', context_lines: 21 }).success);
    assert.ok(!schema.safeParse({ query: 'x', context_lines: -1 }).success);
  });

  it('search accepts response_format and max_tokens', () => {
    const server = createMcpServer(REGISTRY);
    const schema = (server._registeredTools || {})['otris_search']?.inputSchema;
    assert.ok(schema.safeParse({ query: 'x', response_format: 'concise' }).success);
    assert.ok(schema.safeParse({ query: 'x', response_format: 'detailed' }).success);
    assert.ok(!schema.safeParse({ query: 'x', response_format: 'verbose' }).success);
    assert.ok(schema.safeParse({ query: 'x', max_tokens: 500 }).success);
    assert.ok(!schema.safeParse({ query: 'x', max_tokens: 10 }).success);
  });

  it('read accepts max_tokens', () => {
    const server = createMcpServer(REGISTRY);
    const schema = (server._registeredTools || {})['otris_read']?.inputSchema;
    assert.ok(schema.safeParse({ path: 'a/b', max_tokens: 500 }).success);
  });

  it('list accepts max_results', () => {
    const server = createMcpServer(REGISTRY);
    const schema = (server._registeredTools || {})['otris_list']?.inputSchema;
    assert.ok(schema.safeParse({ section: 'a', max_results: 10 }).success);
    assert.ok(!schema.safeParse({ section: 'a', max_results: 501 }).success);
  });

  // Die Methodik gehört einmal pro Server in die instructions, nicht in jede
  // Tool-Beschreibung.
  describe('instructions', () => {
    it('carries the research method once per server', () => {
      const text = buildInstructions(REGISTRY);
      assert.match(text, /Never guess or construct a path/i);
      assert.match(text, /search again/i);
      assert.match(text, /Check every relevant type/i);
      assert.match(text, /_overview.+_search.+_read/s);
    });

    it('embeds the vault-specific searchHint when present', () => {
      const text = buildInstructions([
        { name: 'otris', description: 'otris Docs', toolPrefix: 'otris', searchHint: 'Check All Properties first.', path: '/tmp/otris' },
      ]);
      assert.ok(text.includes('Check All Properties first.'));
      assert.ok(text.includes('otris_*'));
    });

    it('omits vault guidance when no searchHint', () => {
      const text = buildInstructions(REGISTRY);
      assert.ok(!text.includes('Check All Properties first.'));
    });

    it('is reachable through the server options', () => {
      const server = createMcpServer(REGISTRY);
      assert.ok(server.server.instructions || server.server._instructions);
    });
  });
});
