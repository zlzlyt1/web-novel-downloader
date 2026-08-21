// 轻量自包含 Markdown 渲染器（纯 DOM，无第三方依赖）。
// 暴露全局 renderMarkdown(mdString) -> HTML 字符串。
// 所有源文本先做 HTML 转义，避免 XSS；再应用 Markdown 结构变换。

function mdEscapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 行内 Markdown：code、图片、链接、加粗、斜体、删除线。
function mdInline(text) {
  let s = mdEscapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => {
    codes.push('<code>' + c + '</code>');
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img src="$2" alt="$1" />');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong>$1$2</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, n) => codes[+n]);
  return s;
}

function mdParseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
}

// 块级 Markdown 渲染。
function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];

    // 围栏代码块
    const fence = line.match(/^```([\w.-]*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < n && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; // 跳过结束围栏
      html += '<pre><code>' + mdEscapeHtml(code.join('\n')) + '</code></pre>\n';
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      html += '<h' + h[1].length + '>' + mdInline(h[2]) + '</h' + h[1].length + '>\n';
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html += '<hr />\n';
      i++;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < n && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      html += '<blockquote>\n' + renderMarkdown(q.join('\n')) + '</blockquote>\n';
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      html += '<ul>\n';
      while (i < n) {
        const m = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (!m) break;
        html += '<li>' + mdInline(m[1]) + '</li>\n';
        i++;
      }
      html += '</ul>\n';
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      html += '<ol>\n';
      while (i < n) {
        const m = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!m) break;
        html += '<li>' + mdInline(m[1]) + '</li>\n';
        i++;
      }
      html += '</ol>\n';
      continue;
    }

    // 表格
    if (/^\s*\|/.test(line) && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = mdParseTableRow(line);
      const alignRow = mdParseTableRow(lines[i + 1]);
      i += 2;
      const align = (c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.startsWith(':') ? 'left' : c.endsWith(':') ? 'right' : '');
      const td = (cells, tag, isHeader) =>
        '<tr>' + cells.map((c, k) => {
          const a = align(alignRow[k]);
          const st = a ? ' style="text-align:' + a + '"' : '';
          return '<' + tag + st + '>' + mdInline(c) + '</' + tag + '>';
        }).join('') + '</tr>';
      html += '<table>\n<thead>' + td(header, 'th', true) + '</thead>\n<tbody>\n';
      while (i < n && /^\s*\|/.test(lines[i])) {
        html += td(mdParseTableRow(lines[i]), 'td', false) + '\n';
        i++;
      }
      html += '</tbody></table>\n';
      continue;
    }

    // 空行
    if (!line.trim()) { i++; continue; }

    // 段落（收集到空行或新的块级起始为止）
    const para = [];
    while (
      i < n &&
      lines[i].trim() &&
      !/^(#{1,6}\s+|```|>|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*\|)/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    html += '<p>' + mdInline(para.join(' ')) + '</p>\n';
  }

  return html;
}
