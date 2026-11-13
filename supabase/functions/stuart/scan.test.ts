import { describe, expect, it } from 'vitest';
import { StopRun, type GroupResult, type SeriesAdapter, type StorylineInfo, type VolumeInfo } from './adapter.ts';
import type { BookGroup } from './matching.ts';
import { runScan, type PendingBookRow, type ScanError, type StuartStore } from './scan.ts';

class MemoryStore implements StuartStore {
  runs: { trigger: string; result?: unknown }[] = [];
  volumes: VolumeInfo[] = [];
  matches: { bookId: number; seriesVolumeId: number; sourceIssueId: string | null; storylines: StorylineInfo[] }[] = [];
  failures: { bookId: number; errors: ScanError[] }[] = [];
  known = new Map<string, { source: string; sourceId: string }>();

  constructor(private rows: PendingBookRow[]) {}

  async pendingBooks() {
    return this.rows;
  }
  async knownVolume(group: BookGroup) {
    return this.known.get(group.series) ?? null;
  }
  async knownStorylineIds() {
    return new Set<string>();
  }
  async upsertVolume(volume: VolumeInfo) {
    this.volumes.push(volume);
    return this.volumes.length;
  }
  async applyMatch(bookId: number, seriesVolumeId: number, sourceIssueId: string | null, _date: string | null, storylines: StorylineInfo[]) {
    this.matches.push({ bookId, seriesVolumeId, sourceIssueId, storylines });
  }
  async recordFailure(_runId: number, bookId: number, errors: ScanError[]) {
    this.failures.push({ bookId, errors });
  }
  async startRun(trigger: string) {
    this.runs.push({ trigger });
    return this.runs.length;
  }
  async finishRun(runId: number, result: unknown) {
    this.runs[runId - 1].result = result;
  }
}

function row(book_id: number, series: string, number = '1'): PendingBookRow {
  return { book_id, series, volume: null, publisher: 'Marvel', number, publish_date: '2021-05-12' };
}

const volume = (name: string): VolumeInfo => ({
  source: 'test',
  sourceId: name,
  name,
  startYear: 2020,
  publisher: 'Marvel',
  countOfIssues: 10,
  lastIssueNumber: '10',
  lastIssueDate: '2021-01-01',
  isOngoing: false,
  siteUrl: null,
});

function fakeAdapter(name: string, resolve: (group: BookGroup) => GroupResult | Promise<GroupResult>): SeriesAdapter & { seen: string[] } {
  const seen: string[] = [];
  return {
    name,
    source: 'test',
    seen,
    async resolve(group) {
      seen.push(group.series);
      return resolve(group);
    },
    requestCounts: () => ({ volumes: seen.length }),
  };
}

const matchAll = (group: BookGroup): GroupResult => ({
  kind: 'matched',
  volume: volume(group.series),
  issues: group.books.map((b) => ({ bookId: b.bookId, sourceIssueId: `i${b.bookId}`, publishDate: null, storylines: [] })),
  deferredBookIds: [],
});

describe('runScan', () => {
  it('matches each group once and logs the run', async () => {
    const store = new MemoryStore([row(1, 'Cable', '11'), row(2, 'Cable', '12'), row(3, 'Silk')]);
    const cv = fakeAdapter('comicvine', matchAll);

    const summary = await runScan({ store, adapters: [cv], trigger: 'nightly' });

    expect(cv.seen).toEqual(['Cable', 'Silk']);
    expect(store.matches.map((m) => [m.bookId, m.seriesVolumeId])).toEqual([[1, 1], [2, 1], [3, 2]]);
    expect(summary).toMatchObject({ status: 'completed', matched: 3, failed: 0, deferred: 0 });
    expect(store.runs[0]).toMatchObject({ trigger: 'nightly', result: { status: 'completed', matched: 3, failed: 0 } });
  });

  it('tries the next adapter, then records every adapter error on each book', async () => {
    const store = new MemoryStore([row(1, 'Mystery', '1'), row(2, 'Mystery', '2')]);
    const first = fakeAdapter('first', () => ({ kind: 'failed', code: 'not_found', message: 'nope' }));
    const second = fakeAdapter('second', () => ({ kind: 'failed', code: 'ambiguous', message: 'too many' }));

    const summary = await runScan({ store, adapters: [first, second], trigger: 'manual' });

    expect(second.seen).toEqual(['Mystery']);
    expect(store.failures).toEqual([
      { bookId: 1, errors: [{ adapter: 'first', code: 'not_found', message: 'nope', details: undefined }, { adapter: 'second', code: 'ambiguous', message: 'too many', details: undefined }] },
      { bookId: 2, errors: expect.any(Array) },
    ]);
    expect(summary).toMatchObject({ status: 'completed', matched: 0, failed: 2 });
  });

  it('passes a previously matched volume to the adapter', async () => {
    const store = new MemoryStore([row(1, 'Cable')]);
    store.known.set('Cable', { source: 'test', sourceId: 'cv-77' });
    let seenKnown: string | null = null;
    const cv: SeriesAdapter = {
      name: 'comicvine',
      source: 'test',
      async resolve(group, context) {
        seenKnown = context.knownSourceId;
        return matchAll(group);
      },
      requestCounts: () => ({}),
    };

    await runScan({ store, adapters: [cv], trigger: 'nightly' });
    expect(seenKnown).toBe('cv-77');
  });

  it('ends the batch as partial when the adapter runs out of budget, leaving the rest pending', async () => {
    const store = new MemoryStore([row(1, 'Cable'), row(2, 'Silk'), row(3, 'Venom')]);
    const cv = fakeAdapter('comicvine', (group) => {
      if (group.series === 'Silk') throw new StopRun('request budget for this batch is used up', 'budget_exhausted', false);
      return matchAll(group);
    });

    const summary = await runScan({ store, adapters: [cv], trigger: 'nightly' });

    expect(cv.seen).toEqual(['Cable', 'Silk']);
    expect(store.failures).toEqual([]);
    expect(summary).toMatchObject({ status: 'partial', matched: 1, failed: 0, deferred: 2 });
    expect(summary.groups.map((g) => g.outcome)).toEqual(['matched', 'deferred']);
  });

  it('marks the run failed on a fatal adapter error', async () => {
    const store = new MemoryStore([row(1, 'Cable')]);
    const cv = fakeAdapter('comicvine', () => {
      throw new StopRun('ComicVine rejected the API key', 'invalid_api_key', true);
    });

    const summary = await runScan({ store, adapters: [cv], trigger: 'nightly' });
    expect(summary).toMatchObject({ status: 'failed', note: 'ComicVine rejected the API key' });
    expect(store.runs[0].result).toMatchObject({ status: 'failed' });
  });

  it('writes nothing in a dry run', async () => {
    const store = new MemoryStore([row(1, 'Cable'), row(2, 'Silk')]);
    const summary = await runScan({ store, adapters: [fakeAdapter('comicvine', matchAll)], trigger: 'manual', dryRun: true, maxGroups: 1 });

    expect(store.runs).toEqual([]);
    expect(store.matches).toEqual([]);
    expect(summary.runId).toBeNull();
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0]).toMatchObject({ outcome: 'matched', volumeMatch: { name: 'Cable' }, issuesMatched: 1 });
  });
});
