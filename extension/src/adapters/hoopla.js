/**
 * Adapter for Hoopla Digital title pages. Per the spec's example — "The
 * Department of Truth Vol. 2: The City Upon a Hill Comic Issues #8-13 |
 * hoopla" — a single Hoopla page can represent a *bound collection* covering
 * a range of issues, not just one issue. Per the spec ("automatically grab
 * the details for the one comic"), this is treated as a single book entry
 * with `number` set to the whole range string (e.g. "8-13") rather than
 * trying to split it into multiple books.
 *
 * Verified against a live page on 2026-07-05:
 * https://www.hoopladigital.com/comic/spider-man-brand-new-day-vol-1-dan-slott/12020935
 * URLs are `/comic/<slug>/<id>` (NOT `/title/<id>` as originally guessed).
 * No login is required to see title/publisher/year/cover metadata. It's a
 * React SPA, but since parsing only runs when the user manually triggers
 * capture mode (after the page is already visible to them), no extra
 * async wait is needed here.
 */
(function () {
  function getPageType() {
    return /^\/comic\/[^/]+\/\d+/.test(window.location.pathname) ? 'detail' : null;
  }

  // Metadata chips render as two sibling leaf elements: a label (e.g. "Year")
  // followed by the value (e.g. "2011"), both children of a shared <div> or
  // <a> wrapper (the wrapper is a link for "Publisher"). Search for a leaf
  // element whose text matches `label` and return its next sibling's text.
  function metaValueByLabel(label) {
    const target = label.trim().toLowerCase();
    const candidates = document.querySelectorAll('div, a');
    for (const el of candidates) {
      const first = el.firstElementChild;
      if (first && !first.firstElementChild && first.textContent.trim().toLowerCase() === target) {
        const value = first.nextElementSibling;
        if (value) return value.textContent.trim();
      }
    }
    return null;
  }

  function parseDetailPage() {
    const titleText = document.querySelector('h1')?.textContent.trim() || document.title.replace(/\s*\|.*$/, '');
    const { series, volume, number } = parseHooplaTitle(titleText);

    return {
      series,
      number,
      volume,
      publisher: metaValueByLabel('Publisher'),
      publishDate: normalizeYear(metaValueByLabel('Year')),
      thumbnail: document.querySelector('img[src*="cover"]')?.src ?? null,
    };
  }

  // "The Department of Truth Vol. 2: The City Upon a Hill Comic Issues #8-13"
  // -> series/volume/number(range). Leaves fields blank rather than
  // guessing wrong if the title doesn't match this shape, per spec.
  function parseHooplaTitle(text) {
    const match = text.match(/^(.*?)\s+Vol\.?\s*(\d+)\s*:.*?Comic Issues\s+#([\d]+(?:-[\d]+)?)/i);
    if (match) return { series: match[1].trim(), volume: match[2], number: match[3] };

    const simpleMatch = text.match(/^(.*?)\s+Comic Issues\s+#([\d]+(?:-[\d]+)?)/i);
    if (simpleMatch) return { series: simpleMatch[1].trim(), volume: null, number: simpleMatch[2] };

    return { series: text.trim(), volume: null, number: null };
  }

  // The page only exposes a "Year" chip, not a full date — store it as
  // YYYY-01-01 so it still sorts/displays reasonably as a publish date.
  function normalizeYear(text) {
    if (!text) return null;
    const match = text.match(/\d{4}/);
    return match ? `${match[0]}-01-01` : null;
  }

  initAdapter({ getPageType, parseDetailPage });
})();
