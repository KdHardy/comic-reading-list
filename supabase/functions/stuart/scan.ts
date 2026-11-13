// Stuart's scan loop: group pending books, try each adapter in priority order,
// and record matches or failures. Storage is behind StuartStore so the loop can
// be tested without a database (see scan.test.ts).

import { StopRun, type GroupResult, type SeriesAdapter, type StorylineInfo, type VolumeInfo } from './adapter.ts';
import { groupBooks, type BookGroup } from './matching.ts';

export interface PendingBookRow {
  book_id: number;
  series: string;
  volume: string | null;
  publisher: string | null;
  number: string | null;
  publish_date: string | null;
}

export interface ScanError {
  adapter: string;
  code: string;
  message: string;
  details?: unknown;
}

export interface StuartStore {
  pendingBooks(limit: number): Promise<PendingBookRow[]>;
  knownVolume(group: BookGroup): Promise<{ source: string; sourceId: string } | null>;
  knownStorylineIds(source: string): Promise<Set<string>>;
  upsertVolume(volume: VolumeInfo): Promise<number>;
  applyMatch(
    bookId: number,
    seriesVolumeId: number,
    sourceIssueId: string | null,
    publishDate: string | null,
    storylines: StorylineInfo[]
  ): Promise<void>;
  recordFailure(runId: number, bookId: number, errors: ScanError[]): Promise<void>;
  startRun(trigger: string): Promise<number>;
  finishRun(
    runId: number,
    result: { status: 'completed' | 'partial' | 'failed'; matched: number; failed: number; requests: unknown; note: string | null }
  ): Promise<void>;
}

export interface ScanOptions {
  store: StuartStore;
  adapters: SeriesAdapter[];
  trigger: string;
  /** Look things up and report what would change, without writing. */
  dryRun?: boolean;
  /** Stop after this many groups (useful for dry runs). */
  maxGroups?: number;
  maxBooks?: number;
}

export interface GroupReport {
  series: string;
  volume: string | null;
  publisher: string | null;
  bookIds: number[];
  outcome: 'matched' | 'failed' | 'deferred';
  adapter?: string;
  volumeMatch?: { name: string; startYear: number | null; publisher: string | null; sourceId: string; url: string | null };
  issuesMatched?: number;
  issuesWithoutSourceIssue?: number;
  storylines?: string[];
  errors?: ScanError[];
  bookFailures?: { bookId: number; code: string; message: string }[];
}

export interface ScanSummary {
  runId: number | null;
  status: 'completed' | 'partial' | 'failed';
  matched: number;
  failed: number;
  deferred: number;
  note: string | null;
  requests: Record<string, Record<string, number>>;
  groups: GroupReport[];
}

export async function runScan(options: ScanOptions): Promise<ScanSummary> {
  const { store, adapters, trigger, dryRun = false } = options;
  const runId = dryRun ? null : await store.startRun(trigger);
  const rows = await store.pendingBooks(options.maxBooks ?? 500);
  const groups = groupBooks(rows);
  const limit = options.maxGroups ?? groups.length;

  const storylineIds = new Map<string, Set<string>>();
  for (const adapter of adapters) storylineIds.set(adapter.source, await store.knownStorylineIds(adapter.source));

  const reports: GroupReport[] = [];
  let matched = 0;
  let failed = 0;
  let status: ScanSummary['status'] = 'completed';
  let note: string | null = null;

  try {
    for (const group of groups.slice(0, limit)) {
      const report: GroupReport = {
        series: group.series,
        volume: group.volume,
        publisher: group.publisher,
        bookIds: group.books.map((b) => b.bookId),
        outcome: 'failed',
      };
      reports.push(report);

      const errors: ScanError[] = [];
      let result: (GroupResult & { kind: 'matched' }) | null = null;
      let winner: SeriesAdapter | null = null;

      const known = await store.knownVolume(group);
      for (const adapter of adapters) {
        const outcome = await adapter.resolve(group, {
          knownSourceId: known && known.source === adapter.source ? known.sourceId : null,
          knownStorylineIds: storylineIds.get(adapter.source)!,
        });
        if (outcome.kind === 'matched') {
          result = outcome;
          winner = adapter;
          break;
        }
        errors.push({ adapter: adapter.name, code: outcome.code, message: outcome.message, details: outcome.details });
      }

      if (!result || !winner) {
        report.errors = errors;
        failed += group.books.length;
        if (!dryRun) {
          for (const book of group.books) await store.recordFailure(runId!, book.bookId, errors);
        }
        continue;
      }

      const v = result.volume;
      report.outcome =
        result.issues.length > 0 ? 'matched' : result.deferredBookIds.length > 0 ? 'deferred' : 'failed';
      report.adapter = winner.name;
      report.volumeMatch = { name: v.name, startYear: v.startYear, publisher: v.publisher, sourceId: v.sourceId, url: v.siteUrl };
      report.issuesMatched = result.issues.length;
      if (result.bookFailures.length > 0) {
        report.bookFailures = result.bookFailures.map((f) => ({ bookId: f.bookId, code: f.code, message: f.message }));
      }
      report.issuesWithoutSourceIssue = result.issues.filter((i) => !i.sourceIssueId).length;
      report.storylines = [...new Set(result.issues.flatMap((i) => i.storylines.map((s) => s.name)))];
      matched += result.issues.length;
      failed += result.bookFailures.length;

      if (!dryRun) {
        const seriesVolumeId = await store.upsertVolume(v);
        for (const issue of result.issues) {
          await store.applyMatch(issue.bookId, seriesVolumeId, issue.sourceIssueId, issue.publishDate, issue.storylines);
        }
        for (const f of result.bookFailures) {
          await store.recordFailure(runId!, f.bookId, [{ adapter: winner.name, code: f.code, message: f.message, details: f.details }]);
        }
      }

      if (result.deferredBookIds.length > 0) {
        status = 'partial';
        note = 'Request budget used up; remaining books continue in the next batch.';
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof StopRun)) {
      status = 'failed';
      note = `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    } else {
      status = error.fatal ? 'failed' : 'partial';
      note = error.message;
      const last = reports[reports.length - 1];
      if (last && last.outcome === 'failed' && !last.errors) last.outcome = 'deferred';
    }
  }

  const requests: ScanSummary['requests'] = {};
  for (const adapter of adapters) requests[adapter.name] = adapter.requestCounts();

  const deferred = rows.length - matched - failed;
  if (status === 'completed' && deferred > 0 && limit < groups.length) {
    note = note ?? `Stopped after ${limit} groups.`;
  }

  if (!dryRun) {
    await store.finishRun(runId!, { status, matched, failed, requests, note });
  }

  return { runId, status, matched, failed, deferred, note, requests, groups: reports };
}
