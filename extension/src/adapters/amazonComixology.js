/**
 * Adapter for Amazon Kindle Store issue pages (Comixology issues are sold
 * through the same Amazon product page template as of this writing).
 *
 * The #productTitle / #landingImage IDs below have been Amazon's standard
 * product-page IDs for years and are a safe bet, but the detail-bullets
 * selectors for Publisher/Publication date are more likely to need
 * adjustment — TODO verify against a live page before relying on this.
 * Example page from the spec: "Daredevil (2019-2021) #31" on Amazon Kindle Store.
 */
(function () {
  function getPageType() {
    const title = document.querySelector('#productTitle');
    return title ? 'detail' : null;
  }

  function detailBulletValue(label) {
    // Amazon renders product details either as a bullet list
    // (#detailBullets_feature_div) or a two-column table
    // (#productDetails_detailBullets_sections1) depending on category —
    // check both.
    const bullets = document.querySelectorAll('#detailBullets_feature_div li, #productDetails_detailBullets_sections1 tr');
    for (const row of bullets) {
      const text = row.textContent || '';
      if (text.toLowerCase().includes(label.toLowerCase())) {
        const parts = text.split(':');
        if (parts.length > 1) return parts.slice(1).join(':').trim();
      }
    }
    return null;
  }

  function parseDetailPage() {
    const titleText = document.querySelector('#productTitle')?.textContent.trim() || '';
    const { series, volume, number } = parseAmazonTitle(titleText);

    return {
      series,
      number,
      volume,
      publisher: detailBulletValue('Publisher'),
      publishDate: normalizeDate(detailBulletValue('Publication date')),
      thumbnail: document.querySelector('#landingImage, #imgBlkFront')?.src ?? null,
    };
  }

  // "Daredevil (2019-2021) #31" -> series/volume(year range)/number.
  function parseAmazonTitle(text) {
    const match = text.match(/^(.*?)\s*\(([\d]{4}(?:-[\d]{4})?-?)\)\s*#(\d+[A-Za-z]?)/);
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
