/**
 * Adapter for Marvel's public issue pages (marvel.com/comics/issue/...),
 * matching the spec's example page title "Daredevil (2019) #31 | Comic
 * Issues | Marvel". This is the public marketing page — no login required,
 * confirmed by viewing a live page — not the authenticated read.marvel.com
 * reader (which requires a Marvel Unlimited subscription and isn't a
 * content-scriptable page the same way).
 *
 * Verified against a real live page on 2026-07-05:
 * https://www.marvel.com/comics/issue/89601/daredevil_2019_31
 *
 * Notes:
 * - The page has no explicit "on-sale date" field. The only date shown is
 *   "FOC Date" (Final Order Cutoff — the retailer pre-order deadline, a few
 *   weeks before release), used here as a best-effort stand-in since it's
 *   the only date available. Leave PublishDate blank in the reading list if
 *   this turns out to be too inaccurate for your needs.
 * - There's no explicit "Publisher" field either, since it's Marvel's own
 *   site — hardcoded to "Marvel".
 */
(function () {
  function getPageType() {
    return /\/comics\/issue\//.test(window.location.pathname) ? 'detail' : null;
  }

  function detailListValue(label) {
    const rows = document.querySelectorAll('.ComicIssueMoreDetails__List li');
    for (const row of rows) {
      const spans = row.querySelectorAll('span');
      if (spans.length >= 2 && spans[0].textContent.replace(/:$/, '').trim() === label) {
        return spans[1].textContent.trim();
      }
    }
    return null;
  }

  function parseDetailPage() {
    const titleText = document.querySelector('h1.ModuleHeader')?.textContent.trim() || document.title.replace(/\s*\|.*$/, '');
    const { series, volume, number } = parseMarvelTitle(titleText);

    return {
      series,
      number,
      volume,
      publisher: 'Marvel',
      publishDate: normalizeDate(detailListValue('FOC Date')),
      thumbnail: document.querySelector(`img[alt="${cssEscapeAttr(titleText)}"]`)?.src ?? null,
    };
  }

  // "Daredevil (2019) #31" -> series/volume(year)/number.
  function parseMarvelTitle(text) {
    const match = text.match(/^(.*?)\s*\((\d{4})\)\s*#(\d+[A-Za-z]?)/);
    if (match) return { series: match[1].trim(), volume: match[2], number: match[3] };
    return { series: text.trim(), volume: null, number: null };
  }

  function normalizeDate(text) {
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  function cssEscapeAttr(text) {
    return text.replace(/"/g, '\\"');
  }

  initAdapter({ getPageType, parseDetailPage });
})();
