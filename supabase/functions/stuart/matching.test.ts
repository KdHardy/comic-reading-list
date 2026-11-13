import { describe, expect, it } from 'vitest';
import {
  datesAgree,
  filterCandidates,
  groupBooks,
  isOngoing,
  normalizeIssueNumber,
  normalizePublisher,
  normalizeTitle,
  publishersMatch,
  volumeYear,
  type BookGroup,
  type VolumeCandidate,
} from './matching.ts';

function candidate(overrides: Partial<VolumeCandidate> & { sourceId: string }): VolumeCandidate {
  return {
    name: 'Catwoman',
    startYear: 2018,
    publisher: 'DC Comics',
    countOfIssues: 60,
    siteUrl: null,
    ...overrides,
  };
}

function group(overrides: Partial<BookGroup> = {}): BookGroup {
  return {
    series: 'Catwoman',
    volume: null,
    publisher: 'DC Comics',
    books: [{ bookId: 1, number: '31', publishDate: '2021-05-18' }],
    ...overrides,
  };
}

describe('normalizers', () => {
  it('ignores case, punctuation and a leading article in titles', () => {
    expect(normalizeTitle('The Immortal Hulk')).toBe(normalizeTitle('Immortal Hulk'));
    expect(normalizeTitle('Star Wars: Rogue One – Saw Gerrera')).toBe('star wars rogue one saw gerrera');
    expect(normalizeTitle('Willow & Tara')).toBe('willow and tara');
    expect(normalizeTitle('X-Men')).not.toBe(normalizeTitle('X-Factor'));
  });

  it('reduces publishers to their distinctive name', () => {
    expect(normalizePublisher('Marvel Comics')).toBe('marvel');
    expect(normalizePublisher('Marvel')).toBe('marvel');
    expect(normalizePublisher('BOOM! Studios')).toBe('boom');
    expect(normalizePublisher('Boom! Studios')).toBe('boom');
    expect(normalizePublisher('IDW Publishing')).toBe('idw');
    expect(normalizePublisher('Comics')).toBe('comics');
    expect(normalizePublisher(null)).toBeNull();
  });

  it('matches publishers loosely but not across companies', () => {
    expect(publishersMatch('Marvel', 'Marvel Comics')).toBe(true);
    expect(publishersMatch('Dark Horse Comics', 'Dark Horse')).toBe(true);
    expect(publishersMatch('DC Comics', 'Marvel')).toBe(false);
    expect(publishersMatch(null, 'Marvel')).toBe(false);
  });

  it('trims leading zeros from issue numbers', () => {
    expect(normalizeIssueNumber('001')).toBe('1');
    expect(normalizeIssueNumber('#12')).toBe('12');
    expect(normalizeIssueNumber('0')).toBe('0');
    expect(normalizeIssueNumber('1.MU')).toBe('1.mu');
    expect(normalizeIssueNumber(' ')).toBeNull();
  });

  it('reads a year from a volume label', () => {
    expect(volumeYear('2021')).toBe(2021);
    expect(volumeYear('Vol. 2019')).toBe(2019);
    expect(volumeYear('2')).toBeNull();
    expect(volumeYear(null)).toBeNull();
  });
});

describe('filterCandidates', () => {
  it('keeps same-titled volumes from the right publisher, newest first', () => {
    const { candidates, rejected } = filterCandidates(group(), [
      candidate({ sourceId: '1', startYear: 2011, countOfIssues: 52 }),
      candidate({ sourceId: '2', startYear: 2018 }),
      candidate({ sourceId: '3', name: 'Catwoman: Lonely City' }),
      candidate({ sourceId: '4', publisher: 'Marvel' }),
    ]);

    expect(candidates.map((c) => c.sourceId)).toEqual(['2', '1']);
    expect(rejected.map((r) => [r.sourceId, r.reason])).toEqual([
      ['3', 'title differs'],
      ['4', 'publisher differs'],
    ]);
  });

  it('rejects volumes that started after the comic was published', () => {
    const { candidates, rejected } = filterCandidates(group(), [
      candidate({ sourceId: '1', startYear: 2018 }),
      candidate({ sourceId: '2', startYear: 2022 }),
    ]);
    expect(candidates.map((c) => c.sourceId)).toEqual(['1']);
    expect(rejected[0].reason).toMatch(/after the issue was published/);
  });

  it('rejects runs clearly too short for the issue numbers', () => {
    const { candidates } = filterCandidates(
      group({ books: [{ bookId: 1, number: '80', publishDate: '2021-05-18' }] }),
      [candidate({ sourceId: '1', countOfIssues: 12 }), candidate({ sourceId: '2', countOfIssues: 79 })]
    );
    expect(candidates.map((c) => c.sourceId)).toEqual(['2']);
  });

  it('uses a year-style volume label to pick the run', () => {
    const { candidates } = filterCandidates(
      group({ series: 'X-Factor', volume: '2020', publisher: 'Marvel', books: [{ bookId: 1, number: '9', publishDate: '2021-04-19' }] }),
      [
        candidate({ sourceId: '1', name: 'X-Factor', publisher: 'Marvel', startYear: 1986, countOfIssues: 259 }),
        candidate({ sourceId: '2', name: 'X-Factor', publisher: 'Marvel', startYear: 2020, countOfIssues: 10 }),
      ]
    );
    expect(candidates.map((c) => c.sourceId)).toEqual(['2']);
  });

  it('accepts any publisher when the comic has none', () => {
    const { candidates } = filterCandidates(group({ publisher: null }), [candidate({ sourceId: '1', publisher: 'Marvel' })]);
    expect(candidates).toHaveLength(1);
  });

  it('drops duplicate results', () => {
    const { candidates } = filterCandidates(group(), [candidate({ sourceId: '1' }), candidate({ sourceId: '1' })]);
    expect(candidates).toHaveLength(1);
  });
});

describe('dates', () => {
  it('accepts a store or cover date within 75 days', () => {
    expect(datesAgree('2021-05-18', '2021-05-18', '2021-07-01')).toBe(true);
    expect(datesAgree('2021-05-18', null, '2021-07-01')).toBe(true);
    expect(datesAgree('2021-05-18', '2011-05-18', '2011-07-01')).toBe(false);
    expect(datesAgree(null, '2021-05-18', null)).toBe(false);
  });

  it('calls a run ongoing when its latest issue is recent or upcoming', () => {
    expect(isOngoing('2026-10-01', '2026-11-13')).toBe(true);
    expect(isOngoing('2026-12-01', '2026-11-13')).toBe(true);
    expect(isOngoing('2025-01-01', '2026-11-13')).toBe(false);
    expect(isOngoing(null, '2026-11-13')).toBeNull();
  });
});

describe('groupBooks', () => {
  it('groups by the exact series, volume and publisher text', () => {
    const groups = groupBooks([
      { book_id: 1, series: 'X-Factor', volume: '2020', publisher: 'Marvel', number: '9', publish_date: null },
      { book_id: 2, series: 'X-Factor', volume: null, publisher: 'Marvel Comics', number: '10', publish_date: null },
      { book_id: 3, series: 'X-Factor', volume: null, publisher: 'Marvel Comics', number: '9', publish_date: null },
    ]);
    expect(groups.map((g) => g.books.map((b) => b.bookId))).toEqual([[1], [2, 3]]);
  });
});
