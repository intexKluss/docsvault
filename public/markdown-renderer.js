var SANITIZE_OPTIONS = {
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|#|\/|\.\/|\.\.\/)/i,
  FORBID_TAGS: ['svg', 'math', 'form', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['style'],
  ADD_ATTR: ['target', 'rel'],
};

export function renderMarkdown(markdown, markedParser, sanitizer) {
  var renderer = new markedParser.Renderer();
  renderer.html = function (rawHtml) {
    return escapeHtml(getRawHtml(rawHtml));
  };

  var html = markedParser.parse(markdown, { renderer: renderer });
  return sanitizer.sanitize(html, SANITIZE_OPTIONS);
}

function getRawHtml(token) {
  if (typeof token === 'string') return token;
  if (!token) return '';
  if (typeof token.text === 'string') return token.text;
  if (typeof token.raw === 'string') return token.raw;
  return '';
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
