'use strict';

const cheerio = require('cheerio');

const CHAPTER_RE = /(?:^|[\s【[(（])第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章节回卷集部篇]|^\s*(?:chapter|chap\.?)\s*\d+|^\s*\d{1,6}[.、：:\s-]+\S/i;
const BLOCKED_RE = /登录|注册|充值|购买|付费|会员|书架|投票|评论|举报|app下载|客户端下载|上一章|下一章|返回目录|章节目录|目录页|广告|copyright/i;
const CONTENT_SELECTORS = [
  '#chaptercontent', '#chapter-content', '#content', '#read-content',
  '.chapter-content', '.chapterContent', '.read-content', '.reader-content',
  '.article-content', '.articleContent', '.content', 'article', 'main'
];
// 目录容器（优先按站点专用目录容器取章节，保证顺序正确；wodushu/qula 用 #chapter_list）
const DIRECTORY_SELECTORS = ['#chapter_list', '#chapter-list', '#chapterList', '#list'];

function requireWebUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || '').trim()); } catch (_) { throw new Error('请输入有效的书籍网页地址'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP/HTTPS 书籍网页');
  if (url.username || url.password) throw new Error('网页地址不能包含登录凭据');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('不允许访问本机或局域网地址');
  }
  url.hash = '';
  return url;
}

function siteKey(hostname) {
  const parts = String(hostname || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  return parts.length > 1 ? parts.slice(-2).join('.') : parts[0] || '';
}

function cleanText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t\f\v]+/g, ' ').replace(/\r/g, '').trim();
}

function cleanTitle(value, hostname = '') {
  let title = cleanText(value).replace(/\s*[|_—–-]\s*(?:[^|_—–-]{2,30}(?:小说|阅读|中文网|文学城|书城|官网)?)\s*$/i, '').trim();
  if (hostname) title = title.replace(new RegExp(`\\s*[|_—–-]\\s*${hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim();
  return title || '未命名小说';
}

function firstMeta($, selectors) {
  for (const selector of selectors) {
    const value = $(selector).first().attr('content') || $(selector).first().text();
    if (cleanText(value)) return cleanText(value);
  }
  return '';
}

function extractAuthor($) {
  const direct = firstMeta($, [
    'meta[property="og:novel:author"]', 'meta[name="author"]',
    '[itemprop="author"]', '.book-author', '.author-name', '.author'
  ]);
  if (direct) return direct.replace(/^作者[：:\s]*/, '').trim();
  const body = cleanText($('body').text());
  const match = body.match(/作者[：:\s]+([^\s|｜]{1,30})/);
  return match ? match[1] : '';
}

function isUsableChapterLink(anchorText, url, bookUrl) {
  if (!CHAPTER_RE.test(anchorText) || BLOCKED_RE.test(anchorText)) return false;
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (siteKey(url.hostname) !== siteKey(bookUrl.hostname)) return false;
  if (/\/(?:login|register|pay|buy|user|account)(?:\/|$)/i.test(url.pathname)) return false;
  return url.toString() !== bookUrl.toString();
}

// 相对链接解析为绝对地址；非同域或无效返回空。
function resolveUrl(href, baseUrl) {
  if (!href || href === '#' || /^javascript:/i.test(href)) return '';
  try {
    const u = new URL(String(href), baseUrl);
    u.hash = '';
    if (u.hostname !== baseUrl.hostname) return '';
    if (u.toString() === baseUrl.toString()) return '';
    return u.toString();
  } catch (_) { return ''; }
}

// 判断 nextUrl 是否为 currentUrl 的“同一章续页”（例如 .../123_2.html 是 .../123.html 的续页）。
function isSubPageUrl(currentUrl, nextUrl) {
  try {
    const a = new URL(currentUrl);
    const b = new URL(nextUrl);
    if (a.hostname !== b.hostname) return false;
    const base = b.pathname.replace(/_(\d+)(\.\w+)$/, '$2');
    return base === a.pathname && b.pathname !== a.pathname;
  } catch (_) { return false; }
}

// 从书籍页面提取章节目录链接（有序去重）：优先站点专用目录容器，再通用扫描兜底。
function extractDirectoryLinks(html, rawUrl) {
  const bookUrl = requireWebUrl(rawUrl);
  const $ = cheerio.load(String(html || ''));
  $('script,style,noscript,template').remove();
  const out = [];
  const seen = new Set();

  const push = (title, href) => {
    if (!title || !href || seen.has(href)) return;
    seen.add(href);
    out.push({ url: href, title });
  };

  for (const sel of DIRECTORY_SELECTORS) {
    const anchors = $(`${sel} a[href]`);
    if (!anchors.length) continue;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const title = cleanText($(a).text());
      let chapterUrl;
      try { chapterUrl = new URL($(a).attr('href'), bookUrl); } catch (_) { continue; }
      chapterUrl.hash = '';
      const href = chapterUrl.toString();
      if (!isUsableChapterLink(title, chapterUrl, bookUrl)) continue;
      push(title, href);
    }
    if (out.length) return out;
  }

  $('a[href]').each((_, element) => {
    if (out.length >= 5000) return false;
    const title = cleanText($(element).text());
    let chapterUrl;
    try { chapterUrl = new URL($(element).attr('href'), bookUrl); } catch (_) { return; }
    chapterUrl.hash = '';
    const href = chapterUrl.toString();
    if (!isUsableChapterLink(title, chapterUrl, bookUrl) || seen.has(href)) return;
    seen.add(href);
    out.push({ url: href, title });
  });
  return out;
}

// 目录页“下一页”链接（同一本书的分页，例如 /book/299077/2/ → /book/299077/3/）。
// bookRootUrl 为原始书籍首页地址，用于判断 next 是否仍属于同一本书。
function parseNextDirectoryPageUrl(html, rawUrl, bookRootUrl) {
  const bookUrl = requireWebUrl(rawUrl);
  const $ = cheerio.load(String(html || ''));
  let href = '';
  $('a').each((_, a) => {
    if (href) return;
    const t = cleanText($(a).text());
    if (/^(下一页|下一頁|下页|下頁)$/.test(t)) href = $(a).attr('href') || '';
  });
  const next = resolveUrl(href, bookUrl);
  if (!next) return '';
  try {
    const root = new URL(requireWebUrl(bookRootUrl || rawUrl).toString());
    const n = new URL(next);
    const rootBase = root.pathname.replace(/\/+$/, '');
    const isPage = n.pathname === root.pathname // ?page=N 形式
      || n.pathname.startsWith(rootBase + '/'); // /book/{id}/{n}/ 形式
    return isPage ? next : '';
  } catch (_) { return ''; }
}

function parseBookPage(html, rawUrl) {
  const bookUrl = requireWebUrl(rawUrl);
  const $ = cheerio.load(String(html || ''));
  $('script,style,noscript,template').remove();

  const rawTitle = firstMeta($, [
    'meta[property="og:novel:book_name"]', 'meta[property="og:title"]',
    'meta[name="book_name"]', 'h1', 'title'
  ]);
  const bookName = cleanTitle(rawTitle, bookUrl.hostname);
  const author = extractAuthor($);
  const description = firstMeta($, [
    'meta[property="og:description"]', 'meta[name="description"]',
    '[itemprop="description"]', '.book-intro', '.book-desc', '.description', '.intro'
  ]).slice(0, 2000);
  const category = firstMeta($, ['meta[property="og:novel:category"]']) || bookUrl.hostname.replace(/^www\./, '');
  const statusRaw = firstMeta($, ['meta[property="og:novel:status"]']);
  const status = /完结|完本/.test(statusRaw) ? 2 : 1;

  const links = extractDirectoryLinks(html, rawUrl);
  if (!links.length) {
    throw new Error('未识别到公开章节目录；该页面可能需要登录、由脚本动态加载，或不是书籍目录页');
  }
  const chapters = links.map((link, i) => ({
    itemId: link.url,
    url: link.url,
    title: link.title,
    order: i + 1,
    volume: '',
    needPay: false,
  }));

  return {
    bookId: bookUrl.toString(),
    sourceUrl: bookUrl.toString(),
    source: bookUrl.hostname.replace(/^www\./, ''),
    bookName,
    author,
    description,
    category,
    status,
    chapterTotal: chapters.length,
    wordNumber: 0,
    chapters,
  };
}

function elementParagraphs($, element) {
  const node = $(element).clone();
  node.find('script,style,noscript,template,nav,header,footer,form,button,aside,iframe,.ads,.ad,.advertisement').remove();
  let paragraphs = node.find('p').map((_, p) => cleanText($(p).text())).get().filter(Boolean);
  if (paragraphs.length < 2) {
    node.find('br').replaceWith('\n');
    paragraphs = node.text().split(/\n+/).map(cleanText).filter(Boolean);
  }
  return paragraphs.filter((line) => line.length > 1 && !BLOCKED_RE.test(line));
}

// 提取章节正文段落（不抛错，返回数组；供单页/多页合并使用）。
function extractChapterParagraphs(html) {
  const $ = cheerio.load(String(html || ''));
  const candidates = [];
  for (const selector of CONTENT_SELECTORS) {
    $(selector).each((_, element) => {
      const paragraphs = elementParagraphs($, element);
      const chars = paragraphs.join('').length;
      if (chars) candidates.push({ paragraphs, score: chars + Math.min(paragraphs.length, 30) * 40 });
    });
  }
  if (!candidates.length) {
    const paragraphs = elementParagraphs($, $('body').get(0));
    candidates.push({ paragraphs, score: paragraphs.join('').length });
  }
  candidates.sort((a, b) => b.score - a.score);
  return (candidates[0]?.paragraphs || []).filter((line, index, all) => index === 0 || line !== all[index - 1]);
}

function parseChapterPage(html, rawUrl) {
  const chapterUrl = requireWebUrl(rawUrl);
  const paragraphs = extractChapterParagraphs(html);
  const text = paragraphs.join('\n');
  if (text.replace(/\s/g, '').length < 100) {
    throw new Error('未提取到足够的公开正文；该章节可能需要登录、付费、验证码或脚本渲染');
  }
  return { itemId: chapterUrl.toString(), url: chapterUrl.toString(), paragraphs, text, residual: 0, mode: 'generic' };
}

// 章节续页“下一页”链接：优先 qula 模板的 nextpage 变量，其次同章 _N 续页链接。
function parseNextSubPageUrl(html, rawUrl) {
  const chapterUrl = requireWebUrl(rawUrl);
  const m = String(html || '').match(/var\s+nextpage\s*=\s*["']([^"']*)["']/);
  if (m) {
    const v = m[1].trim();
    if (!v) return '';
    return resolveUrl(v, chapterUrl);
  }
  const $ = cheerio.load(String(html || ''));
  let href = '';
  $('a').each((_, a) => {
    if (href) return;
    const t = cleanText($(a).text());
    if (/^(下一页|下一頁|下页|下頁)$/.test(t)) href = $(a).attr('href') || '';
  });
  const next = resolveUrl(href, chapterUrl);
  if (next && isSubPageUrl(chapterUrl.toString(), next)) return next;
  return '';
}

async function getBook(rawUrl, http) {
  const url = requireWebUrl(rawUrl);
  const chapters = [];
  const seen = new Set();
  let bookInfo = null;
  let currentUrl = url.toString();
  const MAX_PAGES = 200;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await http.fetchText(currentUrl);
    if (response.status < 200 || response.status >= 400) break;
    let parsed;
    try {
      parsed = parseBookPage(response.text, currentUrl);
    } catch (e) {
      if (page === 0) throw e; // 首页无目录才抛错
      break; // 后续翻页无章节则停止
    }
    if (!bookInfo) bookInfo = parsed;
    let added = 0;
    for (const ch of parsed.chapters) {
      const key = ch.url || ch.itemId;
      if (key && !seen.has(key)) { seen.add(key); chapters.push(ch); added++; }
    }
    if (added === 0) break; // 无新章节 → 已到末尾
    const next = parseNextDirectoryPageUrl(response.text, currentUrl, url.toString());
    if (!next) break;
    currentUrl = next;
  }

  if (!bookInfo) throw new Error('未识别到公开章节目录；该页面可能需要登录、由脚本动态加载，或不是书籍目录页');
  return { ...bookInfo, chapters, chapterTotal: chapters.length };
}

async function getChapter(rawUrl, http) {
  const url = requireWebUrl(rawUrl);
  const paragraphs = [];
  let currentUrl = url.toString();
  const MAX_SUBPAGES = 100;

  for (let page = 0; page < MAX_SUBPAGES; page++) {
    const response = await http.fetchText(currentUrl);
    if (response.status < 200 || response.status >= 400) break;
    const html = response.text;
    paragraphs.push(...extractChapterParagraphs(html));
    const next = parseNextSubPageUrl(html, currentUrl);
    if (!next) break;
    currentUrl = next;
  }

  const deduped = paragraphs.filter((line, index, all) => index === 0 || line !== all[index - 1]);
  const text = deduped.join('\n');
  if (text.replace(/\s/g, '').length < 100) {
    throw new Error('未提取到足够的公开正文；该章节可能需要登录、付费、验证码或脚本渲染');
  }
  return { itemId: url.toString(), url: url.toString(), paragraphs: deduped, text, residual: 0, mode: 'generic' };
}

module.exports = {
  CHAPTER_RE,
  requireWebUrl,
  siteKey,
  cleanText,
  cleanTitle,
  parseBookPage,
  parseChapterPage,
  getBook,
  getChapter,
  extractDirectoryLinks,
  parseNextDirectoryPageUrl,
  extractChapterParagraphs,
  parseNextSubPageUrl,
};
