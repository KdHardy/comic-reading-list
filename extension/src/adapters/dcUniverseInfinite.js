/**
 * Adapter for DC Universe Infinite's public issue preview pages
 * (dcuniverseinfinite.com/comics/book/...), matching the spec's example page
 * title "Action Comics (2016-) #1032 | DC Comics Issue". These preview pages
 * are public — no login required, confirmed by viewing a live page.
 *
 * Verified against a real live page on 2026-07-05:
 * https://www.dcuniverseinfinite.com/comics/book/action-comics-2016-1032/5b8c2780-ab1a-4804-bd18-578d00d3820b/c
 *
 * Note: there's no explicit "Publisher" field on the page since it's a
 * DC-only platform — hardcoded to "DC Comics".
 */
(function () {
  function getPageType() {
    return /\/comics\/book\//.test(window.location.pathname) ? 'detail' : null;
  }

  // Fields render as <span><span class="h5">Label:</span> Value</span> —
  // find the label span, then read the rest of its parent's text.
  function labeledValue(label) {
    const labelEl = Array.from(document.querySelectorAll('span.h5')).find(
      (el) => el.textContent.trim().replace(/:$/, '') === label
    );
    if (!labelEl || !labelEl.parentElement) return null;
    return labelEl.parentElement.textContent.replace(`${label}:`, '').trim();
  }

  function parseDetailPage() {
    const titleText = document.querySelector('h1.comic__masthead__title')?.textContent.trim() || document.title.replace(/\s*\|.*$/, '');
    const { series, volume, number } = parseDcTitle(titleText);
    const cover = Array.from(document.querySelectorAll('img')).find((img) => img.alt && img.alt.startsWith(titleText));

    return {
      series,
      number,
      volume,
      publisher: 'DC Comics',
      publishDate: normalizeDate(labeledValue('Released')),
      thumbnail: cover?.src ?? null,
    };
  }

  // "Action Comics (2016-) #1032" -> series/volume(year, dash stripped)/number.
  function parseDcTitle(text) {
    const match = text.match(/^(.*?)\s*\((\d{4})-?\)\s*#(\d+[A-Za-z]?)/);
    if (match) return { series: match[1].trim(), volume: match[2], number: match[3] };
    return { series: text.trim(), volume: null, number: null };
  }

  function normalizeDate(text) {
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  initAdapter({ getPageType, parseDetailPage });
})();
