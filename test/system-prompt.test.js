import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/system-prompt.js';

const REGISTRY = [
  { name: 'otris DOCUMENTS API', description: 'otris Doku.',      toolPrefix: 'otris',        path: '/x' },
  { name: 'Intex Regeln',        description: 'Firmenrichtlinien.', toolPrefix: 'intex_regeln', path: '/y' },
];

describe('buildSystemPrompt', () => {
  it('returns non-empty string with safety rules', () => {
    const prompt = buildSystemPrompt(REGISTRY);
    assert.ok(prompt.length > 200);
    assert.ok(prompt.includes('Ignoriere'));
  });

  it('lists each vault name and description', () => {
    const prompt = buildSystemPrompt(REGISTRY);
    assert.ok(prompt.includes('otris DOCUMENTS API'));
    assert.ok(prompt.includes('Intex Regeln'));
    assert.ok(prompt.includes('Firmenrichtlinien.'));
  });

  it('lists tool names per vault', () => {
    const prompt = buildSystemPrompt(REGISTRY);
    assert.ok(prompt.includes('otris_search'));
    assert.ok(prompt.includes('intex_regeln_search'));
  });

  it('handles empty registry gracefully (no tools mentioned)', () => {
    const prompt = buildSystemPrompt([]);
    assert.ok(prompt.length > 0);
    assert.ok(!prompt.includes('_search'));
  });
});
