const FANDOM_HOST_SUFFIX = '.nocookie.net';

export function isFandomThumbnailHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith(FANDOM_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/** Strip Fandom lazy-load scaling segments and normalize CDN URLs. */
export function normalizeFandomThumbnailUrl(url: string): string | null {
  if (!url || url.startsWith('data:')) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!isFandomThumbnailHost(url)) return null;

  parsed.pathname = parsed.pathname
    .replace(/\/scale-to-width-down\/\d+/, '')
    .replace(/\/scale-to-height-down\/\d+/, '')
    .replace(/\/zoom-crop\/width-\d+-height-\d+/, '');

  return parsed.href;
}

/** Try alternate Fandom URL shapes when the primary CDN URL fails to load. */
export function thumbnailFallbacks(url: string): string[] {
  const normalized = normalizeFandomThumbnailUrl(url) ?? url;
  const candidates = [normalized];

  if (url !== normalized) candidates.push(url);

  const direct = normalized.replace(/\/revision\/.*$/, '');
  if (direct !== normalized && !candidates.includes(direct)) candidates.push(direct);

  return candidates;
}

/**
 * Display URL for a stored thumbnail.
 * Fandom blocks hotlinking when a Referer is sent, so load CDN URLs directly with
 * referrerPolicy="no-referrer" on the img element (see BookThumbnail).
 */
export function thumbnailDisplayUrl(url: string): string {
  return normalizeFandomThumbnailUrl(url) ?? url;
}

/** @deprecated Use isFandomThumbnailHost */
export const isProxyThumbnailHost = isFandomThumbnailHost;
