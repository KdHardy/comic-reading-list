/**
 * Adapter for Fandom wiki comic list pages (e.g. buffy.fandom.com).
 *
 * List-page selectors verified against a live page on 2026-07-10:
 * https://buffy.fandom.com/wiki/Publication_order_of_comics
 *
 * Each comic spans two table rows inside `table.wikitable`:
 *   Row 1 (3 cells): cover image, title, release date
 *   Row 2 (2 cells): "Series: … Publisher: …", writer/artist credits
 * Some entries have an optional single-cell note row between them.
 */
(function () {
  function getPageType() {
    if (!/\.fandom\.com$/i.test(window.location.hostname)) return null;
    if (!window.location.pathname.startsWith('/wiki/')) return null;
    return hasComicListTables() ? 'list' : null;
  }

  function hasComicListTables() {
    return Array.from(document.querySelectorAll('table.wikitable tr')).some(
      (row) => row.cells.length === 2 && /Series:/i.test(row.cells[0]?.textContent ?? '')
    );
  }

  function getItemCards() {
    const cards = [];
    document.querySelectorAll('table.wikitable').forEach((table) => {
      table.querySelectorAll('tr').forEach((row) => {
        if (row.cells.length === 3 && !row.querySelector('th')) {
          cards.push(row);
        }
      });
    });
    return cards;
  }

  function parseCard(card) {
    const coverCell = card.cells[0];
    const titleCell = card.cells[1];
    const dateCell = card.cells[2];

    const img = coverCell?.querySelector('img');
    const thumbnail = img?.getAttribute('data-src') || img?.src || null;

    const title = titleCell?.textContent.trim() || '';
    const publishDate = normalizeDate(dateCell?.textContent.trim() || '');

    const metaText = metaRowText(card);
    const { series, number, publisher } = parseSeriesPublisher(metaText);

    return {
      series: series || title,
      number,
      volume: null,
      publisher,
      publishDate,
      thumbnail,
    };
  }

  function metaRowText(card) {
    let sibling = card.nextElementSibling;
    while (sibling && sibling.cells.length === 1) {
      sibling = sibling.nextElementSibling;
    }
    if (sibling && sibling.cells.length === 2) {
      return sibling.cells[0].textContent.trim();
    }
    return '';
  }

  function parseSeriesPublisher(text) {
    if (!text) return { series: null, number: null, publisher: null };

    const publisherMatch = text.match(/Publisher:\s*(.+)/i);
    const publisher = publisherMatch ? publisherMatch[1].split('\n')[0].trim() : null;
    const seriesPart = text
      .replace(/Publisher:\s*.+/is, '')
      .replace(/^Series:\s*/i, '')
      .trim();
    const { series, number } = splitSeriesAndNumber(seriesPart);

    return { series, number, publisher };
  }

  function splitSeriesAndNumber(text) {
    const spaced = text.match(/^(.*?)\s+#(\d+[A-Za-z]?)$/);
    if (spaced) return { series: spaced[1].trim(), number: spaced[2] };

    const tight = text.match(/^(.*?)#(\d+[A-Za-z]?)$/);
    if (tight) return { series: tight[1].trim(), number: tight[2] };

    return { series: text.trim(), number: null };
  }

  function normalizeDate(text) {
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  initAdapter({ getPageType, getItemCards, parseCard });
})();
