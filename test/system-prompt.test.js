import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/system-prompt.js';

var REGISTRY = [
  { name: 'otris DOCUMENTS API', description: 'otris Doku.',      toolPrefix: 'otris',        path: '/x' },
  { name: 'Intex Regeln',        description: 'Firmenrichtlinien.', toolPrefix: 'intex_regeln', path: '/y' },
];

describe('buildSystemPrompt', function () {
  it('returns non-empty string with safety rules', function () {
    var prompt = buildSystemPrompt(REGISTRY);
    assert.ok(prompt.length > 200);
    assert.ok(prompt.includes('Ignoriere'));
  });

  it('lists each vault name and description', function () {
    var prompt = buildSystemPrompt(REGISTRY);
    assert.ok(prompt.includes('otris DOCUMENTS API'));
    assert.ok(prompt.includes('Intex Regeln'));
    assert.ok(prompt.includes('Firmenrichtlinien.'));
  });

  it('lists tool names per vault', function () {
    var prompt = buildSystemPrompt(REGISTRY);
    assert.ok(prompt.includes('otris_search'));
    assert.ok(prompt.includes('intex_regeln_search'));
  });

  it('handles empty registry gracefully (no tools mentioned)', function () {
    var prompt = buildSystemPrompt([]);
    assert.ok(prompt.length > 0);
    assert.ok(!prompt.includes('_search'));
  });
});

it('does not impose a gadget template on vault answers', function () {
  var prompt = buildSystemPrompt(REGISTRY);
  assert.doesNotMatch(prompt, /GADGET_GUIDANCE|GRUNDGERÜST|gadgetAPI|gadgetContext|Konstruktor-Aufruf/);
});

it('does not add a gadget template without vaults', function () {
  var prompt = buildSystemPrompt([]);
  assert.doesNotMatch(prompt, /GRUNDGERÜST|gadgetAPI|gadgetContext/);
});

it('uses a question-specific research protocol instead of always requesting code', function () {
  var prompt = buildSystemPrompt(REGISTRY);

  assert.match(prompt, /Definitions- und Übersichtsfragen/);
  assert.match(prompt, /Handbuch- oder Konzeptseite/);
  assert.match(prompt, /Code nur, wenn der Nutzer ausdrücklich danach fragt/);
  assert.match(prompt, /API-Referenz nur bei API- oder Umsetzungsfragen/);
  assert.doesNotMatch(prompt, /Gib Code-Beispiele wenn möglich/);
});
