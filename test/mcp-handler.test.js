import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../src/mcp-handler.js';

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
    assert.match(desc, /"file"/);
    assert.match(desc, /otris_read/);
    assert.match(desc, /titleMatch/);
    assert.match(desc, /score/);
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

  it('search description includes the multi-source search strategy', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    const desc = tools['otris_search']?.description || '';
    assert.match(desc, /do not stop at the first hit/i);
    assert.match(desc, /search again/i);
    assert.match(desc, /check more than one/i);
  });

  it('overview description tells agents to check multiple section types', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    const desc = tools['otris_overview']?.description || '';
    assert.match(desc, /different section types/i);
    assert.match(desc, /not just one/i);
  });

  it('search description embeds the vault-specific searchHint when present', () => {
    const withHint = [
      { name: 'otris', description: 'otris Docs', toolPrefix: 'otris', searchHint: 'Check All Properties first.', path: '/tmp/otris' },
    ];
    const server = createMcpServer(withHint);
    const tools = server._registeredTools || {};
    const desc = tools['otris_search']?.description || '';
    assert.match(desc, /Guidance for this vault:/);
    assert.ok(desc.includes('Check All Properties first.'));
  });

  it('search description omits vault guidance when no searchHint', () => {
    const server = createMcpServer(REGISTRY);
    const tools = server._registeredTools || {};
    const desc = tools['otris_search']?.description || '';
    assert.ok(!desc.includes('Guidance for this vault:'));
  });
});
