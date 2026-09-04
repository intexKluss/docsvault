import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../src/mcp-handler.js';
import { createTempVaultsRoot } from './helpers/temp-vault.js';

var REGISTRY = [
  { name: 'otris', description: 'otris Docs', toolPrefix: 'otris', technicalSection: 'Scripting/TERAS API', path: '/tmp/otris' },
  { name: 'Intex Regeln', description: 'Firmenregeln', toolPrefix: 'intex_regeln', path: '/tmp/intex' },
];
var LONG_TOC_HEADING = 'Eine außergewöhnlich lange Überschrift die im finalen MCP-Text niemals abgeschnitten werden darf';
var mcpVault = createTempVaultsRoot({
  otris: {
    files: {
      'general/Other.md': '# Other\n\nMCP general documentation.',
      'long/Read.md': '---\ntitle: Ein außergewöhnlich langer MCP-Titel für das harte Antwortbudget\nsource: https://example.com/eine/außergewöhnlich/lange/source/unter/engem/budget\n---\n# Read\n\n## ' + LONG_TOC_HEADING + '\n\n' + 'Inhalt '.repeat(100) + '\n\n## Zwei\n\nInhalt.\n\n## Drei\n\nInhalt.\n\n## Vier\n\nInhalt.\n\n## Fünf\n\nInhalt.',
    },
  },
});
var MCP_VAULT_ROOT = mcpVault.root;
after(mcpVault.cleanup);

describe('MCP Handler', () => {
  it('accepts a vault registry', () => {
    var server = createMcpServer(REGISTRY);
    assert.ok(server);
    assert.ok(typeof server.tool === 'function');
  });

  it('registers the separate technical search only for configured vaults', () => {
    var server = createMcpServer(REGISTRY);
    var tools = server._registeredTools || {};
    var names = Object.keys(tools);
    var prefixes = ['otris', 'intex_regeln'];
    var suffixes = ['search', 'read', 'list', 'overview', 'status'];

    for (var prefixIndex = 0; prefixIndex < prefixes.length; prefixIndex++) {
      for (var suffixIndex = 0; suffixIndex < suffixes.length; suffixIndex++) {
        var toolName = `${prefixes[prefixIndex]}_${suffixes[suffixIndex]}`;
        assert.ok(names.includes(toolName), `missing ${toolName}`);
      }
    }
    assert.ok(names.includes('otris_technical_search'));
    assert.ok(!names.includes('intex_regeln_technical_search'));
    assert.equal(names.length, 11);
  });

  it('derives technical search from a vault technicalSection', () => {
    var registry = [
      { name: 'API Reference', description: 'API Docs', toolPrefix: 'api_reference', technicalSection: 'Reference/API', path: '/tmp/api-reference' },
      { name: 'otris', description: 'otris Docs', toolPrefix: 'otris', path: '/tmp/otris' },
    ];
    var server = createMcpServer(registry);
    var tools = server._registeredTools || {};

    assert.ok(tools.api_reference_technical_search);
    assert.ok(!tools.otris_technical_search);
    assert.equal(Object.keys(tools).length, 11);
  });

  it('searches only the configured technical section', async () => {
    var vaultPath = `${MCP_VAULT_ROOT}/otris`;
    var server = createMcpServer([
      { name: 'API Reference', description: 'API Docs', toolPrefix: 'api_reference', technicalSection: 'long', path: vaultPath },
    ]);
    var result = await server._registeredTools.api_reference_technical_search.handler({ query: 'MCP' });
    var hits = JSON.parse(result.content[0].text);

    assert.equal(hits.length, 1);
    assert.equal(hits[0].file, 'long/Read');
  });

  it('includes vault description in tool description', () => {
    var server = createMcpServer(REGISTRY);
    var tools = server._registeredTools || {};
    assert.ok(tools.otris_search.description.includes('otris Docs'));
    assert.ok(tools.intex_regeln_search.description.includes('Firmenregeln'));
  });

  it('handles empty registry', () => {
    var server = createMcpServer([]);
    assert.ok(server);
    assert.equal(Object.keys(server._registeredTools || {}).length, 0);
  });

  it('search description documents the file -> read chaining contract', () => {
    var server = createMcpServer(REGISTRY);
    var description = server._registeredTools.otris_search.description || '';
    assert.match(description, /file/);
    assert.match(description, /headings/);
    assert.match(description, /otris_read/);
  });

  it('keeps all tool descriptions of one vault under 300 tokens', () => {
    var server = createMcpServer(REGISTRY);
    var tools = server._registeredTools || {};
    var names = Object.keys(tools);
    var chars = 0;
    for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
      var name = names[nameIndex];
      if (!name.startsWith('otris_')) continue;
      var tool = tools[name];
      chars += (tool.description || '').length;
      var shape = tool.inputSchema && tool.inputSchema.shape;
      if (!shape) continue;
      var fields = Object.keys(shape);
      for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
        chars += (shape[fields[fieldIndex]].description || '').length;
      }
    }
    assert.ok(Math.round(chars / 4) < 300, `tool descriptions zu groß: ~${Math.round(chars / 4)} tokens`);
  });

  it('overview description explains the overview -> search -> read flow', () => {
    var server = createMcpServer(REGISTRY);
    var description = server._registeredTools.otris_overview.description || '';
    assert.match(description, /otris_search/);
    assert.match(description, /otris_read/);
  });

  it('read accepts an optional heading param and bounds max_length', () => {
    var server = createMcpServer(REGISTRY);
    var schema = server._registeredTools.otris_read.inputSchema;
    assert.ok(schema, 'read tool should have an input schema');
    assert.ok(schema.safeParse({ path: 'a/b' }).success);
    assert.ok(schema.safeParse({ path: 'a/b', heading: 'Intro' }).success);
    assert.ok(schema.safeParse({ path: 'a/b', max_length: 25000 }).success);
    assert.ok(!schema.safeParse({ path: 'a/b', max_length: 25001 }).success);
    assert.ok(!schema.safeParse({ path: 'a/b', max_length: 0 }).success);
  });

  it('search bounds max_results and context_lines', () => {
    var server = createMcpServer(REGISTRY);
    var schema = server._registeredTools.otris_search.inputSchema;
    assert.ok(schema, 'search tool should have an input schema');
    assert.ok(schema.safeParse({ query: 'x' }).success);
    assert.ok(schema.safeParse({ query: 'x', max_results: 100, context_lines: 20 }).success);
    assert.ok(!schema.safeParse({ query: 'x', max_results: 101 }).success);
    assert.ok(!schema.safeParse({ query: 'x', max_results: 0 }).success);
    assert.ok(!schema.safeParse({ query: 'x', context_lines: 21 }).success);
    assert.ok(!schema.safeParse({ query: 'x', context_lines: -1 }).success);
  });

  it('search accepts response_format and max_tokens', () => {
    var server = createMcpServer(REGISTRY);
    var schema = server._registeredTools.otris_search.inputSchema;
    assert.ok(schema.safeParse({ query: 'x', response_format: 'concise' }).success);
    assert.ok(schema.safeParse({ query: 'x', response_format: 'detailed' }).success);
    assert.ok(!schema.safeParse({ query: 'x', response_format: 'verbose' }).success);
    assert.ok(schema.safeParse({ query: 'x', max_tokens: 500 }).success);
    assert.ok(!schema.safeParse({ query: 'x', max_tokens: 10 }).success);
  });

  it('read accepts max_tokens', () => {
    var server = createMcpServer(REGISTRY);
    var schema = server._registeredTools.otris_read.inputSchema;
    assert.ok(schema.safeParse({ path: 'a/b', max_tokens: 500 }).success);
  });

  it('caps the final read text including title and source at max_tokens', async () => {
    var vaultPath = `${MCP_VAULT_ROOT}/otris`;
    var server = createMcpServer([{ name: 'otris', description: 'otris Docs', toolPrefix: 'otris', path: vaultPath }]);
    var result = await server._registeredTools.otris_read.handler({ path: 'long/Read', max_tokens: 50 });
    var text = result.content[0].text;
    assert.ok(text.length <= 50 * 4, `budget verletzt: ${text.length} > ${50 * 4}`);
    assert.ok(text.includes(LONG_TOC_HEADING), 'TOC-Heading darf nicht abgeschnitten werden');
  });

  it('limits MCP reads to 25000 characters', () => {
    var server = createMcpServer(REGISTRY);
    var schema = server._registeredTools.otris_read.inputSchema;
    assert.ok(schema.safeParse({ path: 'a/b', max_length: 25000 }).success);
    assert.ok(!schema.safeParse({ path: 'a/b', max_length: 25001 }).success);
  });

  it('list accepts max_results', () => {
    var server = createMcpServer(REGISTRY);
    var schema = server._registeredTools.otris_list.inputSchema;
    assert.ok(schema.safeParse({ section: 'a', max_results: 10 }).success);
    assert.ok(!schema.safeParse({ section: 'a', max_results: 501 }).success);
  });

  describe('instructions', () => {
    it('carries the research method once per server', () => {
      var server = createMcpServer(REGISTRY);
      var text = server.server.instructions || server.server._instructions;
      assert.match(text, /Never guess or construct a path/i);
      assert.match(text, /search again/i);
      assert.match(text, /Check every relevant type/i);
      assert.match(text, /_overview.+_search.+_read/s);
    });

    it('embeds the vault-specific searchHint when present', () => {
      var server = createMcpServer([
        { name: 'otris', description: 'otris Docs', toolPrefix: 'otris', searchHint: 'Check All Properties first.', path: '/tmp/otris' },
      ]);
      var text = server.server.instructions || server.server._instructions;
      assert.ok(text.includes('Check All Properties first.'));
      assert.ok(text.includes('otris_*'));
    });

    it('omits vault guidance when no searchHint', () => {
      var server = createMcpServer(REGISTRY);
      var text = server.server.instructions || server.server._instructions;
      assert.ok(!text.includes('Check All Properties first.'));
    });

    it('is reachable through the server options', () => {
      var server = createMcpServer(REGISTRY);
      assert.ok(server.server.instructions || server.server._instructions);
    });
  });
});
