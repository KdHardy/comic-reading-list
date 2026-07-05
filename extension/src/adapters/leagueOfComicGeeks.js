/**
 * Adapter for leagueofcomicgeeks.com — both the "New Comics" list pages and
 * individual issue detail pages.
 *
 * IMPORTANT: the site's markup is rendered client-side by JavaScript and
 * wasn't inspectable while scaffolding this adapter (only pre-render HTML
 * was available). The selectors below are best-effort placeholders — before
 * relying on this adapter, open a real "New Comics" page and an issue page
 * in devtools, inspect the actual card/detail markup, and update SELECTORS
 * to match. Everything else (page-type detection, parsing flow, UI
 * injection) is wired up and shouldn't need to change.
 */
(function () {
  const SELECTORS = {
    // --- List page ("New Comics this week") ---
    listItemCard: '.comic-item, .list-comic, [data-comic-id]', // TODO verify against live DOM
    listTitle: '.title, .comic-title, a.title', // TODO verify
    listPublisher: '.publisher', // TODO verify
    listThumbnail: 'img',

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
    return {
      series,
      number,
      volume: null,
      publisher: textOf(card, SELECTORS.listPublisher),
      publishDate: null,
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
