import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeBridge, getAllowedTools } from '../src/claude-bridge.js';

describe('ClaudeBridge tool whitelist', () => {
  it('derives technical search from each vault technicalSection', () => {
    var allowedTools = getAllowedTools([
      { toolPrefix: 'api_reference', technicalSection: 'Reference/API' },
      { toolPrefix: 'otris' },
    ]);

    assert.ok(allowedTools.includes('mcp__docsvault__api_reference_technical_search'));
    assert.ok(!allowedTools.includes('mcp__docsvault__otris_technical_search'));
    assert.ok(allowedTools.includes('mcp__docsvault__api_reference_search'));
    assert.ok(allowedTools.includes('mcp__docsvault__otris_search'));
  });

  it('passes vault-specific allowed tools to the query callback during warmup', async () => {
    var queryInput;
    var bridge = new ClaudeBridge([
      { toolPrefix: 'api_reference', technicalSection: 'Reference/API' },
      { toolPrefix: 'otris' },
    ], function (input) {
      queryInput = input;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test-session' };
      })();
    });
    var session = await bridge.createSession();
    await session.warmUp();

    assert.ok(queryInput.options.allowedTools.includes('mcp__docsvault__api_reference_technical_search'));
    assert.ok(!queryInput.options.allowedTools.includes('mcp__docsvault__otris_technical_search'));
    assert.ok(queryInput.options.allowedTools.includes('mcp__docsvault__api_reference_search'));
    assert.ok(queryInput.options.allowedTools.includes('mcp__docsvault__otris_search'));
  });
});
