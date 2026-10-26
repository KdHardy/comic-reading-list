import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TITLE_ART_CROP,
  buildPullListSeries,
  familyOptions,
  filterPullListSeries,
  formatSeriesTitle,
  isUsableCrop,
  normalizeCrop,
} from './pullList';
import type { PullListIssue, PullListSeriesMeta } from './types';

function issue(overrides: Partial<PullListIssue> & { book_id: number }): PullListIssue {
  return {
    publisher: 'Marvel',
    series: 'X-Men',
    volume: '2021',
    number: '1',
    publish_date: null,
    thumbnail: null,
    thumbnail_cached_at: null,
    completed: false,
    ...overrides,
  };
}

function meta(overrides: Partial<PullListSeriesMeta>): PullListSeriesMeta {
  return {
    series: 'X-Men',
    volume: '2021',
    publisher: 'Marvel',
    family: null,
    status: null,
    sort_order: null,
    title_art_book_id: null,
    title_art_x: null,
    title_art_y: null,
    title_art_w: null,
    title_art_h: null,
    ...overrides,
  };
}

describe('buildPullListSeries', () => {
  it('groups issues by series, volume, and publisher', () => {
    const series = buildPullListSeries(
      [
        issue({ book_id: 1 }),
        issue({ book_id: 2, number: '2' }),
        issue({ book_id: 3, volume: '1991' }),
        issue({ book_id: 4, publisher: 'Other' }),
      ],
      []
    );

    expect(series.map((s) => [s.publisher, s.series, s.volume, s.totalIssues])).toEqual([
      ['Marvel', 'X-Men', '1991', 1],
      ['Marvel', 'X-Men', '2021', 2],
      ['Other', 'X-Men', '2021', 1],
    ]);
  });

  it('counts a book on several lists once', () => {
    const [series] = buildPullListSeries(
      [
        issue({ book_id: 1, completed: true }),
        issue({ book_id: 1, completed: true }),
        issue({ book_id: 2, number: '2' }),
      ],
      []
    );

    expect(series.totalIssues).toBe(2);
    expect(series.issuesRead).toBe(1);
  });

  it('treats missing volume and publisher as one series', () => {
    const series = buildPullListSeries(
      [issue({ book_id: 1, volume: null, publisher: null }), issue({ book_id: 2, volume: null, publisher: null })],
      [meta({ volume: '', publisher: '', status: 'maybe' })]
    );

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ volume: '', publisher: '', status: 'maybe', totalIssues: 2 });
  });

  it('orders issues by publish date, then numerically by issue number', () => {
    const [series] = buildPullListSeries(
      [
        issue({ book_id: 1, number: '10' }),
        issue({ book_id: 2, number: '2' }),
        issue({ book_id: 3, number: '1', publish_date: '2021-06-02' }),
        issue({ book_id: 4, number: '0', publish_date: '2021-07-07' }),
      ],
      []
    );

    expect(series.issues.map((i) => i.book_id)).toEqual([3, 4, 2, 1]);
  });

  it('applies saved metadata and puts prioritized series first', () => {
    const series = buildPullListSeries(
      [
        issue({ book_id: 1, series: 'Avengers' }),
        issue({ book_id: 2, series: 'X-Factor' }),
        issue({ book_id: 3, series: 'X-Men' }),
      ],
      [
        meta({ series: 'X-Men', family: 'X-Men', status: 'read_all', sort_order: 20 }),
        meta({ series: 'X-Factor', family: 'X-Men', sort_order: 10 }),
      ]
    );

    expect(series.map((s) => s.series)).toEqual(['X-Factor', 'X-Men', 'Avengers']);
    expect(series[1]).toMatchObject({ family: 'X-Men', status: 'read_all', sortOrder: 20 });
    expect(series[2]).toMatchObject({ family: null, status: null, sortOrder: null });
  });

  it('uses the chosen cover and crop for the title art', () => {
    const [series] = buildPullListSeries(
      [issue({ book_id: 1, thumbnail: 'a.jpg' }), issue({ book_id: 2, number: '2', thumbnail: 'b.jpg' })],
      [meta({ title_art_book_id: 2, title_art_x: 0.1, title_art_y: 0.05, title_art_w: 0.8, title_art_h: 0.2 })]
    );

    expect(series.titleArt?.issue.book_id).toBe(2);
    expect(series.titleArt?.crop).toEqual({ x: 0.1, y: 0.05, w: 0.8, h: 0.2 });
    expect(series.titleArt?.isDefault).toBe(false);
  });

  it('falls back to the top band of the first cover', () => {
    const [series] = buildPullListSeries(
      [issue({ book_id: 1 }), issue({ book_id: 2, number: '2', thumbnail: 'b.jpg' })],
      [meta({ title_art_book_id: 99 })]
    );

    expect(series.titleArt).toMatchObject({ crop: DEFAULT_TITLE_ART_CROP, isDefault: true });
    expect(series.titleArt?.issue.book_id).toBe(2);
  });

  it('has no title art when no issue has a cover', () => {
    const [series] = buildPullListSeries([issue({ book_id: 1 })], []);
    expect(series.titleArt).toBeNull();
  });
});

describe('filterPullListSeries', () => {
  const series = buildPullListSeries(
    [issue({ book_id: 1, series: 'A' }), issue({ book_id: 2, series: 'B' }), issue({ book_id: 3, series: 'C' })],
    [meta({ series: 'A', status: 'read_all' }), meta({ series: 'B', status: 'skip' })]
  );

  it('filters by status, including series with no status yet', () => {
    expect(filterPullListSeries(series, 'all').map((s) => s.series)).toEqual(['A', 'B', 'C']);
    expect(filterPullListSeries(series, 'skip').map((s) => s.series)).toEqual(['B']);
    expect(filterPullListSeries(series, 'unset').map((s) => s.series)).toEqual(['C']);
  });
});

describe('familyOptions', () => {
  it('lists distinct family names alphabetically', () => {
    const series = buildPullListSeries(
      [issue({ book_id: 1, series: 'A' }), issue({ book_id: 2, series: 'B' }), issue({ book_id: 3, series: 'C' })],
      [meta({ series: 'A', family: 'X-Men' }), meta({ series: 'B', family: 'Avengers' }), meta({ series: 'C', family: 'X-Men' })]
    );
    expect(familyOptions(series)).toEqual(['Avengers', 'X-Men']);
  });
});

describe('formatSeriesTitle', () => {
  it('appends the volume when present', () => {
    expect(formatSeriesTitle({ series: 'X-Men', volume: '2021', publisher: 'Marvel' })).toBe('X-Men (2021)');
    expect(formatSeriesTitle({ series: 'Saga', volume: '', publisher: 'Image' })).toBe('Saga');
  });
});

describe('crop helpers', () => {
  it('normalizes a rectangle dragged in any direction and clamps it to the cover', () => {
    expect(normalizeCrop({ x: 0.9, y: 0.3 }, { x: 0.1, y: -0.2 })).toEqual({ x: 0.1, y: 0, w: 0.8, h: 0.3 });
    expect(normalizeCrop({ x: 0.5, y: 0.5 }, { x: 1.4, y: 0.6 }).w).toBeCloseTo(0.5);
  });

  it('rejects crops too small to be intentional', () => {
    expect(isUsableCrop({ x: 0, y: 0, w: 0.5, h: 0.01 })).toBe(false);
    expect(isUsableCrop({ x: 0, y: 0, w: 1, h: 0.2 })).toBe(true);
  });
});
