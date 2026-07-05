/**
 * Adapter for leagueofcomicgeeks.com — both the "New Comics" list pages and
 * individual issue detail pages.
 *
 * List-page selectors verified against a live page on 2026-07-05:
 * https://leagueofcomicgeeks.com/comics/new-comics/2021/07/07
 * Each release week is rendered as `li.issue` (168 elements on that page —
 * this includes 141 hidden variant covers). `li.issue[data-parent="0"]`
 * isolates just the 27 main (non-variant) cards. All cards are present in
 * the initial DOM with no AJAX wait needed.
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
    detailTitle: 'h1, .comic-title',
    detailVolume: '.volume, .series-volume',
    detailPublisher: '.publisher a, .publisher',
    detailPublishDate: '.release-date, time',
    detailThumbnail: '.comic-cover img, .cover img',
  };

  function getPageType() {
    const path = window.location.pathname;
    if (/\/comics\/new-comics/.test(path)) return 'list';
    if (/\/comic\/\d+/.test(path) || /\/comics\/\d+/.test(path)) return 'detail';
    return null;
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
      thumbnail: card.querySelector(SELECTORS.listThumbnail)?.src ?? null,
    };
  }

  function parseDetailPage() {
    const { series, number } = splitSeriesAndNumber(textOf(document, SELECTORS.detailTitle) || '');
    return {
      series,
      number,
      volume: textOf(document, SELECTORS.detailVolume),
      publisher: textOf(document, SELECTORS.detailPublisher),
      publishDate: normalizeDate(textOf(document, SELECTORS.detailPublishDate)),
      thumbnail: document.querySelector(SELECTORS.detailThumbnail)?.src ?? null,
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

  initAdapter({ getPageType, getItemCards, parseCard, parseDetailPage });
})();
