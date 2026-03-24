import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer, initStreamableHttp } from '../src/mcp-handler.js';

describe('MCP Handler', () => {
  it('creates MCP server instance', () => {
    const server = createMcpServer('./vault');
    assert.ok(server);
    assert.ok(typeof server.tool === 'function');
  });

  it('initStreamableHttp resolves without error', async () => {
    const result = await initStreamableHttp();
    assert.equal(typeof result, 'boolean');
  });
});
