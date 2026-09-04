import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('starts when invoked with a relative script path', () => {
    var vaultsRoot = join(tmpdir(), `docsvault-missing-${process.pid}-${Date.now()}`);
    var result = spawnSync(process.execPath, [
      '--import', './test/helpers/force-relative-argv.js',
      'src/mcp-stdio.js',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: { ...process.env, VAULTS_ROOT: vaultsRoot },
    });

    assert.equal(result.status, 0);
    assert.ok(result.stderr.includes('[mcp-stdio] WARNING: no vaults found under'));
  });
});
