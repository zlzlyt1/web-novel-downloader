'use strict';

const { HttpClient } = require('../crawler/http');

const SOURCE_NAMES = [
  ['fanqienovel.com', '番茄小说'],
  ['qidian.com', '起点中文网'],
  ['zongheng.com', '纵横中文网'],
  ['jjwxc.net', '晋江文学城'],
  ['17k.com', '17K小说网'],
  ['qimao.com', '七猫小说'],
  ['ciweimao.com', '刺猬猫'],
  ['shuqi.com', '书旗小说'],
  ['weread.qq.com', '微信读书'],
  ['read.douban.com', '豆瓣阅读'],
  ['douban.com', '豆瓣'],
  ['baike.baidu.com', '百度百科']
];

function decodeHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, key) => named[key.toLowerCase()]);
}

function stripHtml(value) {
  return decodeHtml(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(rawUrl) {
  const decoded = decodeHtml(rawUrl).trim();
  try {
    const url = new URL(decoded);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
}

function classifySource(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    const match = SOURCE_NAMES.find(([domain]) => host === domain || host.endsWith('.' + domain));
    return { source: match ? match[1] : host, domain: host };
  } catch (_) {
    return { source: '其他网站', domain: '' };
  }
}

function isFanqieDownloadable(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (host === 'fanqienovel.com' || host.endsWith('.fanqienovel.com'))
      && /^\/(?:page|reader)\/\d+/.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function parseBingResults(html, limit = 15) {
  const blocks = String(html || '').match(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>[\s\S]*?<\/li>/gi) || [];
  const results = [];
  const seen = new Set();

  for (const block of blocks) {
    const heading = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
    if (!heading) continue;
    const url = normalizeUrl(heading[1]);
    const title = stripHtml(heading[2]);
    if (!url || !title || seen.has(url)) continue;
    const paragraph = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const description = paragraph ? stripHtml(paragraph[1]) : '';
    const sourceInfo = classifySource(url);
    results.push({
      title,
      url,
      description,
      ...sourceInfo,
      canDownload: true,
      isFanqie: isFanqieDownloadable(url)
    });
    seen.add(url);
    if (results.length >= limit) break;
  }
  return results;
}

function cleanQuery(query) {
  return String(query || '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，。！？、；：,.!?;:\s]+|[，。！？、；：,.!?;:\s]+$/g, '')
    .slice(0, 100);
}

function buildSearchUrl(query, count = 20) {
  const keyword = cleanQuery(query);
  const params = new URLSearchParams({ q: `"${keyword}"`, count: String(count) });
  return `https://cn.bing.com/search?${params}`;
}

function normalizeForMatch(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function filterRelevantResults(results, query) {
  const key = normalizeForMatch(query);
  if (key.length < 2) return results;
  const relevant = results.filter((result) => {
    const title = normalizeForMatch(result.title);
    const description = normalizeForMatch(result.description);
    return title.includes(key) || description.includes(key)
      || (title.length >= 4 && key.includes(title));
  });
  return relevant.length ? relevant : results;
}

async function searchBooks(query, options = {}) {
  const keyword = cleanQuery(query);
  if (!keyword) throw new Error('请输入书名');
  const searchUrl = buildSearchUrl(keyword, options.count || 20);
  const http = options.http || new HttpClient({
    minInterval: 0,
    maxRetries: 1,
    timeoutMs: 15000,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'
    }
  });
  const response = await http.fetchText(searchUrl);
  if (response.status < 200 || response.status >= 400) throw new Error(`搜索服务返回 HTTP ${response.status}`);
  const parsed = parseBingResults(response.text, options.limit || 15);
  return {
    query: keyword,
    searchUrl,
    results: filterRelevantResults(parsed, keyword)
  };
}

module.exports = {
  SOURCE_NAMES,
  cleanQuery,
  buildSearchUrl,
  classifySource,
  filterRelevantResults,
  isFanqieDownloadable,
  parseBingResults,
  searchBooks
};
