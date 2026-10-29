/**
 * Adapter for leagueofcomicgeeks.com — the "New Comics" list pages, series
 * search pages, and individual issue detail pages.
 *
 * List-page selectors verified against a live page on 2026-07-05:
 * https://leagueofcomicgeeks.com/comics/new-comics/2021/07/07
 * and re-checked against saved pages on 2026-10-29:
 * https://leagueofcomicgeeks.com/comics/new-comics (week of 2026-10-21)
 * https://leagueofcomicgeeks.com/search/151468?keyword=trial%20of%20magneto
 * Detail-page selectors verified 2026-08-08:
 * https://leagueofcomicgeeks.com/comic/1664000/batman-110
 *
 * Each release week is rendered as `li.issue` (168 elements on that page —
 * this includes 141 hidden variant covers). `li.issue[data-parent="0"]`
 * isolates just the 27 main (non-variant) cards. Series search pages
 * (/search/<series id>) use the identical card markup, with variants marked
 * the same way. Search results are loaded in batches as you scroll
 * (`#comic-list-block[data-list-offset]`), so only cards already loaded are
 * captured. Covers are lazy-loaded: until a card scrolls into view its `src`
 * is a placeholder GIF and the real URL is in `data-src`.
 */
(function () {
  const SELECTORS = {
    // --- List page ("New Comics this week") ---
    listItemCard: 'li.issue[data-parent="0"]',
    listTitle: '.title a',
    listPublisher: '.publisher',
    listDate: '.details .date',
    listThumbnail: '.cover img',

    // --- Detail page (single issue) ---
    detailTitle: '#comic-header h1',
    detailVolume: '.volume, .series-volume',
    detailPublisher: '#comic-header .header-intro a[href^="/comics/"]',
    detailReleaseLink: '#comic-header .header-intro a[href*="/comics/new-comics/"]',
    detailThumbnail: '#comic-header .cover-art img, .comic-cover-view .cover-art img',
  };

  function getPageType() {
    const path = window.location.pathname;
    if (/\/comics\/new-comics/.test(path) || isSearchPage()) return 'list';
    if (/\/comic\/\d+/.test(path) || /\/comics\/\d+/.test(path)) return 'detail';
    return null;
  }

  function isSearchPage() {
    return /^\/search\/\d+/.test(window.location.pathname);
  }

  function getListHint() {
    return isSearchPage() ? 'Scroll to the bottom first to load every issue.' : null;
  }

  function textOf(root, selector) {
    const el = root.querySelector(selector);
    return el ? el.textContent.trim() : null;
  }

  function getItemCards() {
    return Array.from(document.querySelectorAll(SELECTORS.listItemCard));
  }

  function parseCard(card) {
    const { series, number } = splitSeriesAndNumber(textOf(card, SELECTORS.listTitle) || '');
    // The date span carries a `data-date` attribute with a Unix epoch
    // (seconds), which is more reliable than parsing the "Jul 6th, 2021"
    // display text.
    const epochSeconds = card.querySelector(SELECTORS.listDate)?.getAttribute('data-date');
    const publishDate = epochSeconds ? new Date(Number(epochSeconds) * 1000).toISOString().slice(0, 10) : null;

    return {
      series,
      number,
      volume: null,
      publisher: textOf(card, SELECTORS.listPublisher),
      publishDate,
      thumbnail: getImageUrl(card.querySelector(SELECTORS.listThumbnail)),
    };
  }

  // Prefers a real `src`, falling back to the lazy-load `data-src` for
  // covers that haven't scrolled into view yet.
  function getImageUrl(img) {
    const src = img?.getAttribute('src');
    if (src && !src.startsWith('data:')) return img.src;

    const lazySrc = img?.getAttribute('data-src');
    if (lazySrc && !lazySrc.startsWith('data:')) return lazySrc;

    return null;
  }

  function parseDetailReleaseDate() {
    const releaseLink = document.querySelector(SELECTORS.detailReleaseLink);
    if (!releaseLink) return null;

    const fromHref = releaseLink.getAttribute('href')?.match(/\/comics\/new-comics\/(\d{4})\/(\d{2})\/(\d{2})/);
    if (fromHref) {
      return `${fromHref[1]}-${fromHref[2]}-${fromHref[3]}`;
    }

    return normalizeDate(releaseLink.textContent.trim());
  }

  function parseDetailCoverDate() {
    const blocks = document.querySelectorAll('#summary .details-addtl-block');
    for (const block of blocks) {
      if (block.querySelector('.name')?.textContent.trim() !== 'Cover Date') continue;
      return normalizeDate(block.querySelector('.value')?.textContent.trim() ?? '');
    }
    return null;
  }

  function getDetailThumbnailUrl() {
    return getImageUrl(document.querySelector(SELECTORS.detailThumbnail))
      ?? document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null;
  }

  function parseDetailPage() {
    const { series, number } = splitSeriesAndNumber(textOf(document, SELECTORS.detailTitle) || '');
    return {
      series,
      number,
      volume: textOf(document, SELECTORS.detailVolume),
      publisher: textOf(document, SELECTORS.detailPublisher),
      publishDate: parseDetailReleaseDate() ?? parseDetailCoverDate(),
      thumbnail: getDetailThumbnailUrl(),
    };
  }

  // "Series Name #12" -> { series: 'Series Name', number: '12' }.
  // Leaves fields blank rather than guessing wrong, per spec.
  function splitSeriesAndNumber(text) {
    const match = text.match(/^(.*?)\s*#(\d+[A-Za-z]?)$/);
    if (match) return { series: match[1].trim(), number: match[2] };
    return { series: text.trim(), number: null };
  }

  function normalizeDate(text) {
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  initAdapter({ getPageType, getItemCards, parseCard, parseDetailPage, getListHint });
})();
