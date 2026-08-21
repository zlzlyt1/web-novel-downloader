// 整本书下载编排：目录 → 逐章抓取 → 反混淆 → 组装。
const { HttpClient } = require('./http');
const fanqie = require('./fanqie');
const generic = require('./generic');

function isFanqieUrl(rawUrl) {
  try {
    const host = new URL(String(rawUrl || '')).hostname.toLowerCase();
    return host === 'fanqienovel.com' || host.endsWith('.fanqienovel.com');
  } catch (_) { return false; }
}

// 用稳定的站点章节标识去重：番茄用 itemId，通用站点用章节 URL。
function chapterKey(chapter) {
  return String(chapter?.itemId || chapter?.url || '').trim();
}

async function getBookFromUrl(url, http) {
  if (!isFanqieUrl(url)) return generic.getBook(url, http);
  const bookId = await fanqie.resolveBookId(url, http);
  if (!bookId) throw new Error('无法从番茄链接识别书籍 ID（支持 /page/ 书籍页与 /reader/ 阅读页）');
  return fanqie.getBook(bookId, http);
}

class Downloader {
  /**
   * @param {object} opts
   * @param {number} [opts.minInterval] 请求间隔 ms
   * @param {number} [opts.startChapter] 起始章节（1 起），默认 1
   * @param {number} [opts.endChapter] 结束章节（含），默认 0 = 到最后一章
   * @param {number} [opts.maxChapters] 兼容：限定抓取前 N 章（会被转换成 endChapter）
   * @param {string} [opts.contentApiUrl] 第三方 batch_full 正文源地址（可选；配置后付费/锁定章节也走正文源拉取）
   * @param {string} [opts.contentApiToken] 正文源 token（可选；以 ?token= 与 Authorization 头附带）
   * @param {function} [opts.onProgress] ({done, total, current, bookName, stage, message}) => void
   * @param {function} [opts.isCancelled] () => boolean
   */
  constructor(opts = {}) {
    this.http = new HttpClient({ minInterval: opts.minInterval ?? 800, cacheDir: opts.cacheDir || '' });
    this.onProgress = opts.onProgress || (() => {});
    this.isCancelled = opts.isCancelled || (() => false);
    this.startChapter = opts.startChapter || 1;
    this.endChapter = opts.endChapter || 0; // 0 = 到最后一章
    if (opts.maxChapters) this.endChapter = this.endChapter ? Math.min(this.endChapter, opts.maxChapters) : opts.maxChapters;
    this.contentApiUrl = opts.contentApiUrl || '';
    this.contentApiToken = opts.contentApiToken || '';
  }

  _report(partial) {
    try { this.onProgress(partial); } catch (_) {}
  }

  /**
   * 下载指定章节范围。
   * @param {string} url 书籍页 / 阅读页 URL
   * @returns {Promise<{book, chapters:[{...ch, text, paragraphs}], failed:[...]}>}
   */
  async download(url) {
    this._report({ stage: 'book', message: '正在获取书籍信息…' });
    const useFanqie = isFanqieUrl(url);
    const book = await getBookFromUrl(url, this.http);
    this._report({ stage: 'book', bookName: book.bookName, message: `已获取《${book.bookName}》，共 ${book.chapters.length} 章` });

    const len = book.chapters.length;
    const startIdx = len ? Math.max(0, Math.min((this.startChapter || 1) - 1, len - 1)) : 0;
    const endIdx = this.endChapter ? Math.max(startIdx, Math.min(this.endChapter, len)) : len;
    return this._downloadMetas(book, useFanqie, book.chapters.slice(startIdx, endIdx));
  }

  /**
   * 仅下载目录中尚未保存过的章节。已有章节保持原文件内容不动。
   * @param {string} url 书籍目录页 URL
   * @param {Iterable<string>} existingKeys 已保存的章节 itemId / URL
   */
  async downloadNew(url, existingKeys = []) {
    this._report({ stage: 'book', message: '正在检查书籍更新…' });
    const useFanqie = isFanqieUrl(url);
    const book = await getBookFromUrl(url, this.http);
    const seen = new Set(Array.from(existingKeys, (key) => String(key || '').trim()).filter(Boolean));
    const metas = book.chapters.filter((chapter) => {
      const key = chapterKey(chapter);
      if (!key || seen.has(key)) return false;
      seen.add(key); // 目录自身出现重复链接时，也只下载一次。
      return true;
    });
    this._report({
      stage: 'book',
      bookName: book.bookName,
      message: metas.length ? `发现 ${metas.length} 个新章节，准备下载…` : `《${book.bookName}》已是最新`,
    });
    return this._downloadMetas(book, useFanqie, metas);
  }

  async _downloadMetas(book, useFanqie, metas) {
    const total = metas.length;

    // 番茄 + 配置了正文源：先批量预拉取正文（含付费/锁定章节）。
    let batchMap = {};
    if (useFanqie && this.contentApiUrl && metas.length) batchMap = await this._fetchBatch(metas, book);

    const chapters = [];
    const failed = [];

    for (let i = 0; i < metas.length; i++) {
      if (this.isCancelled()) throw new Error('已取消');
      const meta = metas[i];
      const done = i + 1;

      // 1) 正文源命中（含付费/锁定章节）→ 直接采用
      const batch = batchMap[meta.itemId];
      if (batch && (batch.text || (Array.isArray(batch.paragraphs) && batch.paragraphs.length))) {
        chapters.push({ ...meta, ...batch, locked: false });
        this._report({ stage: 'chapter', done, total, current: meta.title, bookName: book.bookName, message: `已完成 ${done}/${total}：${meta.title}（正文源）` });
        continue;
      }

      // 2) 未命中正文源且章节锁定 → 跳过
      const locked = meta.isChapterLock || meta.isPaidPublication || meta.isPaidStory || meta.needPay;
      if (locked) {
        chapters.push({ ...meta, locked: true, paragraphs: [], text: '' });
        this._report({ stage: 'chapter', done, total, current: meta.title, bookName: book.bookName, message: `跳过付费/锁定章节：${meta.title}` });
        continue;
      }

      // 3) 网页逐章回退
      try {
        const ch = useFanqie
          ? await fanqie.getChapter(meta.itemId, this.http)
          : await generic.getChapter(meta.url || meta.itemId, this.http);
        chapters.push({ ...meta, ...ch });
        this._report({ stage: 'chapter', done, total, current: meta.title, bookName: book.bookName, message: `已完成 ${done}/${total}：${meta.title}` });
      } catch (e) {
        failed.push({ ...meta, error: e.message });
        // 单章失败不中断，占位保留
        chapters.push({ ...meta, locked: true, paragraphs: [], text: '', error: e.message });
        this._report({ stage: 'chapter', done, total, current: meta.title, bookName: book.bookName, message: `章节失败：${meta.title}（${e.message}）` });
      }
    }

    return { book, chapters, failed, newChapterCount: chapters.length };
  }

  // 通过正文源批量预拉取章节正文；单批失败不中断，返回已命中的部分，未命中章节回退网页。
  async _fetchBatch(metas, book) {
    const ids = metas.map((chapter) => String(chapter.itemId)).filter(Boolean);
    const total = ids.length;
    const BATCH_SIZE = 20;
    const map = {};
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      if (this.isCancelled()) throw new Error('已取消');
      const chunk = ids.slice(i, i + BATCH_SIZE);
      this._report({ stage: 'chapter', done: i, total, current: book.bookName, bookName: book.bookName, message: `正文源预拉取 ${Math.min(i + chunk.length, total)}/${total} 章…` });
      try {
        const part = await fanqie.fetchChaptersBatch(chunk, this.http, { base: this.contentApiUrl, token: this.contentApiToken });
        Object.assign(map, part);
      } catch (e) {
        this._report({ stage: 'chapter', done: i, total, current: book.bookName, bookName: book.bookName, message: `正文源批次失败（将回退网页）：${e.message}` });
      }
    }
    return map;
  }
}

module.exports = { Downloader, isFanqieUrl, getBookFromUrl, chapterKey };
