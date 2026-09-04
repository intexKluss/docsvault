import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startMcpStdio } from '../src/mcp-stdio.js';

describe('mcp-stdio startup', () => {
  it('warms every search index before connecting the transport', async () => {
    var order = [];
    await startMcpStdio({
      loadVaultRegistry: function () {
        return [{ toolPrefix: 'docs', path: '/tmp/docs' }];
      },
      warmSearchIndex: function () {
        order.push('warm');
        return null;
      },
      createMcpServer: function () {
        return {
          async connect() {
            order.push('connect');
          },
        };
      },
      StdioServerTransport: class {},
    });

    assert.deepEqual(order, ['warm', 'connect']);
  });
});
