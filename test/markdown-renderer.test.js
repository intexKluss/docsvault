import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown-renderer.js';

describe('renderMarkdown', function () {
  it('renders raw placeholder tags as text instead of HTML', function () {
    var markdown = 'Lies gadgetContext.formParams.<Feldname>.';
    var html = renderMarkdown(markdown, createMarked(), createSanitizer());

    assert.equal(html, 'Lies gadgetContext.formParams.&lt;Feldname&gt;.');
  });

  it('keeps HTML syntax inside fenced code blocks unchanged', function () {
    var markdown = '```html\n<div>Inhalt</div>\n```';
    var html = renderMarkdown(markdown, createMarked(), createSanitizer());

    assert.equal(html, '<pre><code>&lt;div&gt;Inhalt&lt;/div&gt;</code></pre>');
  });
});

function createMarked() {
  return {
    Renderer: function () {},
    parse: function (markdown, options) {
      var codeBlocks = [];
      var html = markdown.replace(/```[^\n]*\n([\s\S]*?)```/g, function (_, code) {
        codeBlocks.push('<pre><code>' + escapeHtml(code.trim()) + '</code></pre>');
        return '@@CODE_BLOCK_' + (codeBlocks.length - 1) + '@@';
      });

      html = html.replace(/<[^>]+>/g, function (rawHtml) {
        return options.renderer.html(rawHtml);
      });

      return html.replace(/@@CODE_BLOCK_(\d+)@@/g, function (_, index) {
        return codeBlocks[index];
      });
    },
  };
}

function createSanitizer() {
  return { sanitize: function (html) { return html; } };
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
