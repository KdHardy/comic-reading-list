/**
 * Adapter for comicbookherald.com reading-order guide pages (list pages only —
 * this site doesn't have single-issue detail pages).
 *
 * Verified against a real page (see comment below) on 2026-07-05: each
 * checklist entry is a <p> containing an <a class="amzn_ps_bm_tl"> affiliate
 * link, whose text is the "Series #Number" title. Narrative/description
 * paragraphs don't have that anchor class, so filtering on it cleanly
 * separates real entries from surrounding prose. Indented tie-in issues get
 * an inline `padding-left: 40px` style on the <p>; that's ignored here since
 * the spec treats every checklist entry the same way.
 *
 * Verified example: https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/marvel-fresh-start-reading-order/the-last-annihilation/
 * Other reading-order pages on the site may use a slightly different
 * template — if an adapter update finds a page with no matches, check
 * whether it uses a <ul>/<li> list instead of <p> paragraphs.
 */
(function () {
  const ITEM_LINK_SELECTOR = 'a.amzn_ps_bm_tl';

  function getPageType() {
    return document.querySelector(ITEM_LINK_SELECTOR) ? 'list' : null;
  }

  function getItemCards() {
    const links = Array.from(document.querySelectorAll(ITEM_LINK_SELECTOR));
    const cards = [];
    for (const link of links) {
      const card = link.closest('p') || link.parentElement;
      if (card && !cards.includes(card)) cards.push(card);
    }
    return cards;
  }

  function parseCard(card) {
    const link = card.querySelector(ITEM_LINK_SELECTOR);
    const titleText = (link?.textContent || '').trim();
    const { series, number } = splitSeriesAndNumber(titleText);
    return {
      series,
      number,
      volume: null,
      publisher: guessPublisherFromPage(),
      publishDate: null,
      thumbnail: null,
    };
  }

  // "Series Name #12" -> { series: 'Series Name', number: '12' }.
  function splitSeriesAndNumber(text) {
    const match = text.match(/^(.*?)\s*#(\d+[A-Za-z]?)$/);
    if (match) return { series: match[1].trim(), number: match[2] };
    return { series: text.trim(), number: null };
  }

  // No per-item publisher is present in the markup, so this is a best-effort
  // guess from the page URL/title. Leaves null (fine per spec) if unsure.
  function guessPublisherFromPage() {
    const haystack = `${window.location.pathname} ${document.title}`.toLowerCase();
    if (haystack.includes('marvel')) return 'Marvel';
    if (haystack.includes(' dc ') || haystack.includes('dc-comics') || haystack.includes('batman') || haystack.includes('superman')) {
      return 'DC Comics';
    }
    return null;
  }

  initAdapter({ getPageType, getItemCards, parseCard });
})();
