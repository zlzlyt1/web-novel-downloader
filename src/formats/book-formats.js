const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function stripMarkdown(value) {
  return normalizeText(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(`{1,3}|\*\*|__|~~)/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .trim();
}

function normalizeBook(input, sourceFormat = '') {
  const title = normalizeText(input?.title) || '未命名';
  const chapters = Array.isArray(input?.chapters) ? input.chapters.slice(0, 50000).map((chapter, index) => {
    const chapterTitle = normalizeText(chapter?.title) || `第 ${index + 1} 章`;
    const paragraphs = (Array.isArray(chapter?.paragraphs) ? chapter.paragraphs : [])
      .map((paragraph) => sourceFormat === 'md' ? stripMarkdown(paragraph) : normalizeText(paragraph))
      .filter(Boolean);
    return { title: chapterTitle, paragraphs };
  }) : [];
  return { title, chapters: chapters.length ? chapters : [{ title: '正文', paragraphs: [] }] };
}

function entryText(zip, entryName) {
  const normalized = path.posix.normalize(String(entryName || '').replace(/\\/g, '/'));
  const entry = zip.getEntry(normalized);
  if (!entry) throw new Error(`EPUB 缺少文件：${normalized}`);
  return entry.getData().toString('utf8');
}

function hrefPath(baseDir, href) {
  const decoded = decodeURIComponent(String(href || '').split('#')[0]);
  return path.posix.normalize(path.posix.join(baseDir, decoded));
}

function parseEpub(filePath) {
  const zip = new AdmZip(filePath);
  const containerXml = entryText(zip, 'META-INF/container.xml');
  const container = cheerio.load(containerXml, { xmlMode: true });
  const opfPath = container('rootfile').first().attr('full-path');
  if (!opfPath) throw new Error('EPUB 容器没有指定内容清单');

  const opfDir = path.posix.dirname(opfPath);
  const opfXml = entryText(zip, opfPath);
  const opf = cheerio.load(opfXml, { xmlMode: true });
  const title = normalizeText(opf('metadata title, metadata dc\\:title').first().text()) || path.basename(filePath, path.extname(filePath));
  const manifest = new Map();
  opf('manifest item').each((_index, element) => {
    const item = opf(element);
    const id = item.attr('id');
    if (id) manifest.set(id, {
      href: item.attr('href') || '',
      mediaType: item.attr('media-type') || '',
      properties: item.attr('properties') || '',
    });
  });

  const labels = new Map();
  for (const item of manifest.values()) {
    if (!/(^|\s)nav(\s|$)/.test(item.properties)) continue;
    try {
      const navPath = hrefPath(opfDir, item.href);
      const navDir = path.posix.dirname(navPath);
      const nav = cheerio.load(entryText(zip, navPath), { xmlMode: true });
      nav('nav a').each((_index, element) => {
        const anchor = nav(element);
        labels.set(hrefPath(navDir, anchor.attr('href')), normalizeText(anchor.text()));
      });
    } catch (_) { /* 部分旧 EPUB 没有可用的 nav.xhtml */ }
  }

  const chapters = [];
  opf('spine itemref').each((_index, element) => {
    const idref = opf(element).attr('idref');
    const item = manifest.get(idref);
    if (!item || !/(xhtml|html)/i.test(item.mediaType)) return;
    const chapterPath = hrefPath(opfDir, item.href);
    let html;
    try { html = entryText(zip, chapterPath); } catch (_) { return; }
    const page = cheerio.load(html, { xmlMode: false, decodeEntities: true });
    page('script,style,nav,svg').remove();
    const heading = normalizeText(page('h1,h2').first().text());
    const chapterTitle = labels.get(chapterPath) || heading || normalizeText(page('title').first().text()) || `第 ${chapters.length + 1} 章`;
    const paragraphs = [];
    page('p,li,blockquote,h3,h4,h5,h6').each((_i, node) => {
      const text = normalizeText(page(node).text());
      if (text && text !== chapterTitle) paragraphs.push(text);
    });
    if (!paragraphs.length) {
      const bodyText = normalizeText(page('body').text());
      if (bodyText) paragraphs.push(...bodyText.split('\n').map(normalizeText).filter((text) => text && text !== chapterTitle));
    }
    if (paragraphs.length || heading) chapters.push({ title: chapterTitle, paragraphs });
  });

  if (!chapters.length) throw new Error('EPUB 中没有找到可阅读的正文章节');
  return { title, chapters };
}

function renderTxt(input, sourceFormat = '') {
  const book = normalizeBook(input, sourceFormat);
  const parts = [`书名：${book.title}`];
  for (const chapter of book.chapters) parts.push(chapter.title, ...chapter.paragraphs);
  return parts.join('\r\n\r\n') + '\r\n';
}

function renderMarkdown(input, sourceFormat = '') {
  const book = normalizeBook(input, sourceFormat);
  const parts = [`# ${book.title}`];
  for (const chapter of book.chapters) parts.push(`## ${chapter.title}`, ...chapter.paragraphs);
  return parts.join('\n\n') + '\n';
}

function renderEpub(input, sourceFormat = '') {
  const book = normalizeBook(input, sourceFormat);
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  const mimeEntry = zip.getEntry('mimetype');
  if (mimeEntry?.header) mimeEntry.header.method = 0;
  zip.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'));

  const manifestItems = [];
  const spineItems = [];
  const navItems = [];
  book.chapters.forEach((chapter, index) => {
    const number = index + 1;
    const fileName = `chapter-${number}.xhtml`;
    const paragraphs = chapter.paragraphs.map((paragraph) => `<p>${xmlEscape(paragraph)}</p>`).join('\n');
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><meta charset="UTF-8"/><title>${xmlEscape(chapter.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>${xmlEscape(chapter.title)}</h1>${paragraphs}</body></html>`;
    zip.addFile(`OEBPS/${fileName}`, Buffer.from(xhtml));
    manifestItems.push(`<item id="chapter-${number}" href="${fileName}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="chapter-${number}"/>`);
    navItems.push(`<li><a href="${fileName}">${xmlEscape(chapter.title)}</a></li>`);
  });
  const nav = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN"><head><meta charset="UTF-8"/><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>${navItems.join('')}</ol></nav></body></html>`;
  const css = 'body{font-family:serif;line-height:1.8;margin:5%;}h1{text-align:center;}p{text-indent:2em;margin:0 0 1em;}';
  const identifier = `urn:uuid:${crypto.randomUUID()}`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xmlEscape(book.title)}</dc:title><dc:language>zh-CN</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>${manifestItems.join('')}</manifest><spine>${spineItems.join('')}</spine></package>`;
  zip.addFile('OEBPS/nav.xhtml', Buffer.from(nav));
  zip.addFile('OEBPS/style.css', Buffer.from(css));
  zip.addFile('OEBPS/content.opf', Buffer.from(opf));
  return zip.toBuffer();
}

module.exports = { parseEpub, renderTxt, renderMarkdown, renderEpub, normalizeBook };
