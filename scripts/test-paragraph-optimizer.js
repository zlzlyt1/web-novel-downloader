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
const optimized = optimizeParagraphs(shortParagraphs, { mode: 'optimized' });
assert.ok(optimized.paragraphs.length < shortParagraphs.length, '段落优化应合并手机端碎段');
assert.ok(optimized.paragraphs.includes('“你真的决定了吗？”'), '对话必须保持独立');
assert.ok(optimized.paragraphs.every((p) => !p.includes('\u3000')), '段落优化不能插入全角空格');

const messyDialogue = [
  '“你才十八岁， 为什么要沦落到这一行？！ ”',
  '管家：　　满嘴顺口溜， 你要考研啊？',
  '陆星没搭理管家， 低头继续数钱。'
];
const cleaned = optimizeParagraphs(messyDialogue, { mode: 'optimized' });
assert.deepEqual(cleaned.paragraphs, [
  '“你才十八岁，为什么要沦落到这一行？！”',
  '管家：满嘴顺口溜，你要考研啊？',
  '陆星没搭理管家，低头继续数钱。'
]);

const hardWrapped = optimizeParagraphs(['窗外的雨越下越大，', '他仍站在没有灯的门口。', '“进来吧。”'], { mode: 'optimized' });
assert.deepEqual(hardWrapped.paragraphs, ['窗外的雨越下越大，他仍站在没有灯的门口。', '“进来吧。”']);

const speechCue = optimizeParagraphs(['他终于抬起头。', '管家平复好情绪，解释道。', '“这件事没有你想得那么简单。”'], { mode: 'optimized' });
assert.deepEqual(speechCue.paragraphs, ['他终于抬起头。', '管家平复好情绪，解释道。', '“这件事没有你想得那么简单。”']);

const boundaries = optimizeDocumentText('第一章 开始\n\n第一句。\n\n第二句。\n\n***\n\n第三句。', { mode: 'optimized' });
assert.match(boundaries.text, /第一章 开始\r\n\r\n/);
assert.match(boundaries.text, /\*\*\*/);
assert.ok(!/开始\u3000\u3000第一句/.test(boundaries.text), '章节标题不能并入正文');
assert.ok(!boundaries.text.includes('\u3000'), '优化结果不能制造全角空格');

const mobileReaderParagraphs = [
  '两年半之前，魏老爹的宝贝女儿魏青鱼进入学校。',
  '魏青鱼长得清冷精致，但是性格冷漠寡言。',
  '虽然在陆星眼里她就是个呆头鹅，不过美貌是世界通用货币嘛。',
  '大把的人为了魏青鱼的美貌前仆后继，只可惜全部倒在了她的冷眼无视之下。',
  '抱着得不到就毁掉的态度。',
  '一时之间，谣言四起。',
  '“你才十八岁，为什么要沦落到这一行？！”',
  '陆星没搭理管家，低头继续数钱。'
];
const desktopReader = optimizeParagraphs(mobileReaderParagraphs, { mode: 'optimized' });
assert.ok(desktopReader.paragraphs.length <= 4, '手机端逐句段落应重组成较少的桌面自然段');
assert.ok(desktopReader.paragraphs.some((p) => p.includes('魏青鱼进入学校。魏青鱼长得清冷精致')), '连续中文叙述合并时不应加入空格');
assert.ok(desktopReader.paragraphs.includes('“你才十八岁，为什么要沦落到这一行？！”'), '长对话仍应独立显示');

const numberedChapter = optimizeDocumentText('001 第一章标题\n\n第一句。\n\n第二句。', { mode: 'optimized' });
assert.match(numberedChapter.text, /^001 第一章标题\r\n\r\n/);

console.log('paragraph optimizer tests passed');
