import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('mcp-stdio startup', () => {
  it('warms every search index before connecting the transport', () => {
    var script = `
      import { mock } from 'node:test';
      var order = [];
      await mock.module('@modelcontextprotocol/sdk/server/stdio.js', {
        namedExports: { StdioServerTransport: class {} },
      });
      await mock.module('./src/vault-registry.js', {
        namedExports: {
          loadVaultRegistry: function () {
            return [{ toolPrefix: 'docs', path: '/tmp/docs' }];
          },
        },
      });
      await mock.module('./src/tools/vault-cache.js', {
        namedExports: {
          warmSearchIndex: function () {
            order.push('warm');
            return null;
          },
        },
      });
      await mock.module('./src/mcp-handler.js', {
        namedExports: {
          createMcpServer: function () {
            return {
              async connect() {
                order.push('connect');
              },
            };
          },
        },
      });
      await import('./src/mcp-stdio.js');
      process.stdout.write(JSON.stringify(order));
    `;
    var output = execFileSync(process.execPath, [
      '--experimental-test-module-mocks',
      '--input-type=module',
      '--eval',
      script,
    ], { cwd: process.cwd(), encoding: 'utf-8' });

    assert.deepEqual(JSON.parse(output), ['warm', 'connect']);
  });
});
