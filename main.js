// Electron 主进程：窗口管理、IPC、抓取编排。
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { Downloader, getBookFromUrl } = require('./src/crawler/downloader');
const { saveTxt, safeFileName } = require('./src/crawler/txt');
const { loadLibraryMeta, saveLibraryMeta, createLibraryMeta, appendTxtChapters, mergeNewChapters } = require('./src/crawler/library');
const { searchBooks } = require('./src/search/web-search');

const APP_ID = 'com.zhangluyintao.web-novel-downloader';
const APP_NAME = '全网小说下载器';
app.setName(APP_NAME);

let mainWindow = null;
let readerWindow = null;
let activeDownloader = null;
let cancelFlag = false;
let currentReaderFile = null;
let readerBooks = [];
let currentTheme = 'light'; // 'light' | 'dark'

// 阅读器状态持久化（记住上次打开的书籍），跨启动保存到 userData。
function readerStateFile() {
  return path.join(app.getPath('userData'), 'reader-state.json');
}
function loadReaderState() {
  try {
    const data = JSON.parse(fs.readFileSync(readerStateFile(), 'utf8'));
    currentReaderFile = data.lastFile || null;
    readerBooks = Array.isArray(data.books) ? data.books.filter((book) => book && typeof book.filePath === 'string') : [];
  } catch (_) { currentReaderFile = null; readerBooks = []; }
}
function saveReaderState() {
  try {
    fs.mkdirSync(path.dirname(readerStateFile()), { recursive: true });
    fs.writeFileSync(readerStateFile(), JSON.stringify({ lastFile: currentReaderFile, books: readerBooks }, null, 2));
  } catch (_) {}
}

function touchReaderBook({ filePath, title, chapterCount } = {}) {
  if (!filePath || typeof filePath !== 'string') return false;
  const existing = readerBooks.find((book) => book.filePath === filePath);
  const safeTitle = String(title || path.basename(filePath)).trim().slice(0, 160) || path.basename(filePath);
  const safeCount = Number.isFinite(Number(chapterCount)) ? Math.max(0, Math.floor(Number(chapterCount))) : 0;
  const next = {
    filePath,
    title: safeTitle,
    chapterCount: safeCount,
    lastOpened: new Date().toISOString(),
  };
  readerBooks = [next, ...readerBooks.filter((book) => book.filePath !== filePath)].slice(0, 200);
  currentReaderFile = filePath;
  saveReaderState();
  return true;
}

// 标题栏（窗口控制按钮区域）颜色，随主题切换。
const THEME_OVERLAY = {
  light: { color: '#e84c3d', symbolColor: '#ffffff', height: 56 },
  dark: { color: '#2a2a2e', symbolColor: '#ffffff', height: 56 },
};

// 阅读器标题栏颜色，随阅读器主题（浅色/羊皮纸/深色）切换，与顶栏 panel 色一致。
const READER_OVERLAY = {
  light: { color: '#f5f6f8', symbolColor: '#2b2b2b', height: 50 },
  sepia: { color: '#ece3d3', symbolColor: '#4a3f2f', height: 50 },
  dark: { color: '#2c2c2e', symbolColor: '#d5d5d7', height: 50 },
};
const READER_BG = { light: '#ffffff', sepia: '#f5f0e6', dark: '#1c1c1e' };

function applyThemeToWindows(theme) {
  currentTheme = theme === 'dark' ? 'dark' : 'light';
  nativeTheme.themeSource = currentTheme;
  const ov = THEME_OVERLAY[currentTheme];
  if (mainWindow && mainWindow.setTitleBarOverlay) mainWindow.setTitleBarOverlay(ov);
}

function defaultOutDir() {
  return path.join(app.getPath('documents'), '全网小说');
}

function normalizeSourceUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch (_) { return String(rawUrl || '').trim(); }
}

function isSameStoredBook(meta, sourceUrl, book) {
  if (!meta) return false;
  if (meta.bookId && book?.bookId && String(meta.bookId) === String(book.bookId)) return true;
  return normalizeSourceUrl(meta.sourceUrl) === normalizeSourceUrl(sourceUrl);
}

function availableTxtPath(outDir, bookName) {
  const base = safeFileName(bookName);
  let n = 1;
  let filePath = path.join(outDir, `${base}.txt`);
  while (fs.existsSync(filePath)) filePath = path.join(outDir, `${base} (${++n}).txt`);
  return filePath;
}

function findStoredBookFile(outDir, sourceUrl, book) {
  const defaultPath = path.join(outDir, `${safeFileName(book.bookName)}.txt`);
  if (fs.existsSync(defaultPath)) {
    const meta = loadLibraryMeta(defaultPath);
    if (isSameStoredBook(meta, sourceUrl, book)) return { filePath: defaultPath, meta };
  }
  try {
    for (const name of fs.readdirSync(outDir)) {
      if (!name.endsWith('.txt.novel-meta.json')) continue;
      const filePath = path.join(outDir, name.slice(0, -'.novel-meta.json'.length));
      if (!fs.existsSync(filePath)) continue;
      const meta = loadLibraryMeta(filePath);
      if (isSameStoredBook(meta, sourceUrl, book)) return { filePath, meta };
    }
  } catch (_) {}
  return null;
}

// 用户设置（正文源等）持久化到 userData/settings.json。
// 采用“内存热配置”：启动时惰性加载到 liveSettings，saveSettings 同时更新内存与磁盘，
// 后续所有读取（下载、探测、getConfig）都直接取内存中的最新值，无需重启即可生效。
let liveSettings = null;
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch (_) {
    return {};
  }
}
function getSettings() {
  if (liveSettings === null) liveSettings = loadSettings();
  return liveSettings;
}
function saveSettings(patch) {
  const next = { ...getSettings(), ...(patch && typeof patch === 'object' ? patch : {}) };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  liveSettings = next;
  return next;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 680,
    minWidth: 320,
    minHeight: 260,
    useContentSize: true,
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'app.ico'),
    backgroundColor: currentTheme === 'dark' ? '#1c1c1e' : '#f5f6f8',
    titleBarStyle: 'hidden',
    titleBarOverlay: THEME_OVERLAY[currentTheme],
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachEditableContextMenu(mainWindow);
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createReaderWindow() {
  if (readerWindow) {
    readerWindow.focus();
    return readerWindow;
  }
  readerWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 280,
    minHeight: 240,
    title: '阅读器',
    icon: path.join(__dirname, 'build', 'app.ico'),
    backgroundColor: READER_BG.sepia,
    titleBarStyle: 'hidden',
    titleBarOverlay: READER_OVERLAY.sepia,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachEditableContextMenu(readerWindow);
  readerWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'reader.html'));
  readerWindow.on('closed', () => { readerWindow = null; });
  return readerWindow;
}

// Electron 自定义应用菜单后，输入框不会自动显示 Chromium 默认右键菜单；
// 为可编辑元素补回常用的文本编辑操作。
function attachEditableContextMenu(window) {
  window.webContents.on('context-menu', (event, params) => {
    if (!params.isEditable) return;
    event.preventDefault();
    const menu = Menu.buildFromTemplate([
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ]);
    menu.popup({ window });
  });
}

// ---- IPC ----

ipcMain.handle('app:getDefaultOutDir', () => defaultOutDir());

ipcMain.handle('config:get', () => ({ ok: true, config: getSettings() }));

ipcMain.handle('config:set', (event, patch) => {
  try {
    return { ok: true, config: saveSettings(patch) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// 测试正文源连通性：用已加载书籍的首个章节 ID 探测；没有则用占位 ID 只验证端点可达。
ipcMain.handle('config:testContentApi', async (event, { probeItemIds } = {}) => {
  try {
    const settings = getSettings();
    const url = (settings.contentApiUrl || '').trim();
    if (!url) return { ok: false, message: '请先填写并保存正文源地址' };
    const { HttpClient } = require('./src/crawler/http');
    const { probeBatchSource } = require('./src/crawler/fanqie');
    const http = new HttpClient({ minInterval: 0, timeoutMs: 12000, maxRetries: 1 });
    const ids = Array.isArray(probeItemIds)
      ? probeItemIds.filter((s) => s)
      : (probeItemIds ? [probeItemIds] : []);
    return await probeBatchSource(
      { base: url, token: settings.contentApiToken || '', probeItemIds: ids },
      http
    );
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
});

ipcMain.handle('app:setTheme', (event, theme) => {
  applyThemeToWindows(theme);
  return true;
});

ipcMain.handle('app:setReaderTheme', (event, theme) => {
  const key = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'sepia';
  const ov = READER_OVERLAY[key];
  if (readerWindow && readerWindow.setTitleBarOverlay) readerWindow.setTitleBarOverlay(ov);
  if (readerWindow && readerWindow.setBackgroundColor) readerWindow.setBackgroundColor(READER_BG[key]);
  return true;
});

ipcMain.handle('dialog:chooseDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:chooseFile', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: '文本 / Markdown 文件', extensions: ['txt', 'md', 'markdown'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('crawl:getBook', async (event, url) => {
  try {
    const { HttpClient } = require('./src/crawler/http');
    const book = await getBookFromUrl(url, new HttpClient({ cacheDir: path.join(app.getPath('userData'), 'cache') }));
    return { ok: true, book };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('search:books', async (event, query) => {
  try {
    const data = await searchBooks(query, { limit: 15 });
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message || String(e), results: [] };
  }
});

ipcMain.handle('crawl:start', async (event, { url, outDir, startChapter, endChapter, maxChapters }) => {
  cancelFlag = false;
  const settings = getSettings();
  const outputDir = outDir || defaultOutDir();
  activeDownloader = new Downloader({
    minInterval: 700,
    startChapter: startChapter || 1,
    endChapter: endChapter || 0,
    maxChapters: maxChapters || 0,
    contentApiUrl: settings.contentApiUrl || '',
    contentApiToken: settings.contentApiToken || '',
    cacheDir: path.join(app.getPath('userData'), 'cache'),
    onProgress: (p) => {
      if (event.sender && !event.sender.isDestroyed()) event.sender.send('crawl:progress', p);
    },
    isCancelled: () => cancelFlag,
  });
  try {
    // 预先读取目录，定位该书的已有 TXT。匹配时走增量下载，避免重复抓取与覆盖。
    const { HttpClient } = require('./src/crawler/http');
    const indexedBook = await getBookFromUrl(url, new HttpClient({ cacheDir: path.join(app.getPath('userData'), 'cache') }));
    const defaultPath = path.join(outputDir, `${safeFileName(indexedBook.bookName)}.txt`);
    const stored = findStoredBookFile(outputDir, url, indexedBook);
    if (stored) {
      const { filePath, meta: storedMeta } = stored;
      const existingKeys = (storedMeta.chapters || []).map((chapter) => chapter.key).filter(Boolean);
      const { book, chapters, failed } = await activeDownloader.downloadNew(url, existingKeys);
      if (!chapters.length) {
        return { ok: true, book, chapterCount: 0, failedCount: 0, residual: 0, filePath, skippedDuplicate: true };
      }
      const lastVolume = appendTxtChapters(filePath, chapters, storedMeta.lastVolume || '');
      const nextMeta = mergeNewChapters(storedMeta, chapters);
      nextMeta.bookName = book.bookName || storedMeta.bookName || '';
      nextMeta.bookId = String(book.bookId || storedMeta.bookId || '');
      nextMeta.lastVolume = lastVolume;
      saveLibraryMeta(filePath, nextMeta);
      const residual = chapters.reduce((n, c) => n + (c.residual || 0), 0);
      return { ok: true, book, chapterCount: chapters.length, failedCount: failed.length, residual, filePath, appended: true };
    }
    const { book, chapters, failed } = await activeDownloader.download(url);
    // 同名但来源不同或旧文件无来源记录时，使用新文件名，绝不覆盖原书。
    const filePath = fs.existsSync(defaultPath) ? availableTxtPath(outputDir, book.bookName) : saveTxt(book, chapters, outputDir);
    if (filePath !== defaultPath) saveTxt(book, chapters, outputDir, path.basename(filePath));
    saveLibraryMeta(filePath, createLibraryMeta(filePath, url, book, chapters));
    const residual = chapters.reduce((n, c) => n + (c.residual || 0), 0);
    return { ok: true, book, chapterCount: chapters.length, failedCount: failed.length, residual, filePath };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    activeDownloader = null;
  }
});

ipcMain.on('crawl:cancel', () => { cancelFlag = true; });

ipcMain.handle('file:readText', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, name: path.basename(filePath), path: filePath, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('file:listTxts', (event, dir) => {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.txt'))
      .map((f) => {
        const filePath = path.join(dir, f);
        const meta = loadLibraryMeta(filePath);
        return {
          name: f,
          path: filePath,
          chapterCount: Math.max(meta?.chapters?.length || 0, countTxtChapters(filePath)),
          hasUpdateSource: Boolean(meta?.sourceUrl),
        };
      })
      .sort((a, b) => fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs);
    return { ok: true, files };
  } catch (e) {
    return { ok: false, files: [], error: e.message };
  }
});

ipcMain.handle('shell:reveal', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('shell:openExternal', async (event, rawUrl) => {
  try {
    const url = new URL(String(rawUrl || ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅允许打开 HTTP/HTTPS 链接');
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('reader:open', (event, filePath) => {
  // 传入具体文件则记住它；传入 null（顶栏/菜单的“打开阅读器”）保留上次的书籍。
  if (filePath) { currentReaderFile = filePath; saveReaderState(); }
  createReaderWindow();
  return true;
});

ipcMain.handle('reader:getFile', () => currentReaderFile);

ipcMain.handle('reader:setFile', (event, filePath) => {
  currentReaderFile = filePath;
  saveReaderState();
  return true;
});

ipcMain.handle('reader:touchBook', (event, book) => ({ ok: touchReaderBook(book) }));

ipcMain.handle('reader:listBooks', () => ({
  ok: true,
  books: readerBooks.map((book) => ({ ...book, missing: !fs.existsSync(book.filePath) })),
}));

// 仅从书架移除记录，不删除用户的 TXT / Markdown 文件。
ipcMain.handle('reader:removeBook', (event, filePath) => {
  const before = readerBooks.length;
  readerBooks = readerBooks.filter((book) => book.filePath !== filePath);
  if (currentReaderFile === filePath) currentReaderFile = null;
  if (readerBooks.length !== before) saveReaderState();
  return { ok: true };
});

// 下载器手动续传：用户指定目标章数，只追加该范围内尚未保存的章节。
function countTxtChapters(filePath) {
  try {
    return (fs.readFileSync(filePath, 'utf8').match(/^第\s*[0-9一二三四五六七八九十百千万零]+\s*[章节回]/gm) || []).length;
  } catch (_) { return 0; }
}

ipcMain.handle('library:update', async (event, { filePath, sourceUrl, endChapter } = {}) => {
  if (!filePath || !/\.txt$/i.test(filePath)) return { ok: false, error: '仅支持更新由本应用下载的 TXT 书籍' };
  if (!fs.existsSync(filePath)) return { ok: false, error: '书籍文件不存在或已被移动' };
  const requestedEnd = Math.floor(Number(endChapter));
  if (!Number.isFinite(requestedEnd) || requestedEnd < 1) return { ok: false, error: '请输入有效的目标章节数' };
  let meta = loadLibraryMeta(filePath);
  let existingCount = Math.max(meta?.chapters?.length || 0, countTxtChapters(filePath));
  if (requestedEnd <= existingCount) {
    return { ok: true, added: 0, currentCount: existingCount, message: `当前已有 ${existingCount} 章，请输入更大的目标章数` };
  }
  let migrated = false;
  if (!meta?.sourceUrl && !String(sourceUrl || '').trim()) {
    return { ok: false, needsSource: true, currentCount: existingCount, error: '此书没有下载来源记录' };
  }
  if (!meta?.sourceUrl) {
    try {
      const { HttpClient } = require('./src/crawler/http');
      const sourceBook = await getBookFromUrl(String(sourceUrl).trim(), new HttpClient({ cacheDir: path.join(app.getPath('userData'), 'cache') }));
      if (!existingCount) return { ok: false, error: '未能从此 TXT 识别章节标题，无法安全迁移更新记录' };
      meta = createLibraryMeta(filePath, String(sourceUrl).trim(), sourceBook, sourceBook.chapters.slice(0, existingCount));
      migrated = true;
    } catch (e) {
      return { ok: false, error: `无法识别来源目录：${e.message || String(e)}` };
    }
  }
  if (activeDownloader) return { ok: false, error: '已有下载任务正在进行，请稍后再试' };

  cancelFlag = false;
  const settings = getSettings();
  activeDownloader = new Downloader({
    minInterval: 700,
    startChapter: existingCount + 1,
    endChapter: requestedEnd,
    contentApiUrl: settings.contentApiUrl || '',
    contentApiToken: settings.contentApiToken || '',
    cacheDir: path.join(app.getPath('userData'), 'cache'),
    onProgress: (progress) => {
      if (event.sender && !event.sender.isDestroyed()) event.sender.send('library:updateProgress', progress);
    },
    isCancelled: () => cancelFlag,
  });
  try {
    const existingKeys = (meta.chapters || []).map((chapter) => chapter.key).filter(Boolean);
    const { book, chapters, failed } = await activeDownloader.downloadNew(meta.sourceUrl, existingKeys);
    if (!chapters.length) {
      if (migrated) saveLibraryMeta(filePath, meta);
      const message = requestedEnd > book.chapters.length
        ? `来源目录当前只有 ${book.chapters.length} 章，没有可追加章节`
        : `目标范围内没有新章节，当前已有 ${existingCount} 章`;
      return { ok: true, added: 0, failed: 0, currentCount: existingCount, availableCount: book.chapters.length, message, migrated };
    }
    const lastVolume = appendTxtChapters(filePath, chapters, meta.lastVolume || '');
    const nextMeta = mergeNewChapters(meta, chapters);
    nextMeta.bookName = book.bookName || meta.bookName || '';
    nextMeta.lastVolume = lastVolume;
    saveLibraryMeta(filePath, nextMeta);
    return {
      ok: true,
      added: chapters.length,
      failed: failed.length,
      migrated,
      currentCount: nextMeta.chapters.length,
      availableCount: book.chapters.length,
      message: `已追加 ${chapters.length} 个新章节，当前记录 ${nextMeta.chapters.length} 章`,
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    activeDownloader = null;
  }
});

// 构建中文应用菜单（替换默认的英文 File/Edit/View 菜单）。
function buildAppMenu() {
  const viewItems = [
    { role: 'reload', label: '重新加载' },
    { type: 'separator' },
    { role: 'resetzoom', label: '实际大小' },
    { role: 'zoomin', label: '放大' },
    { role: 'zoomout', label: '缩小' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: '切换全屏' },
  ];
  if (!app.isPackaged) {
    viewItems.splice(1, 0,
      { role: 'forcereload', label: '强制重新加载' },
      { role: 'toggledevtools', label: '开发者工具' });
  }
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开阅读器', click: () => { createReaderWindow(); } },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectall', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: viewItems,
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  app.setAppUserModelId(APP_ID);
  loadReaderState();
  buildAppMenu();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
