// 把书籍信息 + 各章正文组装为 UTF-8 txt 文本，并提供写盘。
const fs = require('fs');
const path = require('path');

const EOL = '\r\n';
const LOCKED_PLACEHOLDER = '【本章为付费/锁定章节，未下载】';

/**
 * 生成 txt 全文。
 * @param {object} book 书籍信息 {bookName, author, description, category, status, chapterTotal, wordNumber}
 * @param {Array} chapters 章节内容 [{title, volume, paragraphs:[string], locked?:bool}]
 * @returns {string}
 */
function buildTxt(book, chapters) {
  const lines = [];
  lines.push(`《${book.bookName || '未命名'}》`);
  if (book.author) lines.push(`作者：${book.author}`);
  if (book.category) lines.push(`分类：${book.category}`);
  lines.push(`简介：${book.description || '（无）'}`);
  lines.push('');

  let lastVolume = null;
  for (const ch of chapters) {
    if (ch.volume && ch.volume !== lastVolume) {
      lastVolume = ch.volume;
      lines.push(lastVolume);
      lines.push('');
    }
    const header = normalizeChapterTitle(ch.title, ch.order);
    lines.push(header);
    lines.push('');
    if (ch.locked) {
      lines.push(LOCKED_PLACEHOLDER);
    } else if (Array.isArray(ch.paragraphs) && ch.paragraphs.length) {
      for (const p of ch.paragraphs) {
        lines.push(p);
        lines.push('');
      }
    } else if (ch.text) {
      for (const p of String(ch.text).split(/\n+/)) {
        if (p.trim()) { lines.push(p.trim()); lines.push(''); }
      }
    }
    lines.push('');
  }
  return lines.join(EOL).replace(/\r?\n{3,}/g, EOL + EOL).trim() + EOL;
}

// 章节标题：优先用原标题（已含"第N章"则原样），"001 标题"这类数字前缀会去掉前缀并规范为"第N章 标题"。
function normalizeChapterTitle(title, order) {
  if (!title) return `第${order}章`;
  if (/^第\s*[\d一二三四五六七八九十百千万零]+\s*[章节回卷]/.test(title)) return title;
  const m = title.match(/^(\d+)[\s.、:]/);
  if (m) return `第${parseInt(m[1], 10)}章 ${title.replace(/^\d+[\s.、:]/, '')}`;
  return `第${order}章 ${title}`;
}

// 生成安全的文件名（去非法字符、限长）。
function safeFileName(name, fallback = 'novel') {
  const s = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return s || fallback;
}

// 写 txt 到磁盘，返回实际路径。
function saveTxt(book, chapters, outDir, fileName) {
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = fileName || `${safeFileName(book.bookName)}.txt`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buildTxt(book, chapters), 'utf8');
  return filePath;
}

module.exports = { buildTxt, normalizeChapterTitle, safeFileName, saveTxt, EOL, LOCKED_PLACEHOLDER };
