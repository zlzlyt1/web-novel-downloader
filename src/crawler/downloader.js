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

function selectChapterRange(chapters, startChapter = 1, endChapter = 0) {
  const source = Array.isArray(chapters) ? chapters : [];
  const startIdx = Math.max(0, Math.min((Number(startChapter) || 1) - 1, source.length));
  const endIdx = Number(endChapter)
    ? Math.max(startIdx, Math.min(Number(endChapter), source.length))
    : source.length;
  return source.slice(startIdx, endIdx);
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

    return this._downloadMetas(book, useFanqie, selectChapterRange(book.chapters, this.startChapter, this.endChapter));
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
    const rangedChapters = selectChapterRange(book.chapters, this.startChapter, this.endChapter);
    const metas = rangedChapters.filter((chapter) => {
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
    const chapters = [];
    const failed = [];

    for (let i = 0; i < metas.length; i++) {
      if (this.isCancelled()) throw new Error('已取消');
      const meta = metas[i];
      const done = i + 1;

      // 无法公开读取的章节直接跳过。
      const locked = meta.isChapterLock || meta.isPaidPublication || meta.isPaidStory || meta.needPay;
      if (locked) {
        chapters.push({ ...meta, locked: true, paragraphs: [], text: '' });
        this._report({ stage: 'chapter', done, total, current: meta.title, bookName: book.bookName, message: `跳过付费/锁定章节：${meta.title}` });
        continue;
      }

      // 网页逐章读取。
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
}

module.exports = { Downloader, isFanqieUrl, getBookFromUrl, chapterKey, selectChapterRange };
