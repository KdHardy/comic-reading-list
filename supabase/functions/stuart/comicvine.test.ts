import { describe, expect, it } from 'vitest';
import { StopRun } from './adapter.ts';
import { ComicVineAdapter } from './comicvine.ts';
import type { BookGroup } from './matching.ts';

type Route = (url: URL) => unknown;

function fakeComicVine(routes: Record<string, Route>) {
  const calls: URL[] = [];
  const fetchFn = (async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const path = url.pathname.replace('/api/', '');
    const route = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    const results = route ? route[1](url) : [];
    const body =
      results && typeof results === 'object' && 'status_code' in (results as object)
        ? results
        : {
            status_code: 1,
            error: 'OK',
            number_of_total_results: Array.isArray(results) ? results.length : 1,
            results,
          };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function adapter(fetchFn: typeof fetch, overrides: Partial<ConstructorParameters<typeof ComicVineAdapter>[0]> = {}) {
  return new ComicVineAdapter({
    apiKey: 'test-key',
    fetch: fetchFn,
    sleep: async () => {},
    minIntervalMs: 0,
    today: '2026-11-13',
    ...overrides,
  });
}

const catwomanVolumes = [
  { id: 100, name: 'Catwoman', start_year: '2011', publisher: { name: 'DC Comics' }, count_of_issues: 52, last_issue: { issue_number: '52' }, site_detail_url: 'cv/100' },
  { id: 200, name: 'Catwoman', start_year: '2018', publisher: { name: 'DC Comics' }, count_of_issues: 70, last_issue: { issue_number: '70' }, site_detail_url: 'cv/200' },
];

const group: BookGroup = {
  series: 'Catwoman',
  volume: null,
  publisher: 'DC Comics',
  books: [
    { bookId: 1, number: '31', publishDate: '2021-05-18' },
    { bookId: 2, number: '32', publishDate: '2021-06-15' },
  ],
};

function catwomanRoutes(): Record<string, Route> {
  return {
    'volumes/': () => catwomanVolumes,
    'issues/': (url) => {
      const filter = url.searchParams.get('filter')!;
      if (filter === 'volume:200,issue_number:31') return [{ id: 31, issue_number: '31', store_date: '2021-05-18', cover_date: '2021-07-01' }];
      if (filter === 'volume:200') {
        return [
          { id: 31, issue_number: '31', store_date: '2021-05-18', cover_date: '2021-07-01' },
          { id: 32, issue_number: '32', store_date: '2021-06-15', cover_date: '2021-08-01' },
          { id: 70, issue_number: '70', store_date: '2026-10-20', cover_date: '2026-12-01' },
        ];
      }
      return [];
    },
    'issue/4000-31/': () => ({ id: 31, story_arc_credits: [{ id: 9, name: 'Fear State', site_detail_url: 'cv/arc/9' }] }),
    'issue/4000-32/': () => ({ id: 32, story_arc_credits: [] }),
    'story_arc/4045-9/': () => ({ id: 9, publisher: { name: 'DC Comics' }, count_of_issue_appearances: 60 }),
  };
}

describe('ComicVineAdapter', () => {
  it('matches a group by verifying the issue date, then maps issues and story arcs', async () => {
    const { fetchFn, calls } = fakeComicVine(catwomanRoutes());
    const result = await adapter(fetchFn).resolve(group, { knownSourceId: null, knownStorylineIds: new Set() });

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.volume).toMatchObject({
      source: 'comicvine',
      sourceId: '200',
      name: 'Catwoman',
      startYear: 2018,
      publisher: 'DC Comics',
      countOfIssues: 70,
      lastIssueNumber: '70',
      lastIssueDate: '2026-10-20',
      isOngoing: true,
    });
    expect(result.issues).toEqual([
      {
        bookId: 1,
        sourceIssueId: '31',
        publishDate: '2021-05-18',
        storylines: [{ sourceId: '9', name: 'Fear State', siteUrl: 'cv/arc/9', publisher: 'DC Comics', issueCount: 60 }],
      },
      { bookId: 2, sourceIssueId: '32', publishDate: '2021-06-15', storylines: [] },
    ]);
    expect(result.deferredBookIds).toEqual([]);

    // The newest run (2018) is checked first and agrees, so 2011 is never fetched.
    expect(calls.some((c) => c.searchParams.get('filter') === 'volume:100,issue_number:31')).toBe(false);
    expect(calls.every((c) => c.searchParams.get('api_key') === 'test-key' && c.searchParams.get('format') === 'json')).toBe(true);
  });

  it('reuses a known volume without searching again', async () => {
    const routes = catwomanRoutes();
    routes['volume/4050-200/'] = () => catwomanVolumes[1];
    const { fetchFn, calls } = fakeComicVine(routes);
    const result = await adapter(fetchFn).resolve(group, { knownSourceId: '200', knownStorylineIds: new Set(['9']) });

    expect(result.kind).toBe('matched');
    expect(calls.some((c) => c.pathname.endsWith('/volumes/'))).toBe(false);
    expect(calls.some((c) => c.pathname.includes('story_arc'))).toBe(false);
  });

  it('fails with the candidates when no volume has the issue near its date', async () => {
    const routes = catwomanRoutes();
    routes['issues/'] = () => [{ id: 1, issue_number: '31', store_date: '1990-01-01', cover_date: null }];
    const { fetchFn } = fakeComicVine(routes);
    const result = await adapter(fetchFn).resolve(group, { knownSourceId: null, knownStorylineIds: new Set() });

    expect(result).toMatchObject({ kind: 'failed', code: 'no_date_match' });
    if (result.kind === 'failed') {
      expect((result.details as { candidates: { id: string }[] }).candidates.map((c) => c.id)).toEqual(['200', '100']);
    }
  });

  it('falls back to search and reports when nothing has the same title', async () => {
    const { fetchFn, calls } = fakeComicVine({
      'volumes/': () => [],
      'search/': () => [{ id: 5, name: 'Buffy the Vampire Slayer Season Nine', start_year: '2011', publisher: { name: 'Dark Horse' }, count_of_issues: 25, last_issue: null, site_detail_url: null }],
    });
    const result = await adapter(fetchFn).resolve(
      { series: 'Buffy Season 9', volume: null, publisher: 'Dark Horse Comics', books: [{ bookId: 1, number: '1', publishDate: '2011-09-14' }] },
      { knownSourceId: null, knownStorylineIds: new Set() }
    );

    expect(calls.map((c) => c.pathname)).toEqual(['/api/volumes/', '/api/search/']);
    expect(result).toMatchObject({ kind: 'failed', code: 'no_candidates' });
  });

  it('stops the batch on a rejected API key', async () => {
    const { fetchFn } = fakeComicVine({
      'volumes/': () => ({ status_code: 100, error: 'Invalid API Key', number_of_total_results: 0, results: [] }),
    });
    const error = await adapter(fetchFn)
      .resolve(group, { knownSourceId: null, knownStorylineIds: new Set() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StopRun);
    expect(error).toMatchObject({ code: 'invalid_api_key', fatal: true });
  });

  it('defers books once the request budget runs out', async () => {
    const { fetchFn } = fakeComicVine(catwomanRoutes());
    // volumes + verify + issue list + issue 31 detail = 4 (arc detail skipped: low budget).
    const result = await adapter(fetchFn, { maxRequests: 4 }).resolve(group, {
      knownSourceId: null,
      knownStorylineIds: new Set(),
    });

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.issues.map((i) => i.bookId)).toEqual([1]);
    expect(result.issues[0].storylines).toEqual([{ sourceId: '9', name: 'Fear State', siteUrl: 'cv/arc/9' }]);
    expect(result.deferredBookIds).toEqual([2]);
  });

  it('spaces requests out', async () => {
    const { fetchFn } = fakeComicVine(catwomanRoutes());
    let clock = 0;
    const waits: number[] = [];
    const cv = adapter(fetchFn, {
      minIntervalMs: 1100,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await cv.resolve(group, { knownSourceId: null, knownStorylineIds: new Set() });
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((ms) => ms === 1100)).toBe(true);
  });
});
