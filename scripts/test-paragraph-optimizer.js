'use strict';

const assert = require('node:assert/strict');
const { optimizeParagraphs, optimizeDocumentText } = require('../src/renderer/paragraph-optimizer');

const shortParagraphs = [
  '池越衫抬起头。',
  '窗外的雨还没有停。',
  '“你真的决定了吗？”',
  '他没有立刻回答。',
  '只是把桌上的信重新折好。',
  '那封信很薄，却像压住了整个夜晚。'
];
const filled = optimizeParagraphs(shortParagraphs, { mode: 'fill' });
assert.equal(filled.paragraphs.length, shortParagraphs.length, '铺满模式必须保留原始语义段落');
assert.ok(filled.paragraphs.every((p) => !p.includes('\u3000')), '铺满模式不能插入全角空格');

const messyDialogue = [
  '“你才十八岁， 为什么要沦落到这一行？！ ”',
  '管家：　　满嘴顺口溜， 你要考研啊？',
  '陆星没搭理管家， 低头继续数钱。'
];
const cleaned = optimizeParagraphs(messyDialogue, { mode: 'fill' });
assert.deepEqual(cleaned.paragraphs, [
  '“你才十八岁，为什么要沦落到这一行？！”',
  '管家：满嘴顺口溜，你要考研啊？',
  '陆星没搭理管家，低头继续数钱。'
]);

const hardWrapped = optimizeParagraphs(['窗外的雨越下越大，', '他仍站在没有灯的门口。', '“进来吧。”'], { mode: 'balanced' });
assert.deepEqual(hardWrapped.paragraphs, ['窗外的雨越下越大，他仍站在没有灯的门口。', '“进来吧。”']);

const boundaries = optimizeDocumentText('第一章 开始\n\n第一句。\n\n第二句。\n\n***\n\n第三句。', { mode: 'fill' });
assert.match(boundaries.text, /第一章 开始\r\n\r\n/);
assert.match(boundaries.text, /\*\*\*/);
assert.ok(!/开始\u3000\u3000第一句/.test(boundaries.text), '章节标题不能并入正文');
assert.ok(!boundaries.text.includes('\u3000'), '优化结果不能制造全角空格');

console.log('paragraph optimizer tests passed');
