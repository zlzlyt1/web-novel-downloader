// Phase 1 spike: parse the obfuscation font and inspect its structure.
const fs = require('fs');
const path = require('path');
const fonteditor = require('fonteditor-core');
const wawoff2 = require('wawoff2');

async function main() {
  const fontPath = path.join(__dirname, '..', '..', 'cache', 'dc027189e0ba4cd.woff2');
  const woff2Buf = fs.readFileSync(fontPath);

  // Convert woff2 -> ttf via wawoff2 (google woff2 wasm), then parse ttf.
  const ttfBuf = Buffer.from(await wawoff2.decompress(woff2Buf));
  console.log('ttf buffer size:', ttfBuf.length, 'magic:', ttfBuf.slice(0, 4).toString('hex'));

  // The decompressed font is an OpenType/CFF font (magic OTTO), use 'otf' reader.
  const font = fonteditor.Font.create(ttfBuf, { type: 'otf', hinting: false });
  const ttf = font.get();

  console.log('=== font meta ===');
  console.log('glyf count:', ttf.glyf.length);
  console.log('cmap size:', Object.keys(ttf.cmap || {}).length);
  console.log('name:', JSON.stringify(ttf.name));
  console.log('maxp.numGlyphs:', ttf.maxp && ttf.maxp.numGlyphs);

  // Inspect glyph unicode values
  const glyphs = ttf.glyf;
  const puaGlyphs = glyphs.filter(g => (g.unicode || []).some(u => u >= 0xE000 && u <= 0xF8FF));
  const asciiGlyphs = glyphs.filter(g => (g.unicode || []).some(u => u < 0x80));
  console.log('glyphs with PUA unicode:', puaGlyphs.length);
  console.log('glyphs with ascii unicode:', asciiGlyphs.length);

  // sample some glyphs
  console.log('=== sample glyphs ===');
  for (const g of glyphs.slice(0, 5)) {
    console.log(JSON.stringify({
      unicode: g.unicode,
      unicodeHex: (g.unicode || []).map(u => 'U+' + u.toString(16).toUpperCase()),
      name: g.name,
      contours: g.contours.length,
      points: g.contours.reduce((n, c) => n + c.length, 0),
      xMin: g.xMin, yMin: g.yMin, xMax: g.xMax, yMax: g.yMax,
      advanceWidth: g.advanceWidth,
    }));
  }

  // sample a PUA glyph's first contour points
  const pua = puaGlyphs[0];
  if (pua) {
    console.log('=== first PUA glyph ===');
    console.log('unicode:', pua.unicode.map(u => 'U+' + u.toString(16).toUpperCase()), 'name:', pua.name);
    console.log('contours:', pua.contours.length, 'points:', pua.contours.reduce((n, c) => n + c.length, 0));
    console.log('first contour sample:', JSON.stringify(pua.contours[0].slice(0, 10)));
  }

  // check glyph names pattern
  const names = glyphs.slice(0, 30).map(g => g.name);
  console.log('=== first 30 glyph names ===');
  console.log(JSON.stringify(names));
}

main().catch(e => { console.error('SPIKE ERROR:', e); process.exit(1); });
