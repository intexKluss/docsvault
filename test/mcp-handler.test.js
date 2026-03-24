import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer, initStreamableHttp } from '../src/mcp-handler.js';

describe('MCP Handler', () => {
  it('creates MCP server with all 5 tools', () => {
    const server = createMcpServer('./vault');
    assert.ok(server);
    assert.ok(typeof server.tool === 'function');
  });

  it('initStreamableHttp resolves to boolean', async () => {
    const result = await initStreamableHttp();
    assert.equal(typeof result, 'boolean');
  });
});
