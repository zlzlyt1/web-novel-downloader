// 主界面逻辑
const $ = (id) => document.getElementById(id);

let currentBookId = null;
let currentBook = null; // 最近一次 fetchBook 的完整书籍对象（含 chapters，供正文源探测取首章 ID）
let outDir = '';
let lookupDir = ''; // 已下载书籍的查找目录，空 = 使用保存目录
let lastSearchUrl = '';

// ---- 主题 ----
function getTheme() {
  try { return localStorage.getItem('dl-theme') || 'light'; } catch (_) { return 'light'; }
}
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const dark = theme === 'dark';
  $('iconMoon').classList.toggle('hidden', dark);
  $('iconSun').classList.toggle('hidden', !dark);
  $('btnTheme').title = dark ? '切换到浅色模式' : '切换到深色模式';
  window.api.setTheme(theme);
}
function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('dl-theme', next); } catch (_) {}
  applyTheme(next);
}

async function init() {
  outDir = await window.api.getDefaultOutDir();
  $('outDir').value = outDir;
  $('lookupDir').value = '';
  applyTheme(getTheme());
  try {
    const cfgRes = await window.api.getConfig();
    if (cfgRes && cfgRes.ok && cfgRes.config) {
      $('contentApiUrl').value = cfgRes.config.contentApiUrl || '';
      $('contentApiToken').value = cfgRes.config.contentApiToken || '';
    }
  } catch (_) {}
  refreshList();
}

async function saveContentApi() {
  const status = $('contentApiStatus');
  const button = $('btnSaveContentApi');
  button.disabled = true;
  status.className = 'search-status';
  status.textContent = '保存中…';
  const res = await window.api.setConfig({
    contentApiUrl: $('contentApiUrl').value.trim(),
    contentApiToken: $('contentApiToken').value.trim(),
  });
  button.disabled = false;
  if (res && res.ok) {
    status.className = 'search-status success';
    status.textContent = '已保存（下载时将自动启用）';
  } else {
    status.className = 'search-status error';
    status.textContent = '保存失败：' + ((res && res.error) || '未知错误');
  }
}

async function testContentApi() {
  const status = $('contentApiStatus');
  const button = $('btnTestContentApi');
  button.disabled = true;
  status.className = 'search-status';
  status.textContent = '测试中…';
  // 优先用已加载书籍的首个章节 ID 探测；否则用占位 ID 仅验证端点可达。
  const probeItemIds = (currentBook && currentBook.chapters && currentBook.chapters.length)
    ? [currentBook.chapters[0].itemId]
    : [];
  const res = await window.api.testContentApi({ probeItemIds });
  button.disabled = false;
  if (res && res.ok) {
    status.className = 'search-status success';
    status.textContent = res.message || '正文源可用';
  } else {
    status.className = 'search-status error';
    status.textContent = (res && res.message) || '测试失败';
  }
}

async function refreshList() {
  const dir = lookupDir || outDir;
  const res = await window.api.listTxts(dir);
  const ul = $('bookList');
  ul.innerHTML = '';
  if (!res.ok || !res.files.length) {
    ul.innerHTML = `<li class="empty">${lookupDir ? '该目录下未找到 txt 书籍' : '暂无已下载的书籍'}</li>`;
    return;
  }
  for (const f of res.files) {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = f.name.replace(/\.txt$/i, '');
    const ops = document.createElement('span');
    ops.className = 'ops';
    const readBtn = document.createElement('button');
    readBtn.className = 'btn';
    readBtn.textContent = '阅读';
    readBtn.onclick = () => window.api.openReader(f.path);
    ops.appendChild(readBtn);
    li.appendChild(nameSpan);
    li.appendChild(ops);
    ul.appendChild(li);
  }
}

function makeButton(label, className, onClick) {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderSearchResults(results) {
  const list = $('searchResults');
  list.innerHTML = '';
  list.classList.toggle('hidden', !results.length);

  for (const result of results) {
    const item = document.createElement('li');
    item.className = 'search-result';

    const info = document.createElement('div');
    info.className = 'search-result-info';
    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = result.title;
    const meta = document.createElement('div');
    meta.className = 'search-result-meta';
    const source = document.createElement('span');
    source.className = 'search-source';
    source.textContent = result.source || result.domain || '其他网站';
    meta.appendChild(source);
    if (result.domain) {
      const domain = document.createElement('span');
      domain.textContent = result.domain;
      meta.appendChild(domain);
    }
    info.appendChild(title);
    info.appendChild(meta);
    if (result.description) {
      const desc = document.createElement('div');
      desc.className = 'search-result-desc';
      desc.textContent = result.description;
      info.appendChild(desc);
    }

    const actions = document.createElement('div');
    actions.className = 'search-result-actions';
    if (result.canDownload) {
      actions.appendChild(makeButton('载入下载器', 'btn primary compact', async () => {
        $('url').value = result.url;
        await fetchBook();
        $('bookCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }));
    }
    actions.appendChild(makeButton('打开网页', 'btn compact', () => window.api.openExternal(result.url)));

    item.appendChild(info);
    item.appendChild(actions);
    list.appendChild(item);
  }
}

async function searchByTitle() {
  const query = $('searchTitle').value.trim();
  if (!query) return alert('请输入要搜索的书名');
  const button = $('btnSearch');
  const status = $('searchStatus');
  button.disabled = true;
  button.textContent = '搜索中…';
  status.textContent = '正在搜索全网，请稍候…';
  status.className = 'search-status';
  $('searchResults').classList.add('hidden');
  $('searchFooter').classList.add('hidden');

  const response = await window.api.searchBooks(query);
  button.disabled = false;
  button.textContent = '搜索网络';
  if (!response.ok) {
    status.textContent = '搜索失败：' + (response.error || '网络异常');
    status.className = 'search-status error';
    renderSearchResults([]);
    return;
  }

  lastSearchUrl = response.searchUrl || '';
  renderSearchResults(response.results || []);
  $('searchFooter').classList.toggle('hidden', !lastSearchUrl);
  if (response.results && response.results.length) {
    status.textContent = `找到 ${response.results.length} 条网络结果，均可尝试载入下载器。`;
    status.className = 'search-status success';
  } else {
    status.textContent = '没有解析到结果，可以在浏览器继续查看完整搜索页。';
    status.className = 'search-status';
  }
}

async function fetchBook() {
  const url = $('url').value.trim();
  if (!url) return alert('请先粘贴书籍页链接');
  $('btnFetch').disabled = true;
  $('btnFetch').textContent = '获取中…';
  const res = await window.api.getBook(url);
  $('btnFetch').disabled = false;
  $('btnFetch').textContent = '获取信息';
  if (!res.ok) return alert('获取失败：' + (res.error || '未知错误'));
  const b = res.book;
  currentBook = b;
  currentBookId = b.bookId;
  $('bookName').textContent = b.bookName;
  $('bookAuthor').textContent = '作者：' + (b.author || '—');
  $('bookCategory').textContent = '分类：' + (b.category || '—');
  $('bookChapters').textContent = '章数：' + (b.chapterTotal || b.chapters.length);
  $('bookWords').textContent = '字数：' + (b.wordNumber ? b.wordNumber.toLocaleString() : '—');
  $('bookStatus').textContent = '状态：' + (b.status == 2 ? '已完结' : '连载中');
  $('bookDesc').textContent = b.description || '（无简介）';
  $('bookCard').classList.remove('hidden');
  $('btnDownload').disabled = false;
}

async function startDownload() {
  const url = $('url').value.trim();
  if (!url) return alert('请先粘贴书籍页链接');
  const startChapter = parseInt($('startChapter').value, 10) || 1;
  const endChapter = parseInt($('endChapter').value, 10) || 0;
  if (endChapter && endChapter < startChapter) return alert('结束章节不能小于开始章节');
  $('btnDownload').disabled = true;
  $('btnCancel').classList.remove('hidden');
  $('progressWrap').classList.remove('hidden');
  $('result').classList.add('hidden');
  $('result').classList.remove('err');
  setProgress(0, '正在获取书籍信息…');

  window.api.onProgress((p) => {
    if (p.stage === 'book') {
      setProgress(0, p.message);
    } else if (p.stage === 'chapter') {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      setProgress(pct, p.message);
    }
  });

  const res = await window.api.startCrawl(url, outDir, startChapter, endChapter);
  $('btnDownload').disabled = false;
  $('btnCancel').classList.add('hidden');

  const resultEl = $('result');
  resultEl.classList.remove('hidden');
  const okIcon = '<svg class="r-icon ok" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>';
  const errIcon = '<svg class="r-icon err" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>';
  if (res.ok) {
    setProgress(100, '下载完成');
    resultEl.classList.remove('err');
    resultEl.innerHTML = `
      <div>${okIcon} 下载完成：《${res.book.bookName}》共 ${res.chapterCount} 章${res.failedCount ? `，失败 ${res.failedCount} 章` : ''}${res.residual ? `，残留未解密字符 ${res.residual} 个` : ''}</div>
      <div class="path">${res.filePath}</div>
      <div class="actions">
        <button class="btn primary" id="btnRead">打开阅读</button>
        <button class="btn" id="btnReveal">打开所在文件夹</button>
      </div>`;
    $('btnRead').onclick = () => window.api.openReader(res.filePath);
    $('btnReveal').onclick = () => window.api.reveal(res.filePath);
  } else {
    resultEl.classList.add('err');
    resultEl.innerHTML = `<div>${errIcon} 下载失败：${res.error || '未知错误'}</div>`;
  }
  refreshList();
}

function setProgress(pct, text) {
  $('progressFill').style.width = pct + '%';
  $('progressText').textContent = text;
}

window.addEventListener('DOMContentLoaded', () => {
  init();
  $('btnFetch').addEventListener('click', fetchBook);
  $('btnSaveContentApi').addEventListener('click', saveContentApi);
  $('btnTestContentApi').addEventListener('click', testContentApi);
  $('btnSearch').addEventListener('click', searchByTitle);
  $('btnDownload').addEventListener('click', startDownload);
  $('btnCancel').addEventListener('click', () => window.api.cancelCrawl());
  $('btnChooseDir').addEventListener('click', async () => {
    const dir = await window.api.chooseDir();
    if (dir) { outDir = dir; $('outDir').value = dir; refreshList(); }
  });
  $('btnRefreshList').addEventListener('click', refreshList);
  $('btnChooseLookupDir').addEventListener('click', async () => {
    const dir = await window.api.chooseDir();
    if (dir) { lookupDir = dir; $('lookupDir').value = dir; refreshList(); }
  });
  $('btnTheme').addEventListener('click', toggleTheme);
  $('btnOpenReader').addEventListener('click', () => window.api.openReader(null));
  $('btnOpenAllResults').addEventListener('click', () => { if (lastSearchUrl) window.api.openExternal(lastSearchUrl); });
  $('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchBook(); });
  $('searchTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchByTitle(); });
});
