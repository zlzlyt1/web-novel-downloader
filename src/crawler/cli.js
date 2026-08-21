// 命令行测试入口：下载一本书并保存为 txt。
// 用法：node src/crawler/cli.js <书籍URL> [章节数上限] [输出目录]
const path = require('path');
const { Downloader } = require('./downloader');
const { saveTxt } = require('./txt');

async function main() {
  const url = process.argv[2];
  const limit = parseInt(process.argv[3] || '0', 10);
  const outDir = process.argv[4] || path.join(__dirname, '..', '..', 'novels');
  if (!url) {
    console.error('用法：node src/crawler/cli.js <书籍URL> [章节数上限] [输出目录]');
    process.exit(1);
  }

  let lastDone = 0;
  const dl = new Downloader({
    minInterval: 600,
    maxChapters: limit || 0,
    onProgress: (p) => {
      if (p.stage === 'chapter' && p.done !== lastDone) {
        lastDone = p.done;
        console.log(`  [${p.done}/${p.total}] ${p.current}`);
      } else if (p.stage === 'book') {
        console.log(p.message);
      }
    },
  });

  console.log('开始下载:', url);
  const { book, chapters, failed } = await dl.download(url);
  const out = chapters;

  // 累计残留 PUA 检查
  let residual = 0;
  for (const c of out) residual += c.residual || 0;

  const filePath = saveTxt(book, out, outDir);
  console.log('--- 结果 ---');
  console.log('书名:', book.bookName);
  console.log('作者:', book.author);
  console.log('章节数:', chapters.length, '| 导出章节:', out.length, '| 失败:', failed.length);
  console.log('残留 PUA 字符:', residual);
  console.log('保存到:', filePath);
}

main().catch((e) => {
  console.error('下载失败:', e.message);
  process.exit(1);
});
