const ALLOWED_HOST_SUFFIX = '.nocookie.net';

export async function onRequestGet(context) {
  const target = new URL(context.request.url).searchParams.get('u');
  if (!target) {
    return new Response('missing image url', { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('invalid image url', { status: 400 });
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith(ALLOWED_HOST_SUFFIX)) {
    return new Response('host not allowed', { status: 403 });
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { 'User-Agent': 'ComicReadingList/1.0' },
    cf: { cacheTtl: 86_400, cacheEverything: true },
  });

  if (!upstream.ok) {
    return new Response('upstream error', { status: upstream.status });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('cache-control', 'public, max-age=86400');

  return new Response(upstream.body, { headers });
}
