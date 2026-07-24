import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const html = fs.readFileSync(path.join(os.tmpdir(), 'buffy-fandom.html'), 'utf8');
const tables = [...html.matchAll(/<table class="wikitable[^"]*"[\s\S]*?<\/table>/g)];

for (let t = 0; t < tables.length; t++) {
  let threeCell = 0;
  let withNocookie = 0;
  let withFileLink = 0;
  let noThumb = 0;
  for (const row of tables[t][0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    if (/<th[\s>]/i.test(row[0])) continue;
    const cells = [...row[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/g)];
    if (cells.length !== 3) continue;
    threeCell++;
    const cover = cells[0][0];
    if (/nocookie\.net/.test(cover)) withNocookie++;
    else if (/\/wiki\/File:/.test(cover)) withFileLink++;
    else noThumb++;
  }
  if (threeCell > 0) {
    console.log(`Table ${t + 1}: ${threeCell} comics, nocookie=${withNocookie}, file=${withFileLink}, missing=${noThumb}`);
  }
}

// Check for alternate CDN hostnames
const hosts = new Set([...html.matchAll(/https:\/\/([a-z0-9.-]+\/(?:buffy|images)[^"'\\s]*)/gi)].map((m) => m[1].split('/')[0]));
console.log('\nImage hosts:', [...hosts].filter((h) => h.includes('wikia') || h.includes('fandom') || h.includes('nocookie')).slice(0, 20));
