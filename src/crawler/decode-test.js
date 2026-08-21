// Phase 1: verify the charset-based deobfuscation on a real chapter.
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const CODE = [[58344, 58715], [58345, 58716]]; // PUA ranges, [lo, hi]

// Extract the JSON object right after `window.__INITIAL_STATE__=`.
function extractJson(html, key) {
  const i = html.indexOf(key);
  if (i < 0) return null;
  const j = html.indexOf('{', i);
  let depth = 0, inStr = false, esc = false;
  for (let k = j; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(j, k + 1); }
  }
  return null;
}

function decode(content, charset, mode) {
  const [lo, hi] = CODE[mode];
  let out = '';
  for (const ch of content) {
    const uni = ch.codePointAt(0);
    if (uni >= lo && uni <= hi) {
      const bias = uni - lo;
      out += (bias >= 0 && bias < charset[mode].length && charset[mode][bias] !== '?') ? charset[mode][bias] : ch;
    } else {
      out += ch;
    }
  }
  return out;
}

function countPua(text) {
  let n = 0;
  for (const ch of text) {
    const u = ch.codePointAt(0);
    if ((u >= 0xE3E8 && u <= 0xE55B) || (u >= 0xE3E9 && u <= 0xE55C)) n++;
  }
  return n;
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function main() {
  const charset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'cache', 'charset.json'), 'utf8'));
  const cid = '7662597696758235673';
  const r = await fetch('https://fanqienovel.com/reader/' + cid, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  let stateJson = extractJson(html, 'window.__INITIAL_STATE__=');
  // Sanitize JS literals that are not valid JSON.
  stateJson = stateJson.replace(/:undefined/g, ':null').replace(/:NaN/g, ':null').replace(/:Infinity/g, ':null');
  const state = JSON.parse(stateJson);
  const cd = state.reader.chapterData;
  console.log('title:', cd.title, '| bookName:', cd.bookName);

  const raw = cd.content;
  console.log('raw PUA count:', countPua(raw));

  for (const mode of [0, 1]) {
    const decoded = decode(raw, charset, mode);
    const text = stripHtml(decoded);
    console.log(`\n===== mode ${mode} (residual PUA: ${countPua(text)}) =====`);
    console.log(text.slice(0, 400));
  }
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
