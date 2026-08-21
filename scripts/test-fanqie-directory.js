'use strict';

const assert = require('node:assert/strict');
const { parseDirectoryData, fetchChapterDirectory } = require('../src/crawler/fanqie');

const fixture = {
  data: {
    volumeNameList: ['第一卷'],
    chapterListWithVolume: [[
      { itemId: '1001', title: '第1章 开始', needPay: 0, isChapterLock: false },
      { itemId: '1002', title: '第2章 锁定', needPay: 1, isChapterLock: true }
    ]]
  }
};

const parsed = parseDirectoryData(fixture);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].volume, '第一卷');
assert.equal(parsed[1].needPay, true);
assert.equal(parsed[1].isChapterLock, true);

assert.deepEqual(parseDirectoryData({ data: { allItemIds: ['2001', 'bad', '2002'] } }).map((c) => c.itemId), ['2001', '2002']);
assert.equal(parseDirectoryData({ data: { nested: { items: [{ chapter_id: '3001', chapter_name: '第一章' }] } } })[0].itemId, '3001');

(async () => {
  let cached = null;
  const online = {
    fetchText: async () => ({ status: 200, text: JSON.stringify(fixture) }),
    writeJsonCache: (_key, value) => { cached = value; return true; },
    readJsonCache: () => null
  };
  assert.equal((await fetchChapterDirectory('123', online)).length, 2);
  assert.ok(cached);

  const offline = {
    fetchText: async () => { throw new Error('offline'); },
    writeJsonCache: () => false,
    readJsonCache: () => fixture
  };
  assert.equal((await fetchChapterDirectory('123', offline)).length, 2);
  console.log('fanqie directory fallback tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
