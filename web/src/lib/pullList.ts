import type {
  PullListIssue,
  PullListSeries,
  PullListSeriesMeta,
  PullListStatus,
  PullListTitleArt,
  SeriesKey,
  TitleArtCrop,
} from './types';

export const PULL_LIST_STATUSES: { value: PullListStatus; label: string }[] = [
  { value: 'read_all', label: 'Read All' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'skip', label: 'Skip' },
];

/** Most series logos sit across the top of the cover, so that band is the default title art. */
export const DEFAULT_TITLE_ART_CROP: TitleArtCrop = { x: 0, y: 0, w: 1, h: 0.25 };

export function seriesKeyOf(item: { series: string; volume: string | null; publisher: string | null }): SeriesKey {
  return { series: item.series, volume: item.volume ?? '', publisher: item.publisher ?? '' };
}

export function seriesKeyString(key: SeriesKey): string {
  return JSON.stringify([key.series, key.volume, key.publisher]);
}

export function formatSeriesTitle(key: SeriesKey): string {
  return key.volume ? `${key.series} (${key.volume})` : key.series;
}

const issueNumberCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareIssues(a: PullListIssue, b: PullListIssue): number {
  if (a.publish_date && b.publish_date && a.publish_date !== b.publish_date) {
    return a.publish_date < b.publish_date ? -1 : 1;
  }
  const byNumber = issueNumberCollator.compare(a.number ?? '', b.number ?? '');
  return byNumber !== 0 ? byNumber : a.book_id - b.book_id;
}

function cropFromMeta(meta: PullListSeriesMeta): TitleArtCrop | null {
  const { title_art_x: x, title_art_y: y, title_art_w: w, title_art_h: h } = meta;
  if (x == null || y == null || w == null || h == null) return null;
  return { x, y, w, h };
}

function resolveTitleArt(issues: PullListIssue[], meta: PullListSeriesMeta | undefined): PullListTitleArt | null {
  if (meta?.title_art_book_id != null) {
    const chosen = issues.find((issue) => issue.book_id === meta.title_art_book_id && issue.thumbnail);
    if (chosen) {
      return { issue: chosen, crop: cropFromMeta(meta) ?? DEFAULT_TITLE_ART_CROP, isDefault: false };
    }
  }
  const firstCover = issues.find((issue) => issue.thumbnail);
  return firstCover ? { issue: firstCover, crop: DEFAULT_TITLE_ART_CROP, isDefault: true } : null;
}

const textCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Prioritized series first (by sort order), then everything else alphabetically. */
export function comparePullListSeries(a: PullListSeries, b: PullListSeries): number {
  if (a.sortOrder != null || b.sortOrder != null) {
    if (a.sortOrder == null) return 1;
    if (b.sortOrder == null) return -1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  }
  return (
    textCollator.compare(a.publisher, b.publisher) ||
    textCollator.compare(a.series, b.series) ||
    textCollator.compare(a.volume, b.volume)
  );
}

/**
 * Roll the books found across every list up into one row per series.
 * `issues` may contain the same book several times (once per list it's on); it is counted once.
 */
export function buildPullListSeries(
  issues: readonly PullListIssue[],
  metadata: readonly PullListSeriesMeta[]
): PullListSeries[] {
  const metaByKey = new Map(metadata.map((meta) => [seriesKeyString(meta), meta]));
  const issuesByKey = new Map<string, Map<number, PullListIssue>>();

  for (const issue of issues) {
    const key = seriesKeyString(seriesKeyOf(issue));
    let byBook = issuesByKey.get(key);
    if (!byBook) {
      byBook = new Map();
      issuesByKey.set(key, byBook);
    }
    byBook.set(issue.book_id, issue);
  }

  const series: PullListSeries[] = [];
  for (const [key, byBook] of issuesByKey) {
    const seriesIssues = [...byBook.values()].sort(compareIssues);
    const meta = metaByKey.get(key);
    series.push({
      ...seriesKeyOf(seriesIssues[0]),
      key,
      family: meta?.family ?? null,
      status: meta?.status ?? null,
      sortOrder: meta?.sort_order ?? null,
      issues: seriesIssues,
      totalIssues: seriesIssues.length,
      issuesRead: seriesIssues.filter((issue) => issue.completed).length,
      titleArt: resolveTitleArt(seriesIssues, meta),
    });
  }

  return series.sort(comparePullListSeries);
}

export type PullListStatusFilter = 'all' | 'unset' | PullListStatus;

export function filterPullListSeries(series: readonly PullListSeries[], filter: PullListStatusFilter): PullListSeries[] {
  if (filter === 'all') return [...series];
  if (filter === 'unset') return series.filter((s) => s.status == null);
  return series.filter((s) => s.status === filter);
}

/** Distinct, alphabetized family names already in use, for autocomplete. */
export function familyOptions(series: readonly PullListSeries[]): string[] {
  const names = new Set<string>();
  for (const s of series) {
    if (s.family) names.add(s.family);
  }
  return [...names].sort(textCollator.compare);
}

/** Normalize a dragged crop rectangle: clamp to the cover and fix negative width/height. */
export function normalizeCrop(start: { x: number; y: number }, end: { x: number; y: number }): TitleArtCrop {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x1 = clamp(Math.min(start.x, end.x));
  const y1 = clamp(Math.min(start.y, end.y));
  const x2 = clamp(Math.max(start.x, end.x));
  const y2 = clamp(Math.max(start.y, end.y));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Ignore accidental clicks: a usable crop must cover at least 3% of each dimension. */
export function isUsableCrop(crop: TitleArtCrop): boolean {
  return crop.w >= 0.03 && crop.h >= 0.03;
}
