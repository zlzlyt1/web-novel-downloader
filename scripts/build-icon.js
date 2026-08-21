#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'build', 'icon-source.jpg');
const icoPath = path.join(root, 'build', 'app.ico');
const pngPath = path.join(root, 'build', 'icon.png');
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function renderDib(size) {
  const { data } = await sharp(sourcePath)
    .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rowBytes = size * 4;
  const xor = Buffer.alloc(rowBytes * size);
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * size);

  for (let y = 0; y < size; y++) {
    const sourceY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const src = (sourceY * size + x) * 4;
      const dst = y * rowBytes + x * 4;
      xor[dst] = data[src + 2];
      xor[dst + 1] = data[src + 1];
      xor[dst + 2] = data[src];
      xor[dst + 3] = data[src + 3];
      if (data[src + 3] < 128) mask[y * maskRowBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8);
    }
  }

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xor.length + mask.length, 20);
  return Buffer.concat([header, xor, mask]);
}

function buildIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = headerSize;
  images.forEach(({ size, buffer }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += buffer.length;
  });
  return Buffer.concat([header, ...images.map(({ buffer }) => buffer)]);
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`图标源文件不存在：${sourcePath}`);
  const images = [];
  for (const size of sizes) {
    const buffer = await renderDib(size);
    images.push({ size, buffer });
  }
  fs.writeFileSync(icoPath, buildIco(images));
  await sharp(sourcePath).resize(512, 512, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(pngPath);
  console.log(`generated ${icoPath}`);
  console.log(`generated ${pngPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
