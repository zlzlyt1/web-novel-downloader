// 番茄小说(fanqienovel.com) 适配器：书籍目录与章节正文的抓取与解析。
const { HttpClient } = require('./http');
const { decodeChapterContent } = require('./deobfuscate');

const BASE = 'https://fanqienovel.com';

// 从 `window.__INITIAL_STATE__=` 后用括号配平提取 JSON 对象（该行无换行，不能用正则懒惰匹配）。
function extractInitialState(html) {
  const key = 'window.__INITIAL_STATE__=';
  const i = html.indexOf(key);
  if (i < 0) return null;
  const j = html.indexOf('{', i);
  if (j < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = j; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return sanitizeStateJson(html.slice(j, k + 1));
    }
  }
  return null;
}

// 把 JS 字面量里的 undefined/NaN/Infinity 替换为 JSON 合法的 null。
function sanitizeStateJson(json) {
  return json
    .replace(/:undefined/g, ':null')
    .replace(/:NaN/g, ':null')
    .replace(/:Infinity/g, ':null');
}

function parseState(html) {
  const raw = extractInitialState(html);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 兜底：去掉可能残留的尾部非 JSON 内容再试
    const last = raw.lastIndexOf('}');
    try {
      return JSON.parse(raw.slice(0, last + 1));
    } catch (e2) {
      throw new Error('解析 __INITIAL_STATE__ 失败: ' + e2.message);
    }
  }
}

function normalizeDirectoryChapter(chapter, order, fallbackVolume = '') {
  if (!chapter || typeof chapter !== 'object') return null;
  const itemId = chapter.itemId ?? chapter.item_id ?? chapter.chapterId ?? chapter.chapter_id ?? chapter.id;
  if (!itemId || !/^\d+$/.test(String(itemId))) return null;
  return {
    itemId: String(itemId),
    title: chapter.title || chapter.chapterTitle || chapter.chapter_title || chapter.chapterName || chapter.chapter_name || `第${order}章`,
    volume: chapter.volume_name || chapter.volumeName || fallbackVolume || '',
    order,
    needPay: !!chapter.needPay,
    isChapterLock: !!chapter.isChapterLock,
    isPaidPublication: !!chapter.isPaidPublication,
    isPaidStory: !!chapter.isPaidStory,
  };
}

function findLargestChapterArray(value, best = []) {
  if (Array.isArray(value)) {
    const valid = value.filter((item) => item && typeof item === 'object' && normalizeDirectoryChapter(item, 1));
    if (valid.length > best.length) best = valid;
    for (const item of value) best = findLargestChapterArray(item, best);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) best = findLargestChapterArray(child, best);
  }
  return best;
}

function parseDirectoryData(payload) {
  const root = payload && payload.data ? payload.data : payload;
  if (!root || typeof root !== 'object') return [];
  const chapters = [];
  const volumes = root.chapterListWithVolume;
  if (Array.isArray(volumes)) {
    for (let volumeIndex = 0; volumeIndex < volumes.length; volumeIndex++) {
      const group = Array.isArray(volumes[volumeIndex]) ? volumes[volumeIndex] : [];
      const volumeName = (root.volumeNameList && root.volumeNameList[volumeIndex]) || '';
      for (const raw of group) {
        const chapter = normalizeDirectoryChapter(raw, chapters.length + 1, volumeName);
        if (chapter) chapters.push(chapter);
      }
    }
  }
  if (!chapters.length) {
    for (const key of ['chapterList', 'chapter_list', 'chapters', 'item_list', 'items', 'list']) {
      if (!Array.isArray(root[key])) continue;
      for (const raw of root[key]) {
        const chapter = normalizeDirectoryChapter(raw, chapters.length + 1);
        if (chapter) chapters.push(chapter);
      }
      if (chapters.length) break;
    }
  }
  if (!chapters.length) {
    for (const raw of findLargestChapterArray(root)) {
      const chapter = normalizeDirectoryChapter(raw, chapters.length + 1);
      if (chapter) chapters.push(chapter);
    }
  }
  if (!chapters.length && Array.isArray(root.allItemIds)) {
    for (const id of root.allItemIds) {
      if (/^\d+$/.test(String(id))) chapters.push(normalizeDirectoryChapter({ itemId: id }, chapters.length + 1));
    }
  }
  const seen = new Set();
  return chapters.filter((chapter) => chapter && !seen.has(chapter.itemId) && seen.add(chapter.itemId));
}

async function fetchChapterDirectory(bookId, http) {
  const cacheKey = `fanqie-directory-${bookId}`;
  try {
    const response = await http.fetchText(`${BASE}/api/reader/directory/detail?bookId=${bookId}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: `${BASE}/page/${bookId}`
      }
    });
    if (response.status < 200 || response.status >= 400) throw new Error(`HTTP ${response.status}`);
    const payload = JSON.parse(response.text);
    const chapters = parseDirectoryData(payload);
    if (!chapters.length) throw new Error('目录响应中没有章节');
    if (typeof http.writeJsonCache === 'function') http.writeJsonCache(cacheKey, payload);
    return chapters;
  } catch (error) {
    const cached = typeof http.readJsonCache === 'function' ? http.readJsonCache(cacheKey) : null;
    const chapters = parseDirectoryData(cached);
    if (chapters.length) return chapters;
    throw new Error(`公开目录接口失败：${error.message}`);
  }
}

// 从任意 URL 提取 bookId（/page/{bookId}）。
function parseBookId(url) {
  const m = String(url || '').match(/\/page\/(\d+)/);
  return m ? m[1] : null;
}

// 从阅读页链接提取章节 itemId（/reader/{itemId}）。
function parseChapterId(url) {
  const m = String(url || '').match(/\/reader\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * 从任意链接解析书籍 ID：/page/{bookId} 直接取；
 * /reader/{itemId} 需请求章节页，从 chapterData.bookId 取所属书籍。
 * @param {string} url
 * @param {HttpClient} [http]
 * @returns {Promise<string|null>}
 */
async function resolveBookId(url, http = new HttpClient()) {
  const bid = parseBookId(url);
  if (bid) return bid;
  const cid = parseChapterId(url);
  if (cid) {
    const ch = await getChapter(cid, http);
    if (ch.bookId) return ch.bookId;
    throw new Error('阅读页中未找到所属书籍 ID');
  }
  return null;
}

/**
 * 抓取书籍信息 + 完整目录。
 * @param {string} bookId
 * @param {HttpClient} [http]
 * @returns {{bookId, bookName, author, description, category, status, chapterTotal, wordNumber, thumbUri, chapters:[{itemId,title,volume,order,needPay,isChapterLock,isPaidPublication,isPaidStory}]}}
 */
async function getBook(bookId, http = new HttpClient()) {
  const { status, text } = await http.fetchText(`${BASE}/page/${bookId}`);
  if (status < 200 || status >= 400) throw new Error(`书籍页面返回 HTTP ${status}`);
  const state = parseState(text);
  if (!state || !state.page) throw new Error('未解析到书籍信息（页面结构可能已变化）');
  const p = state.page;

  let chapters = [];
  const volumes = p.chapterListWithVolume || [];
  let order = 0;
  for (const vol of volumes) {
    const volName = vol && vol[0] && vol[0].volume_name ? vol[0].volume_name : '';
    for (const ch of vol || []) {
      order++;
      chapters.push({
        itemId: String(ch.itemId),
        title: ch.title || '',
        volume: volName,
        order,
        needPay: !!ch.needPay,
        isChapterLock: !!ch.isChapterLock,
        isPaidPublication: !!ch.isPaidPublication,
        isPaidStory: !!ch.isPaidStory,
      });
    }
  }
  // 兜底：若 chapterListWithVolume 为空，尝试 chapterList / itemIds。
  if (!chapters.length && Array.isArray(p.chapterList) && p.chapterList.length) {
    for (const ch of p.chapterList) {
      chapters.push({
        itemId: String(ch.itemId),
        title: ch.title || '',
        volume: '',
        order: chapters.length + 1,
        needPay: !!ch.needPay,
        isChapterLock: !!ch.isChapterLock,
        isPaidPublication: !!ch.isPaidPublication,
        isPaidStory: !!ch.isPaidStory,
      });
    }
  }
  if (!chapters.length) chapters = await fetchChapterDirectory(bookId, http);

  return {
    bookId: String(p.bookId || bookId),
    bookName: p.bookName || '',
    author: p.author || '',
    description: p.description || p.abstract || '',
    category: p.category || '',
    status: p.status, // 1 连载 / 2 完结（以页面实际为准）
    chapterTotal: p.chapterTotal || chapters.length,
    wordNumber: p.wordNumber || 0,
    thumbUri: p.thumbUri || '',
    chapters,
  };
}

/**
 * 抓取单章正文并反混淆。
 * @param {string} itemId 章节 itemId
 * @param {HttpClient} [http]
 * @returns {{itemId,title,bookName,bookId,author,contentHtml,needPay,isChapterLock,isPaidPublication,isPaidStory,nextItemId,preItemId,paragraphs,text,mode,residual}}
 */
async function getChapter(itemId, http = new HttpClient()) {
  const { text } = await http.fetchText(`${BASE}/reader/${itemId}`);
  const state = parseState(text);
  if (!state || !state.reader || !state.reader.chapterData) {
    throw new Error(`章节 ${itemId} 未解析到正文（可能被风控或章节不存在）`);
  }
  const cd = state.reader.chapterData;
  const decoded = decodeChapterContent(cd.content || '');
  return {
    itemId: String(cd.itemId || itemId),
    title: cd.title || '',
    bookName: cd.bookName || '',
    bookId: String(cd.bookId || ''),
    author: cd.author || '',
    contentHtml: cd.content || '',
    needPay: !!cd.needPay,
    isChapterLock: !!cd.isChapterLock,
    isPaidPublication: !!cd.isPaidPublication,
    isPaidStory: !!cd.isPaidStory,
    nextItemId: cd.nextItemId ? String(cd.nextItemId) : null,
    preItemId: cd.preItemId ? String(cd.preItemId) : null,
    paragraphs: decoded.paragraphs,
    text: decoded.text,
    mode: decoded.mode,
    residual: decoded.residual,
  };
}

// ── batch_full 正文源（第三方 / 官方中转）────────────────────────────
// 与参考项目 Tomato-Novel-Downloader 的第三方正文客户端对齐：
//   GET {base}/reading/reader/batch_full/v?item_ids={逗号分隔}&update_version_code=0&aid=1967&key_register_ts=0&device_platform=android&iid=0&epub=0
//   响应：{ "data": { "<item_id>": { "content": "...", "title": "...", "origin_chapter_title": "..." } } }
// 正文一般为已解密的 XHTML 或纯文本；这里统一走 decodeChapterContent，纯文本时自动无操作。

const BATCH_AID = '1967';

function normalizeBatchBase(base) {
  return String(base || '').trim().replace(/\/+$/, '');
}

function ensureTrailingQueryBase(url) {
  const u = String(url || '').trim();
  if (u.endsWith('?') || u.endsWith('&')) return u;
  return u.includes('?') ? `${u}&` : `${u}?`;
}

// 构造 batch_full 请求 URL；base 可以是域名、带路径的地址，或已含完整 query 的 URL。
function buildBatchUrl(base, itemIds, opts = {}) {
  const trimmed = normalizeBatchBase(base);
  let fullBase;
  if (trimmed.includes('/reading/reader/batch_full')) {
    // 已是完整 batch_full 地址（可能自带 query/token），直接使用
    fullBase = ensureTrailingQueryBase(trimmed);
  } else {
    // 拆分已有 query（如有），把 batch_full 路径插到 query 之前
    const qIdx = trimmed.indexOf('?');
    const pathPart = qIdx >= 0 ? trimmed.slice(0, qIdx) : trimmed;
    const queryPart = qIdx >= 0 ? trimmed.slice(qIdx + 1) : '';
    const joined = `${pathPart.replace(/\/+$/, '')}/reading/reader/batch_full/v`;
    fullBase = ensureTrailingQueryBase(queryPart ? `${joined}?${queryPart}` : joined);
  }
  const params = [
    ['item_ids', String(itemIds).trim()],
    ['update_version_code', '0'],
    ['aid', BATCH_AID],
    ['key_register_ts', '0'],
    ['device_platform', 'android'],
    ['iid', '0'],
    ['epub', opts.epub ? '1' : '0'],
  ];
  if (opts.token) params.push(['token', String(opts.token)]);
  return fullBase + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

// 解析 batch_full 响应，返回 { itemId: { title, content } }。
function parseBatchPayload(payload) {
  const out = {};
  const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data || typeof data !== 'object') return out;
  for (const [cid, info] of Object.entries(data)) {
    if (!info || typeof info !== 'object') continue;
    const content = info.content || info.chapter_content || info.text || '';
    const title = info.title || info.origin_chapter_title || '';
    if (content) out[String(cid)] = { title, content };
  }
  return out;
}

/**
 * 批量拉取章节正文（含付费/锁定章节）。
 * @param {string[]|string} itemIds
 * @param {HttpClient} http
 * @param {{base:string, token?:string, epub?:boolean}} opts
 * @returns {Promise<{[itemId:string]: {title, contentHtml, paragraphs, text, mode, residual}}>}
 */
async function fetchChaptersBatch(itemIds, http, opts = {}) {
  const base = normalizeBatchBase(opts.base);
  if (!base) throw new Error('正文源地址为空');
  const ids = (Array.isArray(itemIds) ? itemIds : [itemIds])
    .map((s) => String(s))
    .filter((s) => /^\d+$/.test(s));
  if (!ids.length) return {};

  const url = buildBatchUrl(base, ids.join(','), opts);
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const response = await http.fetchText(url, { headers });
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`正文源返回 HTTP ${response.status}`);
  }
  let payload;
  try {
    payload = JSON.parse(response.text);
  } catch (e) {
    throw new Error(`正文源响应不是合法 JSON：${e.message}`);
  }
  const map = parseBatchPayload(payload);
  if (!Object.keys(map).length) throw new Error('正文源响应中没有正文数据');

  const decoded = {};
  for (const [cid, { title, content }] of Object.entries(map)) {
    const d = decodeChapterContent(content);
    decoded[cid] = { title, contentHtml: content, paragraphs: d.paragraphs, text: d.text, mode: d.mode, residual: d.residual };
  }
  return decoded;
}

/**
 * 连通性探测：不抛异常，返回 { ok, message }。
 * 用真实章节 itemId 探测能验证“能否取回正文”；没有真实 ID 时用占位 ID，仅验证端点可达 + 返回合法 JSON。
 * @param {{base:string, token?:string, probeItemIds?:string[]|string, epub?:boolean}} opts
 * @param {HttpClient} http
 * @returns {Promise<{ok:boolean, message:string}>}
 */
async function probeBatchSource(opts, http) {
  const base = normalizeBatchBase(opts.base);
  if (!base) return { ok: false, message: '正文源地址为空' };
  const rawIds = Array.isArray(opts.probeItemIds) ? opts.probeItemIds : [opts.probeItemIds];
  const ids = rawIds.map((s) => String(s || '')).filter((s) => /^\d+$/.test(s));
  const probe = ids.length ? ids : ['0'];

  const url = buildBatchUrl(base, probe.join(','), opts);
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let response;
  try {
    response = await http.fetchText(url, { headers });
  } catch (e) {
    return { ok: false, message: `无法连接：${e.message}` };
  }
  if (response.status < 200 || response.status >= 400) {
    return { ok: false, message: `正文源返回 HTTP ${response.status}` };
  }
  let payload;
  try {
    payload = JSON.parse(response.text);
  } catch (e) {
    return { ok: false, message: `响应不是合法 JSON：${e.message}` };
  }
  const map = parseBatchPayload(payload);
  const n = Object.keys(map).length;
  if (n > 0) {
    return { ok: true, message: `连接成功，取回 ${n} 章正文` };
  }
  return {
    ok: true,
    message: '端点可访问（HTTP 200 + 合法 JSON），但探测章节未返回正文（可能是探测 ID 无效，或该源不含此章节）',
  };
}

module.exports = { BASE, HttpClient, extractInitialState, parseState, parseDirectoryData, fetchChapterDirectory, parseBookId, parseChapterId, resolveBookId, getBook, getChapter, normalizeBatchBase, buildBatchUrl, parseBatchPayload, fetchChaptersBatch, probeBatchSource };
