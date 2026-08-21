// 已下载书籍的更新元数据与 TXT 追加写入。
const fs = require('fs');
const path = require('path');
const { normalizeChapterTitle, EOL, LOCKED_PLACEHOLDER } = require('./txt');
const { chapterKey } = require('./downloader');

function metadataPath(filePath) {
  return `${filePath}.novel-meta.json`;
}

function chapterRecord(chapter) {
  return {
    key: chapterKey(chapter),
    itemId: chapter.itemId ? String(chapter.itemId) : '',
    url: chapter.url || '',
    title: chapter.title || '',
    volume: chapter.volume || '',
    order: chapter.order || 0,
  };
}

function loadLibraryMeta(filePath) {
  try { return JSON.parse(fs.readFileSync(metadataPath(filePath), 'utf8')); } catch (_) { return null; }
}

function saveLibraryMeta(filePath, data) {
  fs.writeFileSync(metadataPath(filePath), JSON.stringify(data, null, 2), 'utf8');
}

function createLibraryMeta(filePath, sourceUrl, book, chapters) {
  return {
    version: 1,
    filePath,
    sourceUrl,
    bookName: book.bookName || '',
    lastVolume: chapters.length ? (chapters[chapters.length - 1].volume || '') : '',
    chapters: chapters.map(chapterRecord).filter((chapter) => chapter.key),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function appendTxtChapters(filePath, chapters, lastVolume = '') {
  const lines = [];
  let currentVolume = lastVolume;
  for (const chapter of chapters) {
    if (chapter.volume && chapter.volume !== currentVolume) {
      currentVolume = chapter.volume;
      lines.push(currentVolume, '');
    }
    lines.push(normalizeChapterTitle(chapter.title, chapter.order), '');
    if (chapter.locked) lines.push(LOCKED_PLACEHOLDER, '');
    else if (Array.isArray(chapter.paragraphs) && chapter.paragraphs.length) {
      for (const paragraph of chapter.paragraphs) lines.push(String(paragraph).trim(), '');
    } else if (chapter.text) {
      for (const paragraph of String(chapter.text).split(/\n+/)) if (paragraph.trim()) lines.push(paragraph.trim(), '');
    }
    lines.push('');
  }
  if (!lines.length) return lastVolume;
  const suffix = lines.join(EOL).replace(/\r?\n{3,}/g, EOL + EOL).trim();
  fs.appendFileSync(filePath, EOL + EOL + suffix + EOL, 'utf8');
  return currentVolume;
}

function mergeNewChapters(meta, chapters) {
  const seen = new Set((meta.chapters || []).map((chapter) => chapter.key).filter(Boolean));
  const records = chapters.map(chapterRecord).filter((chapter) => chapter.key && !seen.has(chapter.key));
  return {
    ...meta,
    chapters: [...(meta.chapters || []), ...records],
    lastVolume: chapters.length ? (chapters[chapters.length - 1].volume || meta.lastVolume || '') : (meta.lastVolume || ''),
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { metadataPath, loadLibraryMeta, saveLibraryMeta, createLibraryMeta, appendTxtChapters, mergeNewChapters };
