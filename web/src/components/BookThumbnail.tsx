import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchBookThumbnail, saveBookThumbnail } from '../lib/api';
import { thumbnailDisplayUrl, thumbnailFallbacks } from '../lib/thumbnail';
import {
  THUMBNAIL_MAX_RETRIES,
  blobToDataUrl,
  byteaToDataUrl,
  thumbnailRetryDelay,
} from '../lib/thumbnailCache';

interface Props {
  bookId: number;
  sourceUrl: string;
  cachedAt: string | null;
  onCached?: (bookId: number) => void;
}

export function BookThumbnail({ bookId, sourceUrl, cachedAt, onCached }: Props) {
  const thumbRef = useRef<HTMLElement>(null);
  const savingRef = useRef(false);
  const retryTimerRef = useRef<number>();

  const fallbacks = useMemo(() => thumbnailFallbacks(sourceUrl), [sourceUrl]);

  const [visible, setVisible] = useState(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [loadingCached, setLoadingCached] = useState(Boolean(cachedAt));
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [exhausted, setExhausted] = useState(false);

  const remoteSrc =
    visible && displaySrc === null ? `${thumbnailDisplayUrl(fallbacks[fallbackIndex])}#${reloadKey}` : null;

  useEffect(() => {
    setDisplaySrc(null);
    setLoadingCached(Boolean(cachedAt));
    setFallbackIndex(0);
    setRetryCount(0);
    setReloadKey(0);
    setExhausted(false);
  }, [bookId, sourceUrl, cachedAt]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!cachedAt) {
      setLoadingCached(false);
      return;
    }
    if (displaySrc !== null) {
      setLoadingCached(false);
      return;
    }

    let cancelled = false;
    setLoadingCached(true);
    fetchBookThumbnail(bookId)
      .then((cached) => {
        if (cancelled) return;
        if (cached) {
          setDisplaySrc(byteaToDataUrl(cached.mime, cached.data));
        }
      })
      .catch(() => {
        // Fall back to lazy remote load below.
      })
      .finally(() => {
        if (!cancelled) setLoadingCached(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, cachedAt, displaySrc]);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: '300px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  });

  function scheduleRetry() {
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);

    if (fallbackIndex < fallbacks.length - 1) {
      setFallbackIndex((index) => index + 1);
      setReloadKey((key) => key + 1);
      return;
    }

    if (retryCount < THUMBNAIL_MAX_RETRIES) {
      const delay = thumbnailRetryDelay(retryCount);
      retryTimerRef.current = window.setTimeout(() => {
        setFallbackIndex(0);
        setRetryCount((count) => count + 1);
        setReloadKey((key) => key + 1);
      }, delay);
      return;
    }

    setExhausted(true);
  }

  async function persistLoadedImage(imageSrc: string) {
    if (savingRef.current || cachedAt) return;

    savingRef.current = true;
    try {
      const response = await fetch(imageSrc);
      if (!response.ok) return;

      const blob = await response.blob();
      await saveBookThumbnail(bookId, blob);
      setDisplaySrc(await blobToDataUrl(blob));
      onCached?.(bookId);
    } catch {
      // Keep showing the remote image even if persistence fails.
    } finally {
      savingRef.current = false;
    }
  }

  async function handleLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    if (img.naturalWidth === 0) {
      scheduleRetry();
      return;
    }

    if (!cachedAt && displaySrc === null) {
      await persistLoadedImage(img.currentSrc.split('#')[0]);
    }
  }

  function handleError() {
    scheduleRetry();
  }

  if (exhausted && displaySrc === null) {
    return <div ref={thumbRef as React.RefObject<HTMLDivElement>} className="book-thumbnail book-thumbnail-placeholder" />;
  }

  if (loadingCached || (displaySrc === null && !visible)) {
    return <div ref={thumbRef as React.RefObject<HTMLDivElement>} className="book-thumbnail book-thumbnail-placeholder" aria-hidden="true" />;
  }

  return (
    // eslint-disable-next-line jsx-a11y/img-redundant-alt
    <img
      ref={thumbRef as React.RefObject<HTMLImageElement>}
      key={displaySrc ?? remoteSrc}
      className="book-thumbnail"
      src={displaySrc ?? remoteSrc ?? undefined}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}
