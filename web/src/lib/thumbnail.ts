const PROXY_HOST_SUFFIX = '.nocookie.net';

export function isProxyThumbnailHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith(PROXY_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/** Try direct file URLs when a stored Fandom preview URL fails to load. */
export function thumbnailFallbacks(url: string): string[] {
  const candidates = [url];
  const noScale = url.replace(/\/scale-to-width-down\/\d+/, '');
  if (noScale !== url) candidates.push(noScale);

  const direct = url.replace(/\/revision\/.*$/, '');
  if (direct !== url && !candidates.includes(direct)) candidates.push(direct);

  return candidates;
}

export function thumbnailDisplayUrl(url: string): string {
  if (isProxyThumbnailHost(url)) {
    return `/thumb?u=${encodeURIComponent(url)}`;
  }
  return url;
}
