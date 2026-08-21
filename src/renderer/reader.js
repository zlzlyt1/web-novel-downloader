// 阅读器逻辑
const $ = (id) => document.getElementById(id);

let book = { title: '', chapters: [] };
let currentChapter = -1;
let currentFile = null;
let isMarkdown = false;
let sidebarMode = 'toc';

const THEMES = ['light', 'sepia', 'dark'];
const PARAGRAPH_MODES = ['off', 'optimized'];
const PARAGRAPH_MODE_LABELS = { off: '关闭', optimized: '开启' };
const VOLUME_RE = /^第\s*[0-9一二三四五六七八九十百千万零]+\s*[卷集]/;
const CHAPTER_RE = /^第\s*[0-9一二三四五六七八九十百千万零]+\s*[章节回]/;
const NUMBERED_CHAPTER_RE = /^\d{1,6}\s+\S/;

// 将同一段落的多行合并成一行，避免文本被硬换行切碎成短段。
// 中文之间不加空格，西文/数字之间补一个空格，保证英文单词不断开。
function joinParaLines(lines) {
  let out = '';
  for (const l of lines) {
    if (!l) continue;
    if (!out) { out = l; continue; }
    const a = out[out.length - 1];
    const b = l[0];
    const isCjk = (c) => c && /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\uff00-\uffef]/.test(c);
    out += (isCjk(a) || isCjk(b)) ? l : (' ' + l);
  }
  return out;
}

function parseTxt(content) {
  const text = content.replace(/\r\n/g, '\n');
  const originalLines = text.split('\n');
  // 部分手机阅读器导出的 TXT 会先放一份数字目录，正文再次出现相同标题。
  // 从首个数字章节标题的第二次出现处开始解析，避免把目录误当成空章节。
  let lines = originalLines;
  const firstNumbered = originalLines.find((line) => NUMBERED_CHAPTER_RE.test(line.trim()));
  if (firstNumbered) {
    const normalizedFirst = firstNumbered.trim();
    const secondIndex = originalLines.findIndex((line, index) => index > originalLines.indexOf(firstNumbered) && line.trim() === normalizedFirst);
    if (secondIndex > 0) lines = originalLines.slice(secondIndex);
  }
  // 判断文本格式，决定如何“主动重排”：
  //  - 有空行分隔 → 空行块内的多行合并为一段（消除硬换行）
  //  - 无空行但有行首缩进 → 以缩进行作为段落开头，后续行并入同一段
  //  - 既无空行也无缩进 → 每行独立成段，不做合并
  const hasBlankSep = /\n\s*\n/.test(text);
  const hasIndentStarts = lines.some((l) => /^[\s\u3000\t]+/.test(l) && l.trim().length > 0);

  const chapters = [];
  let cur = null;
  let curVolume = '';
  let preamble = [];
  let pending = [];     // 当前累积的段落行
  let lastLine = '';    // 上一个非空行（判断上一句是否已完结 / 是否为续接）
  let lastWasBlank = true; // 是否刚遇到空行/标题/章节开始

  const flush = () => {
    if (!pending.length) return;
    const p = joinParaLines(pending);
    if (cur) cur.paragraphs.push(p); else preamble.push(p);
    pending = [];
  };

  // 句子是否已完结（以句末标点或闭合引号/括号结尾）
  const endsSentence = (s) => /[。！？…!?~"”」』）)〉》]$/.test(s);
  // 行末是否为“续接”标点（逗号/顿号/冒号/分号/破折号），说明该句被硬换行断开、应续接下行
  const isContinuationEnd = (s) => /[，、,;；:：——…]$/.test(s);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { lastWasBlank = true; continue; }

    if (VOLUME_RE.test(line) && !CHAPTER_RE.test(line)) {
      flush(); curVolume = line; lastLine = line; lastWasBlank = true; continue;
    }
    if (CHAPTER_RE.test(line) || NUMBERED_CHAPTER_RE.test(line)) {
      flush(); cur = { title: line, volume: curVolume, paragraphs: [] };
      chapters.push(cur); lastLine = line; lastWasBlank = true; continue;
    }
    // Markdown 标题形式的章节：如 “# 第一章 xxx”
    if (isMarkdown && /^#{1,6}\s+第\s*[0-9一二三四五六七八九十百千万零]+\s*[章节回]/.test(line)) {
      flush(); cur = { title: line.replace(/^#{1,6}\s+/, ''), volume: curVolume, paragraphs: [] };
      chapters.push(cur); lastLine = line; lastWasBlank = true; continue;
    }

    const indented = /^[\s\u3000\t]/.test(raw);
    const startsQuote = /^[“「『(（]/.test(line);
    let isNew;
    if (hasBlankSep) {
      // 空行分隔为主：上一句已完结/本行缩进/引号开头则新段；
      // 否则若上一句以续接标点结尾（被硬换行断开），则作为续行合并，消除碎行。
      if (!pending.length) isNew = true;
      else if (!lastWasBlank) isNew = false;                 // 同块内连续行：合并
      else isNew = !(isContinuationEnd(lastLine) && !indented && !startsQuote);
    } else if (hasIndentStarts) {
      isNew = !pending.length || indented;                   // 缩进分隔：每遇缩进行开新段
    } else {
      isNew = true;                                          // 无空行无缩进：每行独立成段
    }
    if (isNew) flush();
    pending.push(line);
    lastLine = line;
    lastWasBlank = false;
  }
  flush();

  // 若没有识别到任何章节，整篇作为一章。
  if (!chapters.length) {
    chapters.push({ title: '', volume: '', paragraphs: preamble });
    preamble = [];
  }

  const metadataTitle = originalLines.map((line) => line.trim()).find((line) => /^书名\s*[：:]/.test(line));
  const title = metadataTitle ? metadataTitle.replace(/^书名\s*[：:]\s*/, '') : (preamble.find((l) => l.startsWith('《')) || chapters[0]?.title || '未命名');
  return { title, chapters };
}

function renderToc() {
  sidebarMode = 'toc';
  $('sidebarTitle').textContent = book.title ? `目录 · ${book.title}` : '目录';
  const ul = $('toc');
  ul.innerHTML = '';
  book.chapters.forEach((ch, i) => {
    if (ch.volume) {
      const li = document.createElement('li');
      li.className = 'volume';
      li.textContent = ch.volume;
      ul.appendChild(li);
    }
    const li = document.createElement('li');
    li.textContent = ch.title || `第 ${i + 1} 章`;
    li.onclick = () => { gotoChapter(i); closeToc(); };
    if (i === currentChapter) li.className = 'active';
    ul.appendChild(li);
  });
}

async function renderShelf() {
  sidebarMode = 'shelf';
  $('sidebarTitle').textContent = '书架';
  const ul = $('toc');
  ul.innerHTML = '<li class="shelf-empty">正在读取书架…</li>';
  const response = await window.api.getReaderBooks();
  if (sidebarMode !== 'shelf') return;
  ul.innerHTML = '';
  const books = response.ok ? response.books : [];
  if (!books.length) {
    ul.innerHTML = '<li class="shelf-empty">书架还没有书籍<br>打开 TXT 或 Markdown 后会自动加入</li>';
    return;
  }
  for (const item of books) {
    const li = document.createElement('li');
    li.className = 'shelf-item';
    const open = document.createElement('button');
    open.className = 'shelf-open';
    open.disabled = item.missing;
    open.title = item.missing ? '文件已不存在' : item.filePath;
    const name = document.createElement('span');
    name.className = 'shelf-name';
    name.textContent = item.title || '未命名';
    const meta = document.createElement('span');
    meta.className = 'shelf-meta';
    meta.textContent = item.missing ? '文件已不存在' : `${item.chapterCount || 0} 章 · ${item.filePath}`;
    open.append(name, meta);
    open.onclick = async () => {
      if (item.missing) return;
      await loadFile(item.filePath);
      closeToc();
    };
    const remove = document.createElement('button');
    remove.className = 'shelf-remove';
    remove.textContent = '×';
    remove.title = '仅移出书架，不删除本地文件';
    remove.onclick = async (event) => {
      event.stopPropagation();
      await window.api.removeReaderBook(item.filePath);
      renderShelf();
    };
    li.append(open, remove);
    ul.appendChild(li);
  }
}

function renderChapter(i) {
  currentChapter = i;
  const ch = book.chapters[i];
  $('chapterTitle').textContent = ch.title || '正文';
  const body = $('chapterBody');
  let bodyHtml;
  if (isMarkdown) {
    body.className = 'chapter-body md';
    delete body.dataset.paragraphMode;
    bodyHtml = renderMarkdown(ch.paragraphs.join('\n')) || '<p class="placeholder">（本章无内容）</p>';
  } else {
    body.className = 'chapter-body';
    const settings = getSettings();
    const mode = settings.paragraphMode === 'off' ? 'off' : 'optimized';
    const optimized = window.ParagraphOptimizer
      ? window.ParagraphOptimizer.optimizeParagraphs(ch.paragraphs, { mode }).paragraphs
      : ch.paragraphs;
    body.dataset.paragraphMode = mode;
    bodyHtml = optimized.map((p) => `<p>${escapeHtml(p)}</p>`).join('') || '<p class="placeholder">（本章无内容）</p>';
  }
  body.innerHTML = bodyHtml;
  $('navPos').textContent = `${i + 1} / ${book.chapters.length}`;
  $('topTitle').textContent = ch.title || book.title;
  $('btnPrev').disabled = i <= 0;
  $('btnNext').disabled = i >= book.chapters.length - 1;
  // 高亮目录
  if (sidebarMode === 'toc') {
    document.querySelectorAll('#toc li').forEach((li) => li.classList.remove('active'));
    const items = document.querySelectorAll('#toc li:not(.volume)');
    if (items[i]) items[i].classList.add('active');
  }
  // 滚动目录到当前
  const active = sidebarMode === 'toc' ? document.querySelector('#toc li.active') : null;
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  // 回到顶部
  $('content').scrollTop = 0;
  saveProgress();
}

function gotoChapter(i) {
  if (i < 0 || i >= book.chapters.length) return;
  renderChapter(i);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openToc() {
  $('sidebar').classList.add('open');
  $('overlay').classList.add('show');
}

function toggleToc() {
  if ($('sidebar').classList.contains('open') && sidebarMode === 'toc') return closeToc();
  renderToc();
  openToc();
}

function openShelf() {
  renderShelf();
  openToc();
}
function closeToc() {
  $('sidebar').classList.remove('open');
  $('overlay').classList.remove('show');
}

// ---- 设置 ----
function getSettings() {
  try { return JSON.parse(localStorage.getItem('reader-settings')) || {}; } catch (_) { return {}; }
}
function applySettings(s) {
  const theme = s.theme || 'sepia';
  document.body.dataset.theme = theme;
  document.documentElement.style.setProperty('--font-size', (s.fontSize ?? 18) + 'px');
  document.documentElement.style.setProperty('--line-height', String(s.lineHeight ?? 1.9));
  document.documentElement.style.setProperty('--para-margin', (s.paraSpacing ?? 1) + 'em');
  document.documentElement.style.setProperty('--page-margin', (s.pageMargin ?? 24) + 'px');
  // 直接使用本次修改后的对象刷新数值；此时 localStorage 可能尚未写入，
  // 若重新读取缓存会让面板滞后一拍，并在下一项操作时显示成“改错了项目”。
  refreshTypePanel(s);
  // 同步阅读器标题栏颜色与背景，与下载器一致的窗口样式
  window.api.setReaderTheme(theme);
}
function saveSettings(s) {
  localStorage.setItem('reader-settings', JSON.stringify(s));
}

function cycleTheme() {
  const s = getSettings();
  const idx = THEMES.indexOf(s.theme || 'sepia');
  s.theme = THEMES[(idx + 1) % THEMES.length];
  applySettings(s);
  saveSettings(s);
}

function adjustFont(delta) {
  const s = getSettings();
  s.fontSize = Math.min(36, Math.max(12, Math.round(((s.fontSize ?? 18) + delta) * 10) / 10));
  applySettings(s);
  saveSettings(s);
}

function adjustLine(delta) {
  const s = getSettings();
  const v = Math.round(((s.lineHeight ?? 1.9) + delta) * 10) / 10;
  s.lineHeight = Math.min(3.2, Math.max(1.2, v));
  applySettings(s);
  saveSettings(s);
}

function adjustPara(delta) {
  const s = getSettings();
  const v = Math.round(((s.paraSpacing ?? 1) + delta) * 10) / 10;
  s.paraSpacing = Math.min(2.5, Math.max(0, v));
  applySettings(s);
  saveSettings(s);
}

function adjustMargin(delta) {
  const s = getSettings();
  s.pageMargin = Math.min(160, Math.max(0, (s.pageMargin ?? 24) + delta));
  applySettings(s);
  saveSettings(s);
}

function cycleParagraphMode() {
  const s = getSettings();
  const current = s.paragraphMode === 'off' ? 'off' : 'optimized';
  const index = PARAGRAPH_MODES.indexOf(current);
  s.paragraphMode = PARAGRAPH_MODES[(index + 1) % PARAGRAPH_MODES.length];
  saveSettings(s);
  refreshTypePanel();
  if (!isMarkdown && currentChapter >= 0) renderChapter(currentChapter);
}

function refreshTypePanel(settings) {
  const s = settings || getSettings();
  $('tpFontVal').textContent = s.fontSize ?? 18;
  $('tpLineVal').textContent = (s.lineHeight ?? 1.9).toFixed(1);
  $('tpParaVal').textContent = (s.paraSpacing ?? 1).toFixed(1);
  $('tpMarginVal').textContent = s.pageMargin ?? 24;
  const paragraphMode = s.paragraphMode === 'off' ? 'off' : 'optimized';
  $('tpParagraphMode').textContent = PARAGRAPH_MODE_LABELS[paragraphMode] || PARAGRAPH_MODE_LABELS.optimized;
  $('tpParagraphMode').dataset.mode = paragraphMode;
}

function toggleTypePanel() {
  $('typePanel').classList.toggle('hidden');
}

// ---- 进度 ----
function progressKey() {
  return 'reader-progress-' + (currentFile || 'default');
}
function saveProgress() {
  if (currentFile) localStorage.setItem(progressKey(), JSON.stringify({ chapter: currentChapter }));
}
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(progressKey())) || {}; } catch (_) { return {}; }
}

// ---- 载入 ----
async function loadFile(filePath, silent = false) {
  if (!filePath) return;
  const res = await window.api.readText(filePath);
  if (!res.ok) { if (!silent) alert('读取失败：' + res.error); return; }
  currentFile = res.path;
  isMarkdown = /\.(md|markdown)$/i.test(res.path);
  book = parseTxt(res.content);
  $('topTitle').textContent = book.title;
  renderToc();
  const saved = loadProgress();
  const start = (typeof saved.chapter === 'number' && saved.chapter < book.chapters.length) ? saved.chapter : 0;
  renderChapter(start);
  await window.api.touchReaderBook({ filePath: res.path, title: book.title, chapterCount: book.chapters.length });
}

window.addEventListener('DOMContentLoaded', async () => {
  applySettings(getSettings());

  $('btnToc').addEventListener('click', toggleToc);
  $('btnShelf').addEventListener('click', openShelf);
  $('overlay').addEventListener('click', closeToc);
  $('btnPrev').addEventListener('click', () => gotoChapter(currentChapter - 1));
  $('btnNext').addEventListener('click', () => gotoChapter(currentChapter + 1));
  $('btnTheme').addEventListener('click', cycleTheme);
  $('btnType').addEventListener('click', toggleTypePanel);
  $('tpFontDec').addEventListener('click', () => adjustFont(-1));
  $('tpFontInc').addEventListener('click', () => adjustFont(1));
  $('tpLineDec').addEventListener('click', () => adjustLine(-0.1));
  $('tpLineInc').addEventListener('click', () => adjustLine(0.1));
  $('tpParaDec').addEventListener('click', () => adjustPara(-0.1));
  $('tpParaInc').addEventListener('click', () => adjustPara(0.1));
  $('tpMarginDec').addEventListener('click', () => adjustMargin(-4));
  $('tpMarginInc').addEventListener('click', () => adjustMargin(4));
  $('tpParagraphMode').addEventListener('click', cycleParagraphMode);
  document.addEventListener('click', (e) => {
    const panel = $('typePanel');
    if (!panel.classList.contains('hidden') && !panel.contains(e.target) && e.target.id !== 'btnType') {
      panel.classList.add('hidden');
    }
  });
  $('btnOpen').addEventListener('click', async () => {
    const f = await window.api.chooseFile();
    if (f) loadFile(f);
  });
  // 键盘翻页/翻章
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') gotoChapter(currentChapter - 1);
    if (e.key === 'ArrowRight') gotoChapter(currentChapter + 1);
  });

  const initial = await window.api.getReaderFile();
  if (initial) loadFile(initial, true); // 自动恢复上次书籍与阅读位置，失败静默
});
