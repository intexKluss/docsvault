import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedTools } from '../src/claude-bridge.js';

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
});
