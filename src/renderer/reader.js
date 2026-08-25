// 阅读器逻辑
const $ = (id) => document.getElementById(id);

let book = { title: '', chapters: [] };
let currentChapter = -1;
let currentFile = null;
let isMarkdown = false;
let sourceFormat = 'txt';
let sidebarMode = 'toc';
let removeBookResolver = null;
let scrollSaveTimer = null;
let wheelPageLocked = false;
let pageControlsTimer = null;
let pageAnimationTimer = null;

const THEMES = ['light', 'sepia', 'dark'];
const THEME_LABELS = { light: '浅色', sepia: '羊皮纸', dark: '深色' };
const THEME_PALETTE_DEFAULTS = {
  light: { border: '#e6e8ec', fill: '#ffffff', function: '#e84c3d' },
  sepia: { border: '#ddd2bc', fill: '#f5f0e6', function: '#b08968' },
  dark: { border: '#3a3a3c', fill: '#1c1c1e', function: '#ff7b6b' },
};
const PARAGRAPH_MODES = ['off', 'optimized'];
const PARAGRAPH_MODE_LABELS = { off: '关闭', optimized: '开启' };
const READING_MODES = ['scroll', 'paged'];
const READING_MODE_LABELS = { scroll: '上下', paged: '左右' };
const PAGE_KEY_DEFAULTS = { prevPageKey: 'PageUp', nextPageKey: 'PageDown' };
let keyCaptureTarget = null;
const VOLUME_RE = /^第\s*[0-9一二三四五六七八九十百千万零]+\s*[卷集]/;
const CHAPTER_RE = /^第\s*[0-9一二三四五六七八九十百千万零]+\s*[章节回]/;
const NUMBERED_CHAPTER_RE = /^\d{1,6}\s+\S/;

function shelfDisplayTitle(item) {
  const fallback = (item.filePath || '').split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '未命名';
  const raw = String(item.title || fallback).trim();
  const bracketed = raw.match(/^《([^》]+)》/);
  return (bracketed?.[1] || raw.split(/作者\s*[：:]/)[0] || fallback).trim();
}

function chooseRemoveAction(item) {
  $('removeBookMessage').textContent = `要如何处理《${shelfDisplayTitle(item)}》？`;
  $('removeBookModal').classList.remove('hidden');
  $('removeBookShelfOnly').focus();
  return new Promise((resolve) => { removeBookResolver = resolve; });
}

function closeRemoveModal(action = null) {
  const modal = $('removeBookModal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  const resolve = removeBookResolver;
  removeBookResolver = null;
  resolve?.(action);
}

function setFormatButtonsDisabled(busy = false) {
  document.querySelectorAll('.format-option').forEach((button) => {
    button.disabled = busy || button.dataset.format === sourceFormat;
  });
}

function openConvertModal() {
  if (!currentFile) return;
  const labels = { txt: 'TXT', md: 'Markdown', epub: 'EPUB' };
  $('convertMessage').textContent = `《${book.title || '未命名'}》当前为 ${labels[sourceFormat] || sourceFormat}，请选择目标格式。`;
  $('convertStatus').textContent = '转换会保留书名、章节和正文；图片与复杂样式会简化。';
  setFormatButtonsDisabled(false);
  $('convertModal').classList.remove('hidden');
  document.querySelector('.format-option:not(:disabled)')?.focus();
}

function closeConvertModal() {
  $('convertModal').classList.add('hidden');
}

function keyBindingFromEvent(event) {
  const base = event.code || event.key;
  if (!base || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return '';
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  return [...modifiers, base].join('+');
}

function keyBindingLabel(binding) {
  const labels = {
    PageUp: 'PageUp', PageDown: 'PageDown', ArrowLeft: '←', ArrowRight: '→',
    ArrowUp: '↑', ArrowDown: '↓', Space: '空格', Escape: 'Esc', Enter: 'Enter',
    Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', Tab: 'Tab',
  };
  return String(binding || '').split('+').map((part) => {
    if (labels[part]) return labels[part];
    if (/^Key[A-Z]$/.test(part)) return part.slice(3);
    if (/^Digit\d$/.test(part)) return part.slice(5);
    if (/^Numpad/.test(part)) return part.replace('Numpad', '小键盘 ');
    return part;
  }).join('+');
}

function settingPageKey(settings, name) {
  const value = String(settings?.[name] || PAGE_KEY_DEFAULTS[name]);
  return value || PAGE_KEY_DEFAULTS[name];
}

function beginKeyCapture(name) {
  keyCaptureTarget = name;
  const button = $(name === 'prevPageKey' ? 'tpPrevPageKey' : 'tpNextPageKey');
  button.dataset.capturing = 'true';
  button.textContent = '请按键…';
  button.focus();
}

function finishKeyCapture(event) {
  if (!keyCaptureTarget) return false;
  if (event.key === 'Escape') {
    keyCaptureTarget = null;
    refreshTypePanel();
    event.preventDefault();
    return true;
  }
  const binding = keyBindingFromEvent(event);
  if (!binding) return true;
  const settings = getSettings();
  const otherName = keyCaptureTarget === 'prevPageKey' ? 'nextPageKey' : 'prevPageKey';
  if (binding === settingPageKey(settings, otherName)) {
    const button = $(keyCaptureTarget === 'prevPageKey' ? 'tpPrevPageKey' : 'tpNextPageKey');
    button.textContent = '按键已占用';
    setTimeout(() => { if (keyCaptureTarget) refreshTypePanel(); }, 700);
    event.preventDefault();
    return true;
  }
  settings[keyCaptureTarget] = binding;
  saveSettings(settings);
  keyCaptureTarget = null;
  refreshTypePanel(settings);
  event.preventDefault();
  return true;
}

function turnPage(direction) {
  if (currentChapter < 0) return;
  const content = $('content');
  const readingMode = getReadingMode();
  if (readingMode === 'paged') {
    revealPageTurnControls();
    const maxScrollLeft = Math.max(0, content.scrollWidth - content.clientWidth);
    const atStart = content.scrollLeft <= 2;
    const atEnd = content.scrollLeft >= maxScrollLeft - 2;
    if (direction < 0 && atStart && currentChapter > 0) {
      playPageTurnAnimation(direction);
      gotoChapter(currentChapter - 1);
      content.scrollLeft = Math.max(0, content.scrollWidth - content.clientWidth);
      saveProgress();
      return;
    }
    if (direction > 0 && atEnd && currentChapter < book.chapters.length - 1) {
      playPageTurnAnimation(direction);
      gotoChapter(currentChapter + 1);
      return;
    }
    const step = Math.max(1, content.clientWidth);
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, content.scrollLeft + direction * step));
    if (nextScrollLeft !== content.scrollLeft) playPageTurnAnimation(direction);
    content.scrollLeft = nextScrollLeft;
    saveProgress();
    return;
  }
  const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
  const atStart = content.scrollTop <= 2;
  const atEnd = content.scrollTop >= maxScroll - 2;
  if (direction < 0 && atStart && currentChapter > 0) {
    gotoChapter(currentChapter - 1);
    content.scrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
    saveProgress();
    return;
  }
  if (direction > 0 && atEnd && currentChapter < book.chapters.length - 1) {
    gotoChapter(currentChapter + 1);
    return;
  }
  const step = Math.max(120, Math.floor(content.clientHeight * 0.88));
  content.scrollTop = Math.max(0, Math.min(maxScroll, content.scrollTop + direction * step));
  saveProgress();
}

async function convertCurrentBook(targetFormat) {
  if (!currentFile || targetFormat === sourceFormat) return;
  setFormatButtonsDisabled(true);
  $('convertStatus').textContent = '正在准备转换内容…';
  const result = await window.api.convertReaderBook({ book, sourceFormat, targetFormat, sourcePath: currentFile });
  setFormatButtonsDisabled(false);
  if (!result.ok) {
    $('convertStatus').textContent = `转换失败：${result.error || '未知错误'}`;
    return;
  }
  if (result.cancelled) {
    $('convertStatus').textContent = '已取消转换。';
    return;
  }
  $('convertStatus').textContent = `转换完成：${result.filePath}`;
}

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
  let markdownTitle = '';
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
    // Markdown：首个一级标题视为书名，其余标题作为章节，支持非“第 X 章”命名。
    const markdownHeading = isMarkdown ? line.match(/^(#{1,6})\s+(.+)$/) : null;
    if (markdownHeading) {
      flush();
      const headingLevel = markdownHeading[1].length;
      const headingText = markdownHeading[2].trim();
      if (headingLevel === 1 && !markdownTitle && !chapters.length) markdownTitle = headingText;
      else {
        cur = { title: headingText, volume: curVolume, paragraphs: [] };
        chapters.push(cur);
      }
      lastLine = line; lastWasBlank = true; continue;
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
  const title = markdownTitle || (metadataTitle ? metadataTitle.replace(/^书名\s*[：:]\s*/, '') : (preamble.find((l) => l.startsWith('《')) || chapters[0]?.title || '未命名'));
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
    name.textContent = shelfDisplayTitle(item);
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
    remove.title = '移出书架或删除本地文件';
    remove.onclick = async (event) => {
      event.stopPropagation();
      const action = await chooseRemoveAction(item);
      if (!action) return;
      const result = await window.api.removeReaderBook(item.filePath, action);
      if (!result.ok) return alert('移除失败：' + (result.error || '未知错误'));
      if (result.warning) alert(result.warning);
      renderShelf();
    };
    li.append(open, remove);
    ul.appendChild(li);
  }
}

function renderChapter(i, { scrollTop = 0, scrollLeft = 0, persist = true } = {}) {
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
  const content = $('content');
  content.scrollTop = Math.max(0, Number(scrollTop) || 0);
  content.scrollLeft = Math.max(0, Number(scrollLeft) || 0);
  if (persist) saveProgress();
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
function getReadingMode(settings = getSettings()) {
  return settings.readingMode === 'paged' ? 'paged' : 'scroll';
}

function updatePageTurnControls(show = false) {
  const controls = $('pageTurnControls');
  const isPaged = getReadingMode() === 'paged';
  controls.classList.toggle('paged', isPaged);
  if (!isPaged) {
    controls.classList.remove('visible');
    if (pageControlsTimer) clearTimeout(pageControlsTimer);
    return;
  }
  if (show && currentChapter >= 0) revealPageTurnControls();
}

function revealPageTurnControls() {
  if (getReadingMode() !== 'paged') return;
  const controls = $('pageTurnControls');
  controls.classList.add('paged', 'visible');
  if (pageControlsTimer) clearTimeout(pageControlsTimer);
  pageControlsTimer = setTimeout(() => controls.classList.remove('visible'), 1800);
}

function playPageTurnAnimation(direction) {
  const flow = $('pageFlow');
  const animationClass = direction > 0 ? 'page-turn-next' : 'page-turn-prev';
  flow.classList.remove('page-turn-next', 'page-turn-prev');
  void flow.offsetWidth;
  flow.classList.add(animationClass);
  if (pageAnimationTimer) clearTimeout(pageAnimationTimer);
  pageAnimationTimer = setTimeout(() => flow.classList.remove(animationClass), 280);
}

function applyReadingMode(mode, shouldReveal = false) {
  const normalized = mode === 'paged' ? 'paged' : 'scroll';
  const content = $('content');
  content.dataset.readingMode = normalized;
  const button = $('btnReadingMode');
  button.querySelector('strong').textContent = READING_MODE_LABELS[normalized];
  button.title = `切换翻页方式（当前：${normalized === 'paged' ? '左右翻书' : '上下滚动'}）`;
  updatePageTurnControls(shouldReveal);
}

function cycleReadingMode() {
  const content = $('content');
  const settings = getSettings();
  const current = getReadingMode(settings);
  const oldMax = current === 'paged'
    ? Math.max(0, content.scrollWidth - content.clientWidth)
    : Math.max(0, content.scrollHeight - content.clientHeight);
  const oldPosition = current === 'paged' ? content.scrollLeft : content.scrollTop;
  const ratio = oldMax > 0 ? oldPosition / oldMax : 0;
  saveProgress();
  settings.readingMode = READING_MODES[(READING_MODES.indexOf(current) + 1) % READING_MODES.length];
  saveSettings(settings);
  applyReadingMode(settings.readingMode, true);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (settings.readingMode === 'paged') {
      content.scrollTop = 0;
      content.scrollLeft = ratio * Math.max(0, content.scrollWidth - content.clientWidth);
    } else {
      content.scrollLeft = 0;
      content.scrollTop = ratio * Math.max(0, content.scrollHeight - content.clientHeight);
    }
    saveProgress();
  }));
}
function applySettings(s) {
  const theme = s.theme || 'sepia';
  document.body.dataset.theme = theme;
  applyThemePalette(s, theme);
  document.documentElement.style.setProperty('--font-size', (s.fontSize ?? 18) + 'px');
  document.documentElement.style.setProperty('--line-height', String(s.lineHeight ?? 1.9));
  document.documentElement.style.setProperty('--para-margin', (s.paraSpacing ?? 1) + 'em');
  document.documentElement.style.setProperty('--page-margin', (s.pageMargin ?? 24) + 'px');
  applyReadingMode(getReadingMode(s));
  // 直接使用本次修改后的对象刷新数值；此时 localStorage 可能尚未写入，
  // 若重新读取缓存会让面板滞后一拍，并在下一项操作时显示成“改错了项目”。
  refreshTypePanel(s);
  // 同步阅读器标题栏颜色与背景，与下载器一致的窗口样式
  window.api.setReaderTheme(theme);
}
function saveSettings(s) {
  localStorage.setItem('reader-settings', JSON.stringify(s));
}

function themePalette(settings, theme) {
  const stored = settings.themeColors?.[theme] || {};
  // 兼容 2.2.7 已保存的 accent 字段；新设置统一称为“功能颜色”。
  return { ...THEME_PALETTE_DEFAULTS[theme], ...stored, function: stored.function || stored.accent || THEME_PALETTE_DEFAULTS[theme].function };
}

function applyThemePalette(settings, theme) {
  const palette = themePalette(settings, theme);
  const root = document.documentElement.style;
  root.setProperty('--control-border', palette.border);
  root.setProperty('--control-fill', palette.fill);
  root.setProperty('--function-color', palette.function);
  root.setProperty('--accent', palette.function);
  $('btnTheme').querySelector('strong').textContent = THEME_LABELS[theme];
  $('themeBorderColor').value = palette.border;
  $('themeFillColor').value = palette.fill;
  $('themeAccentColor').value = palette.function;
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.themeChoice === theme);
  });
}

function selectTheme(theme) {
  if (!THEMES.includes(theme)) return;
  const s = getSettings();
  s.theme = theme;
  applySettings(s);
  saveSettings(s);
}

function updateThemeColor(colorName, value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return;
  const s = getSettings();
  const theme = s.theme || 'sepia';
  s.themeColors = { ...(s.themeColors || {}) };
  s.themeColors[theme] = { ...(s.themeColors[theme] || {}), [colorName]: value };
  applySettings(s);
  saveSettings(s);
}

function resetThemeColors() {
  const s = getSettings();
  const theme = s.theme || 'sepia';
  if (s.themeColors?.[theme]) {
    s.themeColors = { ...s.themeColors };
    delete s.themeColors[theme];
  }
  applySettings(s);
  saveSettings(s);
}

function toggleThemePanel() {
  const panel = $('themePanel');
  const isOpen = panel.classList.toggle('open');
  $('btnTheme').setAttribute('aria-expanded', String(isOpen));
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
  if (!keyCaptureTarget) {
    $('tpPrevPageKey').textContent = keyBindingLabel(settingPageKey(s, 'prevPageKey'));
    $('tpNextPageKey').textContent = keyBindingLabel(settingPageKey(s, 'nextPageKey'));
    $('tpPrevPageKey').dataset.capturing = 'false';
    $('tpNextPageKey').dataset.capturing = 'false';
  }
}

function toggleTypePanel() {
  const panel = $('typePanel');
  const isOpen = panel.classList.toggle('open');
  $('btnTypographySettings').setAttribute('aria-expanded', String(isOpen));
}

function toggleSettingsPanel() {
  const panel = $('settingsPanel');
  const isOpen = panel.classList.toggle('open');
  $('btnSettings').setAttribute('aria-expanded', String(isOpen));
}

function closeSettingsPanel() {
  $('settingsPanel').classList.remove('open');
  $('btnSettings').setAttribute('aria-expanded', 'false');
}

// ---- 进度 ----
function progressKey() {
  return 'reader-progress-' + (currentFile || 'default');
}
function saveProgress() {
  if (!currentFile || currentChapter < 0) return;
  const content = $('content');
  const progress = {
    chapter: currentChapter,
    scrollTop: content.scrollTop || 0,
    scrollLeft: content.scrollLeft || 0,
    readingMode: getReadingMode(),
  };
  // localStorage 只作为旧版本兼容备份；长期进度由主进程写入 AppData/reader-state.json。
  localStorage.setItem(progressKey(), JSON.stringify(progress));
  window.api.saveReaderProgress({ filePath: currentFile, ...progress });
}
async function loadProgress() {
  try {
    const stored = await window.api.getReaderProgress(currentFile);
    if (stored?.ok && stored.progress) return stored.progress;
  } catch (_) { /* 兼容旧版 preload */ }
  try {
    const legacy = JSON.parse(localStorage.getItem(progressKey())) || {};
    if (typeof legacy.chapter === 'number') window.api.saveReaderProgress({ filePath: currentFile, ...legacy });
    return legacy;
  } catch (_) { return {}; }
}

// ---- 载入 ----
async function loadFile(filePath, silent = false) {
  if (!filePath) return;
  const res = await window.api.readText(filePath);
  if (!res.ok) { if (!silent) alert('读取失败：' + res.error); return; }
  currentFile = res.path;
  sourceFormat = res.format || (/\.(md|markdown)$/i.test(res.path) ? 'md' : /\.epub$/i.test(res.path) ? 'epub' : 'txt');
  isMarkdown = sourceFormat === 'md';
  book = sourceFormat === 'epub' ? res.book : parseTxt(res.content);
  if (!book || !Array.isArray(book.chapters) || !book.chapters.length) {
    if (!silent) alert('读取失败：文件中没有可阅读的章节');
    return;
  }
  $('btnConvert').disabled = false;
  $('topTitle').textContent = book.title;
  renderToc();
  const saved = await loadProgress();
  const start = (typeof saved.chapter === 'number' && saved.chapter < book.chapters.length) ? saved.chapter : 0;
  renderChapter(start, { scrollTop: saved.scrollTop, scrollLeft: saved.scrollLeft, persist: false });
  saveProgress();
  await window.api.touchReaderBook({ filePath: res.path, title: book.title, chapterCount: book.chapters.length });
}

window.addEventListener('DOMContentLoaded', async () => {
  applySettings(getSettings());

  $('btnToc').addEventListener('click', toggleToc);
  $('btnShelf').addEventListener('click', openShelf);
  $('overlay').addEventListener('click', closeToc);
  $('btnPrev').addEventListener('click', () => gotoChapter(currentChapter - 1));
  $('btnNext').addEventListener('click', () => gotoChapter(currentChapter + 1));
  $('btnPagePrev').addEventListener('click', () => turnPage(-1));
  $('btnPageNext').addEventListener('click', () => turnPage(1));
  $('btnTheme').addEventListener('click', toggleThemePanel);
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => selectTheme(button.dataset.themeChoice));
  });
  $('themeBorderColor').addEventListener('input', (event) => updateThemeColor('border', event.target.value));
  $('themeFillColor').addEventListener('input', (event) => updateThemeColor('fill', event.target.value));
  $('themeAccentColor').addEventListener('input', (event) => updateThemeColor('function', event.target.value));
  $('btnResetThemeColors').addEventListener('click', resetThemeColors);
  $('btnReadingMode').addEventListener('click', cycleReadingMode);
  $('btnSettings').addEventListener('click', toggleSettingsPanel);
  $('btnTypographySettings').addEventListener('click', toggleTypePanel);
  $('tpFontDec').addEventListener('click', () => adjustFont(-1));
  $('tpFontInc').addEventListener('click', () => adjustFont(1));
  $('tpLineDec').addEventListener('click', () => adjustLine(-0.1));
  $('tpLineInc').addEventListener('click', () => adjustLine(0.1));
  $('tpParaDec').addEventListener('click', () => adjustPara(-0.1));
  $('tpParaInc').addEventListener('click', () => adjustPara(0.1));
  $('tpMarginDec').addEventListener('click', () => adjustMargin(-4));
  $('tpMarginInc').addEventListener('click', () => adjustMargin(4));
  $('tpParagraphMode').addEventListener('click', cycleParagraphMode);
  $('tpPrevPageKey').addEventListener('click', () => beginKeyCapture('prevPageKey'));
  $('tpNextPageKey').addEventListener('click', () => beginKeyCapture('nextPageKey'));
  $('removeBookCancel').addEventListener('click', () => closeRemoveModal());
  $('removeBookShelfOnly').addEventListener('click', () => closeRemoveModal('shelf-only'));
  $('removeBookDeleteLocal').addEventListener('click', () => closeRemoveModal('delete-local'));
  $('removeBookModal').addEventListener('click', (event) => {
    if (event.target === $('removeBookModal')) closeRemoveModal();
  });
  document.addEventListener('click', (e) => {
    const panel = $('settingsPanel');
    if (panel.classList.contains('open') && !panel.contains(e.target) && e.target.id !== 'btnSettings') {
      closeSettingsPanel();
    }
  });
  $('btnOpen').addEventListener('click', async () => {
    const f = await window.api.chooseFile();
    if (f) loadFile(f);
  });
  $('btnConvert').addEventListener('click', () => {
    closeSettingsPanel();
    openConvertModal();
  });
  $('convertCancel').addEventListener('click', closeConvertModal);
  $('convertModal').addEventListener('click', (event) => {
    if (event.target === $('convertModal')) closeConvertModal();
  });
  document.querySelectorAll('.format-option').forEach((button) => {
    button.addEventListener('click', () => convertCurrentBook(button.dataset.format));
  });
  $('content').addEventListener('scroll', () => {
    if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(() => {
      scrollSaveTimer = null;
      saveProgress();
    }, 450);
  });
  $('content').addEventListener('wheel', (event) => {
    if (getReadingMode() !== 'paged' || event.ctrlKey) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 8) return;
    event.preventDefault();
    if (wheelPageLocked) return;
    wheelPageLocked = true;
    turnPage(delta > 0 ? 1 : -1);
    setTimeout(() => { wheelPageLocked = false; }, 320);
  }, { passive: false });
  window.addEventListener('beforeunload', saveProgress);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProgress();
  });
  document.addEventListener('mousemove', () => revealPageTurnControls());
  // 键盘翻页/翻章
  window.addEventListener('keydown', (e) => {
    if (finishKeyCapture(e)) return;
    if (e.key === 'Escape' && !$('removeBookModal').classList.contains('hidden')) {
      closeRemoveModal();
      return;
    }
    if (e.key === 'Escape' && !$('convertModal').classList.contains('hidden')) {
      closeConvertModal();
      return;
    }
    if (e.key === 'Escape' && $('settingsPanel').classList.contains('open')) {
      closeSettingsPanel();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const settings = getSettings();
    const prevPageKey = settingPageKey(settings, 'prevPageKey');
    const nextPageKey = settingPageKey(settings, 'nextPageKey');
    const pressedKey = keyBindingFromEvent(e);
    if (pressedKey === prevPageKey) {
      e.preventDefault();
      turnPage(-1);
      return;
    }
    if (pressedKey === nextPageKey) {
      e.preventDefault();
      turnPage(1);
      return;
    }
    // 左右方向键保留原有的章节切换；“左右”指横向书页布局，而非固定按键。
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      gotoChapter(currentChapter - 1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      gotoChapter(currentChapter + 1);
      return;
    }
  });

  const initial = await window.api.getReaderFile();
  if (initial) loadFile(initial, true); // 自动恢复上次书籍与阅读位置，失败静默
});
