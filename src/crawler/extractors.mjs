export function getContentSelector(type) {
  const selectors = {
    'typedoc': '.col-content',
    'jsdoc': 'article',
    'otris-book': '.otris-book-content',
    'properties': 'article',
    'manuals': '.otris-book-content',
  };
  return selectors[type] || 'article';
}

export function cleanMarkdown(text) {
  return text
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// page.evaluate() can't use closures, so selector is passed as arg
function buildEvaluateFn(primarySelector) {
  return function (sel) {
    const contentEl = document.querySelector(sel) ||
                      document.querySelector('.otris-book-content') ||
                      document.querySelector('article') ||
                      document.querySelector('.col-content') ||
                      document.querySelector('.container-main') ||
                      document.querySelector('main');
    if (!contentEl) return { title: document.title || '', content: '' };

    function toMarkdown(el) {
      let md = '';
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          const text = node.textContent;
          if (text.trim()) md += text;
        } else if (node.nodeType === 1) {
          const tag = node.tagName.toLowerCase();
          const cls = typeof node.className === 'string' ? node.className : '';

          if (['script', 'style', 'nav', 'svg', 'wbr', 'button'].includes(tag)) continue;
          if (cls.includes('tsd-breadcrumb')) continue;
          if (cls.includes('tsd-anchor-icon')) continue;

          // TypeDoc index list — render as bullet list
          if (cls.includes('tsd-index-list')) {
            const indexLinks = node.querySelectorAll(':scope > a');
            indexLinks.forEach(a => {
              md += '- ' + a.innerText.trim() + '\n';
            });
            md += '\n';
            continue;
          }

          // TypeDoc signature — render as code block
          if (cls.includes('tsd-signature') && tag === 'div') {
            md += '\n`' + node.innerText.trim().replace(/\n\s*/g, ' ') + '`\n\n';
            continue;
          }

          // TypeDoc member section — structured extraction
          if (cls.includes('tsd-member') && tag === 'section') {
            const h = node.querySelector(':scope > h3');
            if (h) md += '\n### ' + h.innerText.trim() + '\n\n';

            const sig = node.querySelector('.tsd-signature');
            if (sig) md += '`' + sig.innerText.trim().replace(/\n\s*/g, ' ') + '`\n\n';

            const desc = node.querySelector('.tsd-comment.tsd-typography');
            if (desc) md += desc.innerText.trim() + '\n\n';

            const params = node.querySelector('.tsd-parameters');
            if (params) {
              md += '**Parameters:**\n\n';
              const paramItems = params.querySelectorAll('.tsd-parameter-list > li');
              paramItems.forEach(li => {
                const nameEl = li.querySelector('.tsd-kind-parameter');
                const typeEl = li.querySelector('.tsd-signature-type');
                const descEl = li.querySelector('.tsd-comment');
                const name = nameEl?.innerText?.trim() || '';
                const type = typeEl?.innerText?.trim() || '';
                const pdesc = descEl?.innerText?.trim() || '';
                md += '- `' + name + '`' + (type ? ': `' + type + '`' : '') + (pdesc ? ' — ' + pdesc : '') + '\n';
              });
              md += '\n';
            }

            const retTitle = node.querySelector('.tsd-returns-title');
            if (retTitle) md += '**Returns:** ' + retTitle.innerText.replace('Returns', '').trim() + '\n\n';

            const tagDivs = node.querySelectorAll('.tsd-tag-since, .tsd-tag-see, .tsd-tag-deprecated');
            tagDivs.forEach(td => {
              const h4 = td.querySelector('h4');
              const label = h4?.innerText?.trim() || '';
              const paras = td.querySelectorAll('p');
              const value = Array.from(paras).map(p => p.innerText.trim()).join(', ');
              if (label && value) md += '**' + label + ':** ' + value + '\n\n';
            });

            const pres = node.querySelectorAll('pre');
            pres.forEach(pre => {
              const codeEl = pre.querySelector('code');
              const lang = codeEl?.className?.replace(/.*language-(\w+).*/, '$1') || codeEl?.className || 'ts';
              let code = pre.innerText.trim().replace(/\n?Copy\s*$/, '').trim();
              md += '\n```' + lang + '\n' + code + '\n```\n\n';
            });

            continue;
          }

          if (tag === 'h1') md += '\n# ' + node.innerText.trim() + '\n\n';
          else if (tag === 'h2') md += '\n## ' + node.innerText.trim() + '\n\n';
          else if (tag === 'h3') md += '\n### ' + node.innerText.trim() + '\n\n';
          else if (tag === 'h4') md += '\n#### ' + node.innerText.trim() + '\n\n';
          else if (tag === 'h5') md += '\n##### ' + node.innerText.trim() + '\n\n';

          else if (tag === 'p') md += toMarkdown(node) + '\n\n';
          else if (tag === 'pre') {
            const codeEl = node.querySelector('code');
            const lang = codeEl?.className?.replace(/.*language-(\w+).*/, '$1') || codeEl?.className || '';
            let code = node.innerText.trim();
            code = code.replace(/\n?Copy\s*$/, '').trim();
            md += '\n```' + lang + '\n' + code + '\n```\n\n';
          }
          else if (tag === 'code' && node.parentElement?.tagName?.toLowerCase() !== 'pre') {
            md += '`' + node.textContent + '`';
          }

          else if (tag === 'ul' || tag === 'ol') {
            const items = node.querySelectorAll(':scope > li');
            items.forEach((li, i) => {
              const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
              md += prefix + li.innerText.trim().replace(/\n\s+/g, ' ') + '\n';
            });
            md += '\n';
          }

          else if (tag === 'table') {
            const rows = node.querySelectorAll('tr');
            rows.forEach((row, ri) => {
              const cells = row.querySelectorAll('th, td');
              const line = '| ' + Array.from(cells).map(c => c.innerText.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ')).join(' | ') + ' |';
              md += line + '\n';
              if (ri === 0) {
                md += '| ' + Array.from(cells).map(() => '---').join(' | ') + ' |\n';
              }
            });
            md += '\n';
          }

          else if (tag === 'a') {
            const href = node.getAttribute('href') || '';
            const text = node.textContent.trim();
            if (text && href && !href.startsWith('#')) md += `[${text}](${href})`;
            else md += text;
          }

          else if (tag === 'strong' || tag === 'b') md += '**' + node.textContent.trim() + '**';
          else if (tag === 'em' || tag === 'i') md += '*' + node.textContent.trim() + '*';
          else if (tag === 'br') md += '\n';
          else if (tag === 'hr') md += '\n---\n\n';

          else if (tag === 'img') {
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || '';
            if (src) md += `![${alt}](${src})`;
          }

          // typedoc accordion sections (Properties, Methods groups)
          else if (tag === 'details') {
            const summary = node.querySelector(':scope > summary');
            if (summary) md += '\n## ' + summary.innerText.trim() + '\n\n';
            for (const child of node.children) {
              if (child.tagName.toLowerCase() !== 'summary') {
                md += toMarkdown(child);
              }
            }
          }
          else if (tag === 'summary') { /* handled by details */ }
          else if (tag === 'dt') md += '\n**' + node.innerText.trim() + '**\n';
          else if (tag === 'dd') md += toMarkdown(node) + '\n\n';

          else if (['div', 'section', 'article', 'main', 'span', 'dl', 'figure', 'blockquote', 'header'].includes(tag)) {
            md += toMarkdown(node);
          }
          else md += toMarkdown(node);
        }
      }
      return md;
    }

    const title = document.title || '';
    const content = toMarkdown(contentEl);

    const cleaned = content
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();

    return { title, content: cleaned };
  };
}

export async function extractFromPage(page, type) {
  const selector = getContentSelector(type);
  return page.evaluate(buildEvaluateFn(selector), selector);
}
