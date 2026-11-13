import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, buildHunks } from '../src/line-diff.js';

describe('diffLines', () => {
  it('marks only the changed line', () => {
    const ops = diffLines('a\nb\nc', 'a\nB\nc');
    assert.deepEqual(ops.map(op => op.type + op.line), [' a', '-b', '+B', ' c']);
  });

  it('handles insertions and deletions in the middle', () => {
    const ops = diffLines('a\nb\nc\nd', 'a\nc\nx\nd');
    assert.deepEqual(ops.map(op => op.type + op.line), [' a', '-b', ' c', '+x', ' d']);
  });

  it('treats an empty old text as pure additions', () => {
    const ops = diffLines('', 'a\nb');
    assert.deepEqual(ops.map(op => op.type + op.line), ['+a', '+b']);
  });

  it('ignores CRLF versus LF', () => {
    const ops = diffLines('a\r\nb', 'a\nb');
    assert.ok(ops.every(op => op.type === ' '));
  });
});

describe('buildHunks', () => {
  it('returns no lines and zero counts when nothing differs', () => {
    const result = buildHunks(diffLines('a\nb', 'a\nb'), 100);
    assert.deepEqual(result, { lines: [], additions: 0, deletions: 0, truncated: false });
  });

  it('counts changes and adds a hunk header with context', () => {
    const oldText = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8';
    const newText = 'l1\nl2\nl3\nl4\nCHANGED\nl6\nl7\nl8';
    const result = buildHunks(diffLines(oldText, newText), 100);
    assert.equal(result.additions, 1);
    assert.equal(result.deletions, 1);
    assert.equal(result.lines[0], '@@ -2 +2 @@');
    assert.ok(result.lines.includes('-l5'));
    assert.ok(result.lines.includes('+CHANGED'));
  });

  it('splits distant changes into separate hunks', () => {
    const base = [];
    for (let i = 1; i <= 30; i++) base.push('line' + i);
    const changed = base.slice();
    changed[1] = 'first';
    changed[27] = 'last';
    const result = buildHunks(diffLines(base.join('\n'), changed.join('\n')), 100);
    const headers = result.lines.filter(line => line.startsWith('@@'));
    assert.equal(headers.length, 2);
  });

  it('truncates when the line budget is exceeded', () => {
    const oldText = Array.from({ length: 100 }, (_, i) => 'old' + i).join('\n');
    const newText = Array.from({ length: 100 }, (_, i) => 'new' + i).join('\n');
    const result = buildHunks(diffLines(oldText, newText), 20);
    assert.equal(result.truncated, true);
    assert.equal(result.additions, 100);
    assert.equal(result.deletions, 100);
  });
});
