import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/vault-registry.js';

describe('slugify', () => {
  const cases = [
    ['otris', 'otris'],
    ['Intex Regeln', 'intex_regeln'],
    ['API v2.0', 'api_v2_0'],
    ['Kunden-Projekte', 'kunden_projekte'],
    ['---abc---', 'abc'],
    ['MixedCASE', 'mixedcase'],
    ['multiple   spaces', 'multiple_spaces'],
    ['with.dots.everywhere', 'with_dots_everywhere'],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" -> "${expected}"`, () => {
      assert.equal(slugify(input), expected);
    });
  }
});
