/**
 * Validate Fandom thumbnail extraction against saved page HTML.
 * Run: node scripts/inspect-fandom-html.mjs  (downloads patterns)
 *      node scripts/test-fandom-adapter.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const htmlPath = path.join(os.tmpdir(), 'buffy-fandom.html');
if (!fs.existsSync(htmlPath)) {
  console.error('Missing', htmlPath, '- run: curl -sL "https://buffy.fandom.com/wiki/Publication_order_of_comics" -o', htmlPath);
  process.exit(1);
}

function normalizeFandomImageUrl(raw) {
  if (!raw || raw.startsWith('data:')) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.nocookie.net')) return null;
  url.pathname = url.pathname
    .replace(/\/scale-to-width-down\/\d+/, '')
    .replace(/\/scale-to-height-down\/\d+/, '')
    .replace(/\/zoom-crop\/width-\d+-height-\d+/, '');
  return url.href;
}

function extractFromCoverHtml(coverHtml) {
  const links = [...coverHtml.matchAll(/<a[^>]+href="([^"]+)"/gi)].map((m) => m[1]);
  for (const href of links) {
    const url = normalizeFandomImageUrl(href);
    if (url) return url;
  }
  const img = coverHtml.match(/<img[^>]+>/i)?.[0] ?? '';
  for (const attr of ['data-src', 'data-lazy-src', 'src']) {
    const match = img.match(new RegExp(`${attr}="([^"]+)"`, 'i'));
    const url = match ? normalizeFandomImageUrl(match[1]) : null;
    if (url) return url;
  }
  return null;
}

const html = fs.readFileSync(htmlPath, 'utf8');
const tables = [...html.matchAll(/<table class="wikitable[^"]*"[\s\S]*?<\/table>/g)];

let total = 0;
let missing = 0;
let scaled = 0;

for (const table of tables) {
  for (const row of table[0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    if (/<th[\s>]/i.test(row[0])) continue;
    const cells = [...row[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/g)];
    if (cells.length !== 3) continue;
    total++;
    const thumb = extractFromCoverHtml(cells[0][0]);
    if (!thumb) missing++;
    else if (thumb.includes('scale-to-width-down')) scaled++;
  }
}

console.log({ total, missing, scaled, ok: missing === 0 && scaled === 0 });
if (missing || scaled) process.exit(1);
