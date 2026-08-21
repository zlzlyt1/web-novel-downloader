// 带限速、超时、重试的抓取封装。
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class HttpClient {
  /**
   * @param {object} opts
   * @param {string} [opts.userAgent]
   * @param {number} [opts.minInterval] 请求间最小间隔(ms)，默认 800
   * @param {number} [opts.maxRetries] 429/5xx/网络错误重试次数，默认 3
   * @param {number} [opts.timeoutMs] 单请求超时(ms)，默认 15000
   * @param {object} [opts.headers] 额外请求头
   */
  constructor(opts = {}) {
    this.userAgent = opts.userAgent || DEFAULT_UA;
    this.minInterval = opts.minInterval ?? 800;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.headers = { 'User-Agent': this.userAgent, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...(opts.headers || {}) };
    this.cacheDir = opts.cacheDir || '';
    this._lastRequest = 0;
  }

  async _throttle() {
    const now = Date.now();
    const wait = this._lastRequest + this.minInterval - now;
    if (wait > 0) await sleep(wait);
    this._lastRequest = Date.now();
  }

  /**
   * 抓取 URL，返回 { status, text }。429/5xx/网络错误自动退避重试。
   */
  _retryDelay(attempt, retryAfter) {
    const parsed = Number(retryAfter);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.min(parsed * 1000, 10000);
    return Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 350);
  }

  _cachePath(key) {
    if (!this.cacheDir) return '';
    const safe = String(key || '').replace(/[^a-z0-9._-]/gi, '_').slice(0, 160);
    return path.join(this.cacheDir, safe + '.json');
  }

  readJsonCache(key, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const file = this._cachePath(key);
    if (!file) return null;
    try {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { return null; }
  }

  writeJsonCache(key, value) {
    const file = this._cachePath(key);
    if (!file) return false;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(value), 'utf8');
      fs.renameSync(temp, file);
      return true;
    } catch (_) { return false; }
  }

  async fetchText(url, requestOptions = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this._throttle();
      try {
        const headers = { ...this.headers, ...(requestOptions.headers || {}) };
        const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(requestOptions.timeoutMs || this.timeoutMs) });
        if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
          lastErr = new Error('HTTP ' + res.status);
          if (attempt < this.maxRetries) await sleep(this._retryDelay(attempt, res.headers.get('retry-after')));
          continue;
        }
        const text = await res.text();
        return { status: res.status, text };
      } catch (e) {
        lastErr = e;
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
          if (attempt < this.maxRetries) await sleep(this._retryDelay(attempt));
          continue;
        }
        // 网络错误
        if (attempt < this.maxRetries) await sleep(this._retryDelay(attempt));
        continue;
      }
    }
    throw lastErr || new Error('fetch failed: ' + url);
  }

  async fetchBuffer(url, requestOptions = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this._throttle();
      try {
        const headers = { ...this.headers, ...(requestOptions.headers || {}) };
        const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(requestOptions.timeoutMs || this.timeoutMs) });
        if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
          lastErr = new Error('HTTP ' + res.status);
          if (attempt < this.maxRetries) await sleep(this._retryDelay(attempt, res.headers.get('retry-after')));
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        return { status: res.status, buffer: buf };
      } catch (e) {
        lastErr = e;
        if (attempt < this.maxRetries) await sleep(this._retryDelay(attempt));
      }
    }
    throw lastErr || new Error('fetch failed: ' + url);
  }
}

module.exports = { HttpClient, DEFAULT_UA, sleep };
