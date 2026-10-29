/**
 * Validate the League of Comic Geeks list-page adapter against saved page HTML.
 *
 * Save each page from a real browser (scroll to the bottom first, then
 * Ctrl+S → "Webpage, HTML only") — LoCG sits behind a Cloudflare check, so
 * curl won't work. Expected files (override with env vars):
 *   LOCG_SEARCH_HTML      <tmp>/locg-search-trial-of-magneto.html
 *     https://leagueofcomicgeeks.com/search/151468?keyword=trial%20of%20magneto
 *   LOCG_NEW_COMICS_HTML  <tmp>/locg-new-comics-2026-10-21.html
 *     https://leagueofcomicgeeks.com/comics/new-comics/2026/10/21
 *
 * Run (jsdom comes from the web app's dependencies):
 *   cd web && npm install && cd ..
 *   node scripts/test-locg-adapter.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'web', 'package.json'));
const { JSDOM } = require('jsdom');

const adapterSource = fs.readFileSync(
  path.join(repoRoot, 'extension', 'src', 'adapters', 'leagueOfComicGeeks.js'),
  'utf8',
);

function loadAdapter(htmlPath, url) {
  const html = htmlPath ? fs.readFileSync(htmlPath, 'utf8') : '';
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  let adapter = null;
  dom.window.initAdapter = (a) => { adapter = a; };
  dom.window.eval(adapterSource);
  return adapter;
}

function check(name, htmlPath, url, run) {
  if (!fs.existsSync(htmlPath)) {
    console.warn(`SKIP ${name}: missing ${htmlPath} (see header comment for how to save it)`);
    return;
  }
  run(loadAdapter(htmlPath, url));
  console.log(`PASS ${name}`);
}

// URL routing needs no saved HTML. Both series URL forms show the same list.
for (const [url, expectedType, expectedHint] of [
  ['https://leagueofcomicgeeks.com/comics/new-comics/2026/10/21', 'list', false],
  ['https://leagueofcomicgeeks.com/search/143655?keyword=Excalibur', 'list', true],
  ['https://leagueofcomicgeeks.com/comics/series/145093/wolverine', 'list', true],
  ['https://leagueofcomicgeeks.com/comic/1664000/batman-110', 'detail', false],
  ['https://leagueofcomicgeeks.com/comics/marvel', null, false],
]) {
  const adapter = loadAdapter(null, url);
  assert.equal(adapter.getPageType(), expectedType, url);
  assert.equal(Boolean(adapter.getListHint()), expectedHint, url);
}
console.log('PASS page type routing');

const searchPath = process.env.LOCG_SEARCH_HTML ?? path.join(os.tmpdir(), 'locg-search-trial-of-magneto.html');
const newComicsPath = process.env.LOCG_NEW_COMICS_HTML ?? path.join(os.tmpdir(), 'locg-new-comics-2026-10-21.html');

// The saved page is the Trial of Magneto search results; the same series
// is also listed at /comics/series/151468/<slug>.
check('search page', searchPath, 'https://leagueofcomicgeeks.com/search/151468?keyword=trial%20of%20magneto', (adapter) => {
  assert.equal(adapter.getPageType(), 'list');
  assert.match(adapter.getListHint(), /Scroll/);

  // 6 main cards; the other 34 `li.issue` elements are hidden variants.
  // structuredClone copies the results out of the jsdom realm so deepEqual sees plain objects.
  const books = structuredClone(adapter.getItemCards().map((card) => adapter.parseCard(card)));
  assert.equal(books.length, 6);

  assert.deepEqual(books[0], {
    series: 'X-Men: The Trial of Magneto TP',
    number: null,
    volume: null,
    publisher: 'Marvel Comics',
    publishDate: '2022-03-09',
    thumbnail: 'https://s3.amazonaws.com/comicgeeks/comics/covers/medium-9539198.jpg?1690090730',
  });
  assert.deepEqual(
    books.slice(1).map((b) => [b.series, b.number, b.publishDate]),
    [
      ['X-Men: The Trial of Magneto', '5', '2021-12-22'],
      ['X-Men: The Trial of Magneto', '4', '2021-12-01'],
      ['X-Men: The Trial of Magneto', '3', '2021-10-20'],
      ['X-Men: The Trial of Magneto', '2', '2021-09-15'],
      ['X-Men: The Trial of Magneto', '1', '2021-08-18'],
    ],
  );
  for (const book of books) {
    assert.match(book.thumbnail, /^https:\/\/s3\.amazonaws\.com\/comicgeeks\/comics\/covers\/medium-\d+\.jpg/);
  }
});

check('new comics page', newComicsPath, 'https://leagueofcomicgeeks.com/comics/new-comics/2026/10/21', (adapter) => {
  assert.equal(adapter.getPageType(), 'list');
  assert.equal(adapter.getListHint(), null);

  // structuredClone copies the results out of the jsdom realm so deepEqual sees plain objects.
  const books = structuredClone(adapter.getItemCards().map((card) => adapter.parseCard(card)));
  assert.equal(books.length, 44);
  assert.deepEqual(books[0], {
    series: 'Absolute Green Arrow',
    number: '6',
    volume: null,
    publisher: 'DC Comics',
    publishDate: '2026-10-21',
    thumbnail: books[0].thumbnail,
  });
  assert.match(books[0].thumbnail, /^https:\/\/s3\.amazonaws\.com\/comicgeeks\/comics\/covers\/medium-5288957\.jpg/);
  assert.ok(books.every((b) => b.thumbnail && !b.thumbnail.startsWith('data:')), 'every cover resolved');
});
