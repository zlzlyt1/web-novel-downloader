// 验证 txt 组装与阅读器解析逻辑的一致性（离线、无网络）。
const { buildTxt } = require('./txt');

const VOLUME_RE = /^第\s*[0-9一二三四五六七八九十百千万零]+\s*[卷集]/;
const CHAPTER_RE = /^第\s*[0-9一二三四五六七八九十百千万零]+\s*[章节回]/;

const book = { bookName: '测试之书', author: '某人', description: '简介', category: '都市', status: 1 };
const chapters = [
  { title: '第1章 开始', volume: '第一卷：默认', paragraphs: ['第一段。', '第二段。', '第三段。'] },
  { title: '第2章 继续', volume: '第一卷：默认', paragraphs: ['又一段。'] },
  { title: '第3章 结尾', volume: '', paragraphs: ['结束。'] },
];

const txt = buildTxt(book, chapters);
console.log('=== 生成的 txt ===');
console.log(txt);

// 用阅读器的解析逻辑拆分
function parseTxt(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let cur = null;
  let curVolume = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (VOLUME_RE.test(line) && !CHAPTER_RE.test(line)) { curVolume = line; continue; }
    if (CHAPTER_RE.test(line)) { cur = { title: line, volume: curVolume, paragraphs: [] }; out.push(cur); continue; }
    if (cur) cur.paragraphs.push(line);
  }
  return out;
}

console.log('\n=== 解析结果 ===');
const parsed = parseTxt(txt);
for (const c of parsed) {
  console.log(`- [${c.volume}] ${c.title} (${c.paragraphs.length} 段): ${c.paragraphs.join(' / ')}`);
}
console.log('\n解析章节数:', parsed.length, '| 期望: 3');
