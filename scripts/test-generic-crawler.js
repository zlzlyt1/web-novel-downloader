'use strict';

const assert = require('node:assert/strict');
const { parseBookPage, parseChapterPage, siteKey } = require('../src/crawler/generic');

const bookHtml = `<!doctype html><html><head>
  <meta property="og:novel:book_name" content="测试小说">
  <meta property="og:novel:author" content="测试作者">
  <meta name="description" content="这是一段简介。">
</head><body><h1>测试小说</h1><div class="catalog">
  <a href="/book/1/chapter/1">第一章 起点</a>
  <a href="/book/1/chapter/2#top">第二章 继续</a>
  <a href="https://other.example/chapter/3">第三章 外站</a>
  <a href="/login">登录</a>
</div></body></html>`;

const book = parseBookPage(bookHtml, 'https://www.example.com/book/1/');
assert.equal(book.bookName, '测试小说');
assert.equal(book.author, '测试作者');
assert.equal(book.chapters.length, 2);
assert.equal(book.chapters[1].url, 'https://www.example.com/book/1/chapter/2');
assert.equal(siteKey('m.example.com'), 'example.com');

const content = Array.from({ length: 8 }, (_, i) => `<p>这是测试小说第${i + 1}段正文，包含足够多的汉字来验证通用正文提取功能。</p>`).join('');
const chapter = parseChapterPage(`<html><body><nav>上一章 下一章</nav><div id="chaptercontent">${content}</div></body></html>`, 'https://www.example.com/book/1/chapter/1');
assert.equal(chapter.paragraphs.length, 8);
assert.match(chapter.text, /通用正文提取功能/);
assert.doesNotMatch(chapter.text, /上一章/);

assert.throws(() => parseBookPage('<html><title>普通页面</title></html>', 'https://example.com/'), /未识别到公开章节目录/);
assert.throws(() => parseChapterPage('<main><p>太短</p></main>', 'https://example.com/1'), /未提取到足够/);

console.log('generic crawler parser tests passed');
