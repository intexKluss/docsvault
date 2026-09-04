import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('ClaudeBridge tool whitelist', () => {
  it('derives technical search from each vault technicalSection', () => {
    var script = `
      import { mock } from 'node:test';
      var captured;
      console.log = function () {};
      await mock.module('@anthropic-ai/claude-agent-sdk', {
        namedExports: {
          query: function (input) {
            captured = input.options.allowedTools;
            return (async function* () {
              yield { type: 'system', subtype: 'init', session_id: 'test-session' };
            })();
          },
        },
      });
      var module = await import('./src/claude-bridge.js');
      var bridge = new module.ClaudeBridge([
        { toolPrefix: 'api_reference', technicalSection: 'Reference/API' },
        { toolPrefix: 'otris' },
      ]);
      var session = await bridge.createSession();
      await session.warmUp();
      process.stdout.write(JSON.stringify(captured));
    `;
    var output = execFileSync(process.execPath, [
      '--experimental-test-module-mocks',
      '--input-type=module',
      '--eval',
      script,
    ], { cwd: process.cwd(), encoding: 'utf-8' });
    var allowedTools = JSON.parse(output);

    assert.ok(allowedTools.includes('mcp__docsvault__api_reference_technical_search'));
    assert.ok(!allowedTools.includes('mcp__docsvault__otris_technical_search'));
    assert.ok(allowedTools.includes('mcp__docsvault__api_reference_search'));
    assert.ok(allowedTools.includes('mcp__docsvault__otris_search'));
  });
});
