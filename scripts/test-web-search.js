'use strict';

const assert = require('node:assert/strict');
const {
  cleanQuery,
  buildSearchUrl,
  classifySource,
  filterRelevantResults,
  isFanqieDownloadable,
  parseBingResults
} = require('../src/search/web-search');

const fixture = `
<ol>
  <li class="b_algo"><h2><a href="https://fanqienovel.com/page/7366503170765245502">只赚钱不谈情，职业舔狗我最行！</a></h2><div class="b_caption"><p>长叹一声创作的都市小说。</p></div></li>
  <li class="b_algo"><h2><a href="https://www.qidian.com/book/123/">同名小说 - 起点中文网</a></h2><p>来自其他正版平台的结果。</p></li>
  <li class="b_algo"><h2><a href="javascript:alert(1)">不安全链接</a></h2></li>
</ol>`;

const results = parseBingResults(fixture);
assert.equal(results.length, 2);
assert.equal(results[0].source, '番茄小说');
assert.equal(results[0].canDownload, true);
assert.equal(results[1].source, '起点中文网');
assert.equal(results[1].canDownload, true);
assert.equal(classifySource('https://book.qidian.com/info/1/').source, '起点中文网');
assert.equal(isFanqieDownloadable('https://fanqienovel.com/reader/123'), true);
assert.equal(isFanqieDownloadable('https://example.com/page/123'), false);
assert.equal(cleanQuery('  “测试  书名！”  '), '测试 书名');
assert.equal(new URL(buildSearchUrl('测试书名')).searchParams.get('q'), '"测试书名"');
assert.equal(filterRelevantResults(results, '只赚钱不谈情，职业舔狗我最行').length, 1);

console.log('web search parser tests passed');
