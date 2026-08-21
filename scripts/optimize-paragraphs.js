#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { optimizeDocumentText, MODE_OPTIONS } = require('../src/renderer/paragraph-optimizer');

function printUsage() {
  console.log('用法: node scripts/optimize-paragraphs.js <输入.txt> [输出.txt] [--mode balanced|fill]');
  console.log('默认在原文件旁生成“文件名.段落优化.txt”，不会覆盖原文件。');
}

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(args.length ? 0 : 1);
}

let mode = 'fill';
const modeIndex = args.indexOf('--mode');
if (modeIndex >= 0) {
  mode = args[modeIndex + 1];
  args.splice(modeIndex, 2);
}
if (!MODE_OPTIONS[mode] || mode === 'off') {
  console.error(`不支持的模式：${mode}；可选 balanced 或 fill。`);
  process.exit(1);
}

const inputPath = path.resolve(args[0]);
const parsed = path.parse(inputPath);
const outputPath = path.resolve(args[1] || path.join(parsed.dir, `${parsed.name}.段落优化${parsed.ext || '.txt'}`));

if (inputPath.toLowerCase() === outputPath.toLowerCase()) {
  console.error('为保护原文件，输出路径不能与输入路径相同。');
  process.exit(1);
}
if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
  console.error(`找不到输入文件：${inputPath}`);
  process.exit(1);
}

const source = fs.readFileSync(inputPath, 'utf8');
const result = optimizeDocumentText(source, { mode });
fs.writeFileSync(outputPath, result.text, 'utf8');

console.log(`段落优化完成（${mode === 'fill' ? '铺满' : '均衡'}模式）`);
console.log(`原段落：${result.sourceParagraphs}`);
console.log(`优化后：${result.outputParagraphs}`);
console.log(`合并数：${result.mergedCount}`);
console.log(`输出：${outputPath}`);
