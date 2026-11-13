import { describe, expect, it } from 'vitest';
import {
  compareDates,
  filterCandidates,
  findAlias,
  groupBooks,
  issueSearchWindow,
  pickLookupBook,
  skippedFormat,
  isOngoing,
  normalizeIssueNumber,
  normalizePublisher,
  normalizeTitle,
  publishersMatch,
  titleLooselyMatches,
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
    expect(normalizeTitle('Star Wars: Rogue One – Saw Gerrera')).toBe('star wars rogue 1 saw gerrera');
    expect(normalizeTitle('Willow & Tara')).toBe('willow and tara');
    expect(normalizeTitle('X-Men')).not.toBe(normalizeTitle('X-Factor'));
    expect(normalizeTitle('Angel Season Eleven')).toBe(normalizeTitle('Angel Season 11'));
  });

  it('loosely matches shorthand titles in word order', () => {
    expect(titleLooselyMatches('Buffy Season 9', 'Buffy the Vampire Slayer Season Nine')).toBe(true);
    expect(titleLooselyMatches('Buffy Season 9', 'Buffy the Vampire Slayer Season 11')).toBe(false);
    expect(titleLooselyMatches('Season 9', 'Buffy the Vampire Slayer Season Nine')).toBe(false);
    expect(titleLooselyMatches('Die', 'Die!Die!Die!')).toBe(true);
    expect(titleLooselyMatches('A Hole in the World', 'Angel: A Hole in the World')).toBe(true);
    expect(titleLooselyMatches('A Hole in the World', 'Angel: A Hole in the World Part Two')).toBe(false);
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
      ['4', 'publisher differs'],
      ['3', 'title differs'],
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

  it('keeps runs whose issue count is lower than the issue numbers (legacy numbering)', () => {
    const { candidates } = filterCandidates(
      group({ series: 'Action Comics', books: [{ bookId: 1, number: '1031', publishDate: '2021-05-25' }] }),
      [
        candidate({ sourceId: '18005', name: 'Action Comics', startYear: 1938, countOfIssues: 864 }),
        candidate({ sourceId: '91078', name: 'Action Comics', startYear: 2016, countOfIssues: 148 }),
      ]
    );
    expect(candidates.map((c) => c.sourceId)).toEqual(['91078', '18005']);
  });

  it('lists informative rejections before title mismatches', () => {
    const { rejected } = filterCandidates(group(), [
      candidate({ sourceId: '1', name: 'Catwoman: Lonely City' }),
      candidate({ sourceId: '2', publisher: 'Marvel' }),
    ]);
    expect(rejected.map((r) => r.reason)).toEqual(['publisher differs', 'title differs']);
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

  it('falls back to loose title matches only when no exact title fits', () => {
    const buffy = group({
      series: 'Buffy Season 9',
      publisher: 'Dark Horse Comics',
      books: [{ bookId: 1, number: '25', publishDate: '2013-09-11' }],
    });
    const loose = filterCandidates(buffy, [
      candidate({ sourceId: '1', name: 'Buffy the Vampire Slayer Season Nine: Guarded', startYear: 2011, publisher: 'Dark Horse', countOfIssues: 1 }),
      candidate({ sourceId: '2', name: 'Buffy the Vampire Slayer Season Nine', startYear: 2011, publisher: 'Dark Horse Comics', countOfIssues: 25 }),
      candidate({ sourceId: '3', name: 'Charmed Season Nine', startYear: 2011, publisher: 'Zenescope' }),
    ]);
    expect(loose.loose).toBe(true);
    // The main run first; the issue-date check rules out the one-shot.
    expect(loose.candidates.map((c) => c.sourceId)).toEqual(['2', '1']);

    const exact = filterCandidates(group({ series: 'Die', publisher: 'Image' }), [
      candidate({ sourceId: '1', name: 'Die', startYear: 2018, publisher: 'Image' }),
      candidate({ sourceId: '2', name: 'Die!Die!Die!', startYear: 2018, publisher: 'Image' }),
    ]);
    expect(exact.loose).toBe(false);
    expect(exact.candidates.map((c) => c.sourceId)).toEqual(['1']);
  });

  it('drops duplicate results', () => {
    const { candidates } = filterCandidates(group(), [candidate({ sourceId: '1' }), candidate({ sourceId: '1' })]);
    expect(candidates).toHaveLength(1);
  });
});

describe('dates', () => {
  it('needs the same year and about a quarter for a solid date match', () => {
    expect(compareDates('2021-05-18', '2021-05-18', '2021-07-01')).toMatchObject({ solid: true, days: 0, basis: 'store' });
    expect(compareDates('2021-05-18', '2021-08-10', null)).toMatchObject({ solid: true, days: 84 });
    expect(compareDates('2021-05-18', '2021-09-01', null)).toMatchObject({ solid: false, days: 106 });
    // Within a quarter but across a year boundary is not solid.
    expect(compareDates('2021-12-29', '2022-01-05', null)).toMatchObject({ solid: false, days: 7 });
    expect(compareDates('2021-05-18', '2011-05-18', null).solid).toBe(false);
    expect(compareDates(null, '2021-05-18', null).solid).toBe(false);
  });

  it('tries a cover date as-is and moved back two months when there is no store date', () => {
    // Two months ahead of release (Marvel/DC style): the shifted date lines up.
    expect(compareDates('2021-05-18', null, '2021-07-01')).toMatchObject({
      solid: true,
      basis: 'cover-2mo',
      releaseDate: '2021-05-02',
    });
    // Release-month cover date (IDW style): the shift would cross into the previous year.
    expect(compareDates('2010-01-06', null, '2010-01-01')).toMatchObject({ solid: true, basis: 'cover', days: 5 });
    expect(compareDates('2021-05-18', null, '2022-07-01').solid).toBe(false);
    expect(compareDates('2021-05-18', null, null)).toMatchObject({ solid: false, basis: null, releaseDate: null });
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

describe('aliases', () => {
  const buffyClassic = { alias: 'Buffy Classic', title: 'Buffy the Vampire Slayer', startYear: 1998, publisher: 'Dark Horse Comics' };

  it('finds an alias by name, ignoring case and punctuation', () => {
    expect(findAlias('buffy classic', [buffyClassic])).toBe(buffyClassic);
    expect(findAlias('Buffy Classic one-shot', [buffyClassic])).toBeNull();
  });

  it('filters candidates by the alias title, year and publisher', () => {
    const { candidates } = filterCandidates(
      group({
        series: 'Buffy Classic',
        publisher: 'Dark Horse Comics',
        books: [{ bookId: 1, number: '1', publishDate: '1998-09-23' }],
        alias: buffyClassic,
      }),
      [
        candidate({ sourceId: '1', name: 'Buffy the Vampire Slayer Classic', startYear: 2011, publisher: 'Dark Horse Comics' }),
        candidate({ sourceId: '2', name: 'Buffy the Vampire Slayer', startYear: 1998, publisher: 'Dark Horse Comics' }),
        candidate({ sourceId: '3', name: 'Buffy the Vampire Slayer', startYear: 2007, publisher: 'Dark Horse Comics' }),
      ]
    );
    expect(candidates.map((c) => c.sourceId)).toEqual(['2']);
  });
});

describe('skippedFormat', () => {
  it('recognizes backup stories and extras by their label', () => {
    expect(skippedFormat('Buffy Season 9 short')).toBe('short');
    expect(skippedFormat('Angel extra')).toBe('extra');
    expect(skippedFormat('Angel one-shot')).toBeNull();
    expect(skippedFormat('Short Stack')).toBeNull();
  });
});

describe('issueSearchWindow', () => {
  it('spans about a quarter either side, inside the same year', () => {
    expect(issueSearchWindow('2021-06-01')).toEqual({ start: '2021-03-01', end: '2021-09-01' });
    expect(issueSearchWindow('2021-01-20')).toEqual({ start: '2021-01-01', end: '2021-04-22' });
    expect(issueSearchWindow('2021-12-20')).toEqual({ start: '2021-09-19', end: '2021-12-31' });
    expect(issueSearchWindow('2021-06-01', 31)).toEqual({ start: '2021-05-01', end: '2021-07-02' });
  });

  it('looks issues up by the highest-numbered dated comic', () => {
    const g = group({
      books: [
        { bookId: 1, number: '7', publishDate: '2021-05-26' },
        { bookId: 2, number: '11', publishDate: '2021-09-15' },
        { bookId: 3, number: '12', publishDate: null },
      ],
    });
    expect(pickLookupBook(g)?.bookId).toBe(2);
  });
});
