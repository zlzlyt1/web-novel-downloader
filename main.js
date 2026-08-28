// Electron 主进程：窗口管理、IPC、抓取编排。
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ID = 'com.zhangluyintao.web-novel-downloader';
const APP_NAME = '全网小说下载器';
app.setName(APP_NAME);

let mainWindow = null;
let readerWindow = null;
let activeDownloader = null;
let cancelFlag = false;
let currentReaderFile = null;
let readerBooks = [];
let readerProgress = {};
let readerStateSaveTimer = null;
let currentTheme = 'light'; // 'light' | 'dark'
let updateCheckStarted = false;
const UPDATE_APPLY_FLAG = '--apply-update';

// 下载、搜索与电子书转换只会在用户触发相应操作后使用。延迟载入可缩短低配置电脑的首屏时间。
function crawler() { return require('./src/crawler/downloader'); }
function txtTools() { return require('./src/crawler/txt'); }
function libraryTools() { return require('./src/crawler/library'); }
function bookFormats() { return require('./src/formats/book-formats'); }
function searchTools() { return require('./src/search/web-search'); }

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getUpdateApplyArgs() {
  const flagIndex = process.argv.indexOf(UPDATE_APPLY_FLAG);
  if (flagIndex < 0) return null;
  const targetDir = path.resolve(String(process.argv[flagIndex + 1] || ''));
  const parentPid = Number(process.argv[flagIndex + 2]);
  if (!path.isAbsolute(targetDir) || !Number.isInteger(parentPid) || parentPid <= 0) return null;
  return { targetDir, parentPid };
}

function isProcessRunning(pid) {
  try { process.kill(pid, 0); return true; }
  catch (_) { return false; }
}

// 新版从临时目录启动后，等待旧进程退出，再覆盖原目录并重新启动正式程序。
async function applyDownloadedUpdate({ targetDir, parentPid }) {
  const sourceDir = path.dirname(process.execPath);
  if (path.resolve(sourceDir) === path.resolve(targetDir)) throw new Error('更新临时目录与程序目录相同');
  for (let attempt = 0; attempt < 300 && isProcessRunning(parentPid); attempt += 1) await wait(200);
  if (isProcessRunning(parentPid)) throw new Error('旧版本未能在 60 秒内退出');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true, errorOnExist: false });
  const installedExe = path.join(targetDir, path.basename(process.execPath));
  const { spawn } = require('child_process');
  spawn(installedExe, [], { cwd: targetDir, detached: true, stdio: 'ignore' }).unref();
}

// 阅读器状态持久化（记住上次打开的书籍），跨启动保存到 userData。
function readerStateFile() {
  return path.join(app.getPath('userData'), 'reader-state.json');
}
function readerProgressKey(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('zh-CN') : resolved;
}
function loadReaderState() {
  try {
    const data = JSON.parse(fs.readFileSync(readerStateFile(), 'utf8'));
    currentReaderFile = data.lastFile || null;
    readerBooks = Array.isArray(data.books) ? data.books.filter((book) => book && typeof book.filePath === 'string') : [];
    readerProgress = data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress) ? data.progress : {};
  } catch (_) { currentReaderFile = null; readerBooks = []; readerProgress = {}; }
}
function saveReaderState() {
  try {
    fs.mkdirSync(path.dirname(readerStateFile()), { recursive: true });
    fs.writeFileSync(readerStateFile(), JSON.stringify({ lastFile: currentReaderFile, books: readerBooks, progress: readerProgress }, null, 2));
  } catch (_) {}
}
function scheduleReaderStateSave() {
  if (readerStateSaveTimer) clearTimeout(readerStateSaveTimer);
  readerStateSaveTimer = setTimeout(() => {
    readerStateSaveTimer = null;
    saveReaderState();
  }, 350);
}

function updateReaderProgress({ filePath, chapter, scrollTop, scrollLeft, readingMode } = {}) {
  const key = readerProgressKey(filePath);
  const safeChapter = Math.max(0, Math.floor(Number(chapter)));
  const safeScrollTop = Math.max(0, Math.round(Number(scrollTop) || 0));
  const safeScrollLeft = Math.max(0, Math.round(Number(scrollLeft) || 0));
  const safeReadingMode = readingMode === 'paged' ? 'paged' : 'scroll';
  if (!key || !Number.isFinite(safeChapter)) return false;
  readerProgress[key] = {
    filePath: path.resolve(filePath),
    chapter: safeChapter,
    scrollTop: safeScrollTop,
    scrollLeft: safeScrollLeft,
    readingMode: safeReadingMode,
    updatedAt: new Date().toISOString(),
  };
  const keys = Object.keys(readerProgress);
  if (keys.length > 1000) {
    keys.sort((a, b) => String(readerProgress[b]?.updatedAt || '').localeCompare(String(readerProgress[a]?.updatedAt || '')))
      .slice(1000)
      .forEach((oldKey) => { delete readerProgress[oldKey]; });
  }
  scheduleReaderStateSave();
  return true;
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
  const base = txtTools().safeFileName(bookName);
  let n = 1;
  let filePath = path.join(outDir, `${base}.txt`);
  while (fs.existsSync(filePath)) filePath = path.join(outDir, `${base} (${++n}).txt`);
  return filePath;
}

function findStoredBookFile(outDir, sourceUrl, book) {
  const { safeFileName } = txtTools();
  const { loadLibraryMeta } = libraryTools();
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
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => { checkForAppUpdate(); }, 1200);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function compareVersions(candidate, current) {
  const parts = (value) => String(value || '').trim().replace(/^v/i, '').split(/[+-]/)[0]
    .split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(candidate);
  const right = parts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function findUpdateExecutable(rootDir) {
  const pending = [{ dir: rootDir, depth: 0 }];
  while (pending.length) {
    const { dir, depth } = pending.shift();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === `${APP_NAME}.exe`) return fullPath;
      if (entry.isDirectory() && depth < 2) pending.push({ dir: fullPath, depth: depth + 1 });
    }
  }
  return null;
}

async function sha256File(filePath) {
  const { createHash } = require('crypto');
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', resolve);
  });
  return hash.digest('hex');
}

async function downloadAndInstallUpdate(asset, latestVersion) {
  if (!asset?.browser_download_url) throw new Error('此版本没有可用的应用更新包');
  const workDir = path.join(app.getPath('temp'), `web-novel-downloader-update-${latestVersion}-${Date.now()}`);
  const zipPath = path.join(workDir, 'update.zip');
  const extractDir = path.join(workDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  const response = await fetch(asset.browser_download_url, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': APP_ID },
    redirect: 'follow',
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`更新包下载失败（HTTP ${response.status}）`);

  const total = Number(response.headers.get('content-length')) || Number(asset.size) || 0;
  let received = 0;
  const { Readable, Transform } = require('stream');
  const { pipeline } = require('stream/promises');
  const progress = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (mainWindow && !mainWindow.isDestroyed() && total > 0) mainWindow.setProgressBar(Math.min(received / total, 1));
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(zipPath));

  const expectedDigest = String(asset.digest || '').match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
  if (expectedDigest) {
    const actualDigest = await sha256File(zipPath);
    if (actualDigest !== expectedDigest) throw new Error('更新包校验失败，文件可能不完整');
  }

  const AdmZip = require('adm-zip');
  new AdmZip(zipPath).extractAllTo(extractDir, true);
  const stagedExe = findUpdateExecutable(extractDir);
  if (!stagedExe) throw new Error('更新包中未找到应用程序');
  const stagedDir = path.dirname(stagedExe);
  const targetDir = path.dirname(process.execPath);
  const { spawn } = require('child_process');
  spawn(stagedExe, [UPDATE_APPLY_FLAG, targetDir, String(process.pid)], {
    cwd: stagedDir,
    detached: true,
    stdio: 'ignore',
  }).unref();
  app.quit();
}

async function checkForAppUpdate() {
  if (!app.isPackaged || updateCheckStarted) return;
  updateCheckStarted = true;
  try {
    const response = await fetch('https://api.github.com/repos/zlzlyt1/web-novel-downloader/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': APP_ID },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/i, '');
    if (!latest || compareVersions(latest, app.getVersion()) <= 0 || !mainWindow || mainWindow.isDestroyed()) return;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => /轻量版.*\.zip$/i.test(String(item.name || '')))
      || assets.find((item) => /portable.*\.zip$/i.test(String(item.name || '')))
      || assets.find((item) => /\.zip$/i.test(String(item.name || '')));
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `发现全网小说下载器 ${latest}`,
      detail: `当前版本：${app.getVersion()}\n\n软件将在应用内下载安装，完成后自动重启。`,
      buttons: ['下载并自动安装', '稍后再说'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) {
      try {
        await downloadAndInstallUpdate(asset, latest);
      } catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setProgressBar(-1);
          await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '更新失败',
            message: '未能完成应用内更新',
            detail: error.message || String(error),
            buttons: ['确定'],
          });
        }
      }
    }
  } catch (_) {
    // 离线或 GitHub 暂不可用时静默跳过，不能影响正常启动。
  }
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
  const owner = BrowserWindow.getFocusedWindow() || readerWindow || mainWindow;
  const r = await dialog.showOpenDialog(owner, {
    properties: ['openFile'],
    filters: [{ name: '电子书', extensions: ['txt', 'md', 'markdown', 'epub'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('crawl:getBook', async (event, url) => {
  try {
    const { HttpClient } = require('./src/crawler/http');
    const book = await crawler().getBookFromUrl(url, new HttpClient({ cacheDir: path.join(app.getPath('userData'), 'cache') }));
    return { ok: true, book };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('search:books', async (event, query) => {
  try {
    const data = await searchTools().searchBooks(query, { limit: 15 });
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message || String(e), results: [] };
  }
});

ipcMain.handle('crawl:start', async (event, { url, outDir, startChapter, endChapter, maxChapters }) => {
  cancelFlag = false;
  const outputDir = outDir || defaultOutDir();
  activeDownloader = new (crawler().Downloader)({
    minInterval: 700,
    startChapter: startChapter || 1,
    endChapter: endChapter || 0,
    maxChapters: maxChapters || 0,
    cacheDir: path.join(app.getPath('userData'), 'cache'),
    onProgress: (p) => {
      if (event.sender && !event.sender.isDestroyed()) event.sender.send('crawl:progress', p);
    },
    isCancelled: () => cancelFlag,
  });
  try {
    // 预先读取目录，定位该书的已有 TXT。匹配时走增量下载，避免重复抓取与覆盖。
    const { HttpClient } = require('./src/crawler/http');
    const indexedBook = await crawler().getBookFromUrl(url, new HttpClient({ cacheDir: path.join(app.getPath('userData'), 'cache') }));
    const { safeFileName, saveTxt } = txtTools();
    const { appendTxtChapters, mergeNewChapters, saveLibraryMeta, createLibraryMeta } = libraryTools();
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
    if (path.extname(filePath).toLowerCase() === '.epub') {
      return { ok: true, name: path.basename(filePath), path: filePath, format: 'epub', book: bookFormats().parseEpub(filePath) };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const format = /\.markdown?$/i.test(filePath) ? 'md' : 'txt';
    return { ok: true, name: path.basename(filePath), path: filePath, format, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('reader:convertBook', async (event, { book, sourceFormat, targetFormat, sourcePath } = {}) => {
  try {
    if (!['txt', 'md', 'epub'].includes(targetFormat)) return { ok: false, error: '不支持的目标格式' };
    if (!book || !Array.isArray(book.chapters)) return { ok: false, error: '当前书籍内容无效' };
    const extensions = { txt: 'txt', md: 'md', epub: 'epub' };
    const labels = { txt: 'TXT 文本', md: 'Markdown', epub: 'EPUB 电子书' };
    const ext = extensions[targetFormat];
    const baseName = txtTools().safeFileName(book.title || (sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : '未命名'));
    const defaultDir = sourcePath && path.isAbsolute(sourcePath) ? path.dirname(sourcePath) : app.getPath('documents');
    const owner = BrowserWindow.fromWebContents(event.sender) || readerWindow || mainWindow;
    const result = await dialog.showSaveDialog(owner, {
      title: `转换为 ${labels[targetFormat]}`,
      defaultPath: path.join(defaultDir, `${baseName}.${ext}`),
      filters: [{ name: labels[targetFormat], extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
    if (sourcePath && path.resolve(result.filePath) === path.resolve(sourcePath)) {
      return { ok: false, error: '不能覆盖当前正在阅读的源文件，请选择其他文件名' };
    }
    const { renderEpub, renderMarkdown, renderTxt } = bookFormats();
    const output = targetFormat === 'epub'
      ? renderEpub(book, sourceFormat)
      : targetFormat === 'md'
        ? renderMarkdown(book, sourceFormat)
        : renderTxt(book, sourceFormat);
    fs.writeFileSync(result.filePath, output);
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('file:listTxts', (event, dir) => {
  try {
    const { loadLibraryMeta } = libraryTools();
    const files = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.txt'))
      .map((f) => {
        const filePath = path.join(dir, f);
        const meta = loadLibraryMeta(filePath);
        return {
          name: f,
          path: filePath,
          // 启动书架时不能逐本读取数十万字的 TXT。新下载书籍都有元数据；旧书保留“未识别”提示。
          chapterCount: meta?.chapters?.length || 0,
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

ipcMain.handle('reader:getProgress', (_event, filePath) => {
  const key = readerProgressKey(filePath);
  return { ok: true, progress: key ? readerProgress[key] || null : null };
});

ipcMain.on('reader:setProgress', (_event, payload) => { updateReaderProgress(payload); });

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

// 阅读器内置主题弹窗负责选择；本地删除使用系统回收站，可恢复。
ipcMain.handle('reader:removeBook', async (_event, filePath, action = 'shelf-only') => {
  const shelfBook = readerBooks.find((book) => book.filePath === filePath);
  if (!shelfBook) return { ok: false, error: '书架中找不到这本书' };
  if (!['shelf-only', 'delete-local'].includes(action)) return { ok: false, error: '无效的移除方式' };

  let metadataWarning = '';
  if (action === 'delete-local') {
    try {
      if (fs.existsSync(filePath)) await shell.trashItem(filePath);
    } catch (e) {
      return { ok: false, error: `无法移入回收站：${e.message || String(e)}` };
    }
    const sidecarPath = libraryTools().metadataPath(filePath);
    if (fs.existsSync(sidecarPath)) {
      try { await shell.trashItem(sidecarPath); }
      catch (e) { metadataWarning = `；更新记录未能移入回收站：${e.message || String(e)}`; }
    }
  }

  const before = readerBooks.length;
  readerBooks = readerBooks.filter((book) => book.filePath !== filePath);
  if (currentReaderFile === filePath) currentReaderFile = null;
  if (action === 'delete-local') delete readerProgress[readerProgressKey(filePath)];
  if (readerBooks.length !== before) saveReaderState();
  return { ok: true, deletedLocal: action === 'delete-local', warning: metadataWarning };
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
  const { loadLibraryMeta, createLibraryMeta, saveLibraryMeta, appendTxtChapters, mergeNewChapters } = libraryTools();
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
      const sourceBook = await crawler().getBookFromUrl(String(sourceUrl).trim(), new HttpClient({ cacheDir: path.join(app.getPath('userData'), 'cache') }));
      if (!existingCount) return { ok: false, error: '未能从此 TXT 识别章节标题，无法安全迁移更新记录' };
      meta = createLibraryMeta(filePath, String(sourceUrl).trim(), sourceBook, sourceBook.chapters.slice(0, existingCount));
      migrated = true;
    } catch (e) {
      return { ok: false, error: `无法识别来源目录：${e.message || String(e)}` };
    }
  }
  if (activeDownloader) return { ok: false, error: '已有下载任务正在进行，请稍后再试' };

  cancelFlag = false;
  activeDownloader = new (crawler().Downloader)({
    minInterval: 700,
    startChapter: existingCount + 1,
    endChapter: requestedEnd,
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

const updateApplyArgs = getUpdateApplyArgs();

if (updateApplyArgs) {
  app.whenReady().then(async () => {
    try {
      await applyDownloadedUpdate(updateApplyArgs);
      app.exit(0);
    } catch (_) {
      app.exit(1);
    }
  });
} else {
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

  app.on('before-quit', () => {
    if (readerStateSaveTimer) {
      clearTimeout(readerStateSaveTimer);
      readerStateSaveTimer = null;
    }
    saveReaderState();
  });
}
