import { useEffect, useState } from 'react';
import { fetchBookThumbnail } from '../lib/api';
import { thumbnailDisplayUrl } from '../lib/thumbnail';
import { byteaToDataUrl } from '../lib/thumbnailCache';
import type { PullListIssue, TitleArtCrop } from '../lib/types';

/** Typical comic cover proportions (width / height), used until the real image has loaded. */
const COVER_ASPECT = 2 / 3;

/**
 * Image source for an issue's cover: the copy cached in the database when there is one
 * (no hotlinking), otherwise the original remote URL.
 */
export function useCoverSrc(issue: PullListIssue | null): string | null {
  const bookId = issue?.book_id ?? null;
  const cachedAt = issue?.thumbnail_cached_at ?? null;
  const remoteSrc = issue?.thumbnail ? thumbnailDisplayUrl(issue.thumbnail) : null;
  const [cached, setCached] = useState<{ bookId: number; src: string | null } | null>(null);

  useEffect(() => {
    if (bookId == null || !cachedAt) return;
    let cancelled = false;
    fetchBookThumbnail(bookId)
      .then((thumb) => {
        if (!cancelled) setCached({ bookId, src: thumb ? byteaToDataUrl(thumb.mime, thumb.data) : null });
      })
      .catch(() => {
        if (!cancelled) setCached({ bookId, src: null });
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, cachedAt]);

  if (bookId == null) return null;
  if (!cachedAt) return remoteSrc;
  if (cached?.bookId !== bookId) return null; // still loading the cached copy
  return cached.src ?? remoteSrc;
}

interface Props {
  issue: PullListIssue | null;
  crop: TitleArtCrop;
  maxWidth?: number;
  maxHeight?: number;
}

/** Shows just the cropped title region of a cover, scaled to fit within maxWidth × maxHeight. */
export function SeriesTitleArt({ issue, crop, maxWidth = 160, maxHeight = 48 }: Props) {
  const src = useCoverSrc(issue);
  const [coverAspect, setCoverAspect] = useState(COVER_ASPECT);

  useEffect(() => setCoverAspect(COVER_ASPECT), [src]);

  const ratio = (crop.w * coverAspect) / crop.h;
  const height = Math.min(maxHeight, maxWidth / ratio);
  const width = height * ratio;

  if (!src) {
    return <div className="series-title-art series-title-art-empty" style={{ width: maxWidth, height: maxHeight }} />;
  }

  return (
    <div className="series-title-art" style={{ width, height }}>
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) setCoverAspect(img.naturalWidth / img.naturalHeight);
        }}
        style={{
          width: `${100 / crop.w}%`,
          height: `${100 / crop.h}%`,
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
        }}
      />
    </div>
  );
}
