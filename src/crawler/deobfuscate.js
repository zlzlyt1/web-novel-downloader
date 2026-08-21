// 番茄小说正文反混淆：按索引偏移 + charset 映射表把 PUA 码位还原为真实字符。
// 机制：正文中的 PUA 码位 uni 落在 [base, base+N) 时，真实字符 = charset[uni - base]。
const fs = require('fs');
const path = require('path');

// 两套字体映射的 PUA 范围 [lo, hi]（mode0 为主，mode1 为备用，用于字体轮换时兜底）。
const CODE = [[58344, 58715], [58345, 58716]]; // 58344 = 0xE3E8

const CHARSET = JSON.parse(fs.readFileSync(path.join(__dirname, 'charset.json'), 'utf8'));

// 统计落在番茄 PUA 范围内的字符数（即未被解密的密文字符）。
function countPua(text) {
  let n = 0;
  for (const ch of text) {
    const u = ch.codePointAt(0);
    if ((u >= 58344 && u <= 58715) || (u >= 58345 && u <= 58716)) n++;
  }
  return n;
}

// 按指定 mode 解密；未被映射的码位原样保留（"? "条目会保留原 PUA 字符）。
function decode(content, mode) {
  const [lo] = CODE[mode];
  const table = CHARSET[mode];
  let out = '';
  for (const ch of content) {
    const uni = ch.codePointAt(0);
    const bias = uni - lo;
    if (bias >= 0 && bias < table.length && table[bias] !== '?') {
      out += table[bias];
    } else {
      out += ch;
    }
  }
  return out;
}

// 两套 mode 都试，返回残留 PUA 最少的结果。
function decodeBest(content) {
  let best = null;
  for (const mode of [0, 1]) {
    const text = decode(content, mode);
    const residual = countPua(text);
    if (!best || residual < best.residual) best = { text, mode, residual };
  }
  return best;
}

// 把正文 HTML（<p>…</p>）转为干净文本并解密。
// 返回 { paragraphs: string[], text: string, mode, residual }。
function decodeChapterContent(html) {
  const cleaned = stripHtml(html);
  const best = decodeBest(cleaned);
  const paragraphs = best.text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { paragraphs, text: best.text, mode: best.mode, residual: best.residual };
}

// HTML → 纯文本：段落/换行标签转 \n，去掉其余标签，解码常见实体。
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  CODE,
  CHARSET,
  countPua,
  decode,
  decodeBest,
  decodeChapterContent,
  stripHtml,
};
