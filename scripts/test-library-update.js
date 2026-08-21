// 离线验证：增量更新只追加新章节，且元数据不重复记录。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendTxtChapters, createLibraryMeta, mergeNewChapters } = require('../src/crawler/library');
const { selectChapterRange } = require('../src/crawler/downloader');

const directory = Array.from({ length: 8 }, (_, index) => ({ itemId: `chapter-${index + 1}`, title: `第${index + 1}章` }));
assert.deepStrictEqual(selectChapterRange(directory, 4, 6).map((chapter) => chapter.itemId), ['chapter-4', 'chapter-5', 'chapter-6']);
assert.deepStrictEqual(selectChapterRange(directory, 9, 12), [], '起始章超过现有目录时不能错误下载最后一章');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-update-'));
const file = path.join(dir, 'test.txt');
try {
  fs.writeFileSync(file, '《测试书》\r\n\r\n第1章 已有\r\n\r\n旧正文\r\n', 'utf8');
  const oldChapter = { itemId: 'old-1', title: '第1章 已有', order: 1, paragraphs: ['旧正文'] };
  const newChapter = { itemId: 'new-2', title: '第2章 新章节', order: 2, paragraphs: ['新正文'] };
  const meta = createLibraryMeta(file, 'https://example.com/book', { bookName: '测试书' }, [oldChapter]);
  appendTxtChapters(file, [newChapter], meta.lastVolume);
  const next = mergeNewChapters(meta, [newChapter]);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /第2章 新章节/);
  assert.match(text, /新正文/);
  assert.strictEqual(next.chapters.length, 2);
  assert.strictEqual(next.chapters[1].key, 'new-2');
  assert.strictEqual(mergeNewChapters(next, [newChapter, newChapter]).chapters.length, 2);
  console.log('library update test passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
