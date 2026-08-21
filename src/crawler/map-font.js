// Phase 1: build PUA codepoint -> real character mapping by matching
// the obfuscation font's glyph outlines against a reference Source Han Sans font.
const fs = require('fs');
const path = require('path');
const fonteditor = require('fonteditor-core');
const wawoff2 = require('wawoff2');

// Normalize a glyph's contours into a canonical, comparable signature.
// Strategy: translate bbox to origin, then round to integer, serialize.
function glyphSignature(contours) {
  if (!contours || !contours.length) return null;
  let minX = Infinity, minY = Infinity;
  for (const c of contours) {
    for (const p of c) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
    }
  }
  const out = [];
  for (const c of contours) {
    const cc = [];
    for (const p of c) {
      cc.push(Math.round(p.x - minX), Math.round(p.y - minY), p.onCurve ? 1 : 0);
    }
    out.push(cc.join(','));
  }
  return out.join('|');
}

async function loadObfuscationFont() {
  const woff2Buf = fs.readFileSync(path.join(__dirname, '..', '..', 'cache', 'dc027189e0ba4cd.woff2'));
  const ttfBuf = Buffer.from(await wawoff2.decompress(woff2Buf));
  const font = fonteditor.Font.create(ttfBuf, { type: 'otf', hinting: false });
  return font.get();
}

function loadReferenceFont() {
  const buf = fs.readFileSync(path.join(__dirname, '..', '..', 'cache', 'SourceHanSansCN-Normal.otf'));
  const font = fonteditor.Font.create(buf, { type: 'otf', hinting: false });
  return font.get();
}

async function main() {
  const obf = await loadObfuscationFont();
  const ref = loadReferenceFont();

  console.log('=== unitsPerEm ===');
  console.log('obf unitsPerEm:', obf.head.unitsPerEm);
  console.log('ref unitsPerEm:', ref.head.unitsPerEm);
  console.log('ref name version:', ref.name && ref.name.version);
  console.log('ref glyph count:', ref.glyf.length);

  // Build reference signature -> codepoint(s) map
  const refMap = new Map();
  for (const g of ref.glyf) {
    const cps = (g.unicode || []).filter(u => u > 0);
    if (!cps.length) continue;
    const sig = glyphSignature(g.contours);
    if (sig == null) continue;
    // Prefer the first unicode; store all for CJK
    if (!refMap.has(sig)) refMap.set(sig, cps);
  }
  console.log('ref signature map size:', refMap.size);

  // Match obfuscation PUA glyphs
  let matched = 0, unmatched = 0, multi = 0;
  const mapping = {}; // PUA codepoint -> { char, charCode, alternatives }
  for (const g of obf.glyf) {
    const puaCps = (g.unicode || []).filter(u => u >= 0xE000 && u <= 0xF8FF);
    if (!puaCps.length) continue;
    const sig = glyphSignature(g.contours);
    const hit = sig != null ? refMap.get(sig) : null;
    if (hit && hit.length) {
      matched++;
      const pua = puaCps[0];
      const charCode = hit[0];
      mapping[pua] = { char: String.fromCodePoint(charCode), charCode, alternatives: hit };
      if (hit.length > 1) multi++;
    } else {
      unmatched++;
      if (unmatched <= 20) {
        console.log('UNMATCHED PUA U+' + puaCps[0].toString(16).toUpperCase() + ' contours=' + g.contours.length + ' pts=' + g.contours.reduce((n,c)=>n+c.length,0));
      }
    }
  }
  console.log('=== match result ===');
  console.log('matched:', matched, 'unmatched:', unmatched, 'multi-alternative:', multi);
  console.log('mapping size:', Object.keys(mapping).length);

  // Save mapping
  const outPath = path.join(__dirname, '..', '..', 'cache', 'font-map-dc027189e0ba4cd.json');
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2));
  console.log('saved mapping to', outPath);

  // Print a sample of the mapping
  const entries = Object.entries(mapping).slice(0, 30);
  for (const [pua, v] of entries) {
    console.log('U+' + Number(pua).toString(16).toUpperCase(), '->', v.char, '(U+' + v.charCode.toString(16).toUpperCase() + ')');
  }
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
