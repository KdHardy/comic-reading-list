/**
 * Adapter for Fandom wiki comic list pages (e.g. buffy.fandom.com).
 *
 * List-page selectors verified against a live page on 2026-07-24:
 * https://buffy.fandom.com/wiki/Publication_order_of_comics
 *
 * Fandom cover column structure (inside `table.wikitable`, 3-cell rows):
 *   <td>
 *     <a href="https://static.wikia.nocookie.net/.../File.jpg/revision/latest?cb=...">
 *       <img class="mw-file-element lazyload"
 *            src="data:image/gif;base64,..."           <!-- placeholder -->
 *            data-src=".../revision/latest/scale-to-width-down/90?cb=..." />
 *     </a>
 *   </td>
 *
 * The anchor href is the full-size CDN URL. The img src/data-src are lazy previews.
 * Always prefer the anchor href; fall back to img data-src/src with scaling stripped.
 *
 * Each comic spans two table rows:
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

    const thumbnail = extractThumbnail(coverCell);

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

  function extractThumbnail(coverCell) {
    if (!coverCell) return null;

    // Full-size file link — present in the static HTML even before lazyload runs.
    for (const link of coverCell.querySelectorAll('a[href]')) {
      const url = normalizeFandomImageUrl(link.href);
      if (url) return url;
    }

    const img = coverCell.querySelector('img');
    if (!img) return null;

    for (const attr of ['data-src', 'data-lazy-src', 'src']) {
      const url = normalizeFandomImageUrl(img.getAttribute(attr));
      if (url) return url;
    }

    return null;
  }

  function normalizeFandomImageUrl(raw) {
    if (!raw || raw.startsWith('data:')) return null;

    let url;
    try {
      url = new URL(raw, document.baseURI);
    } catch {
      return null;
    }

    if (url.protocol !== 'https:' || !url.hostname.endsWith('.nocookie.net')) {
      return null;
    }

    url.pathname = url.pathname
      .replace(/\/scale-to-width-down\/\d+/, '')
      .replace(/\/scale-to-height-down\/\d+/, '')
      .replace(/\/zoom-crop\/width-\d+-height-\d+/, '');

    return url.href;
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
