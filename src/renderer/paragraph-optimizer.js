(function initParagraphOptimizer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ParagraphOptimizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function paragraphOptimizerFactory() {
  'use strict';

  const MODE_OPTIONS = {
    off: { targetLength: 0, maxLength: 0, minBreakLength: 0 },
    optimized: { targetLength: 110, maxLength: 180, minBreakLength: 72 }
  };

  const CHAPTER_RE = /^(?:第\s*[0-9一二三四五六七八九十百千万零〇两]+\s*[章节回卷集部篇]|\d{1,6}\s+\S)/;
  const NAMED_SECTION_RE = /^(序章|序言|楔子|引子|正文|尾声|番外|后记)(?:\s|$|[：:])/;
  const META_RE = /^(书名|作者|简介|内容简介|标签|类型|更新时间|字数)\s*[：:]/;
  const SCENE_BREAK_RE = /^(?:[.。—\-=_*·•~～…＊☆★◆◇]+\s*){2,}$/;
  const BRACKET_NOTE_RE = /^[【\[［][^】\]］]{1,40}[】\]］]$/;
  const QUOTE_START_RE = /^(?:[“「『]|[^，。！？!?：:\s]{1,12}[：:])/;
  const SPEECH_CUE_RE = /(?:说|说道|问|问道|答|答道|解释|解释道|喊|喊道|叫|叫道|骂|骂道|笑|笑道|叹|叹道)[。！!？?:：]$/;
  const CJK_RE = /[\p{Script=Han}\u3400-\u4dbf\uf900-\ufaff]/u;

  function visibleLength(text) {
    return String(text || '').replace(/\s/g, '').length;
  }

  function isHardBoundary(text) {
    const value = String(text || '').trim();
    return !value || CHAPTER_RE.test(value) || NAMED_SECTION_RE.test(value)
      || META_RE.test(value) || SCENE_BREAK_RE.test(value) || BRACKET_NOTE_RE.test(value);
  }

  function isDialogue(text) {
    return QUOTE_START_RE.test(String(text || '').trim());
  }

  function normalizeInlineWhitespace(text) {
    return String(text || '')
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000\t\r\n]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/([\p{Script=Han}\u3400-\u4dbf\uf900-\ufaff]) +(?=[\p{Script=Han}\u3400-\u4dbf\uf900-\ufaff])/gu, '$1')
      .replace(/ +([，。！？；：、”’」』）】》])/g, '$1')
      .replace(/([，。！？；：、]) +(?=[\p{Script=Han}\u3400-\u4dbf\uf900-\ufaff“‘「『（【《])/gu, '$1')
      .replace(/([“‘「『（【《]) +/g, '$1')
      .trim();
  }

  function joinTextFragments(parts) {
    let output = '';
    for (const raw of parts) {
      const part = normalizeInlineWhitespace(raw);
      if (!part) continue;
      if (!output) { output = part; continue; }
      const previous = output[output.length - 1];
      const next = part[0];
      output += (CJK_RE.test(previous) || CJK_RE.test(next) || /[，。！？；：、“”「」『』（）【】《》]/.test(previous + next))
        ? part
        : ` ${part}`;
    }
    return output;
  }

  function resolveOptions(options) {
    const requestedMode = options && options.mode;
    const mode = Object.prototype.hasOwnProperty.call(MODE_OPTIONS, requestedMode) ? requestedMode : 'optimized';
    return { mode, ...MODE_OPTIONS[mode], ...(options || {}) };
  }

  function optimizeParagraphs(paragraphs, options) {
    const settings = resolveOptions(options);
    const source = (paragraphs || []).map(normalizeInlineWhitespace).filter(Boolean);
    if (settings.mode === 'off' || source.length < 2) {
      return { paragraphs: source, groups: source.map((p) => [p]), mergedCount: 0, sourceCount: source.length };
    }

    const groups = [];
    let current = [];
    let currentLength = 0;

    const flush = () => {
      if (!current.length) return;
      groups.push(current);
      current = [];
      currentLength = 0;
    };

    for (const paragraph of source) {
      if (isHardBoundary(paragraph)) {
        flush();
        groups.push([paragraph]);
        continue;
      }

      // 对话、人物冒号发言和引出发言的提示句保持独立，避免人物发言串进叙述段。
      if (isDialogue(paragraph) || SPEECH_CUE_RE.test(paragraph)) {
        flush();
        groups.push([paragraph]);
        continue;
      }

      const paragraphLength = visibleLength(paragraph);
      if (!current.length) {
        current.push(paragraph);
        currentLength = paragraphLength;
        continue;
      }

      const candidateLength = currentLength + paragraphLength;
      const exceedsMax = candidateLength > settings.maxLength && currentLength >= settings.minBreakLength;
      const reachedDesktopParagraph = currentLength >= settings.targetLength;

      if (exceedsMax || reachedDesktopParagraph) flush();
      current.push(paragraph);
      currentLength += paragraphLength;
    }
    flush();

    const output = groups.map(joinTextFragments);
    return {
      paragraphs: output,
      groups,
      mergedCount: Math.max(0, source.length - output.length),
      sourceCount: source.length
    };
  }

  function optimizeDocumentText(text, options) {
    const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    const output = [];
    let segment = [];
    let sourceParagraphs = 0;
    let outputParagraphs = 0;

    const flushSegment = () => {
      if (!segment.length) return;
      const result = optimizeParagraphs(segment, options);
      output.push(...result.paragraphs);
      sourceParagraphs += result.sourceCount;
      outputParagraphs += result.paragraphs.length;
      segment = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (isHardBoundary(line)) {
        flushSegment();
        output.push(line);
        sourceParagraphs += 1;
        outputParagraphs += 1;
      } else {
        segment.push(line);
      }
    }
    flushSegment();

    return {
      text: output.join('\r\n\r\n') + (output.length ? '\r\n' : ''),
      sourceParagraphs,
      outputParagraphs,
      mergedCount: Math.max(0, sourceParagraphs - outputParagraphs)
    };
  }

  return {
    MODE_OPTIONS,
    visibleLength,
    isHardBoundary,
    normalizeInlineWhitespace,
    optimizeParagraphs,
    optimizeDocumentText
  };
});
