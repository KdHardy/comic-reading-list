// StuartStore backed by the project's database, using the service role.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { StorylineInfo, VolumeInfo } from './adapter.ts';
import type { BookGroup, SeriesAlias } from './matching.ts';
import type { PendingBookRow, ScanError, StuartStore } from './scan.ts';

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export class SupabaseStuartStore implements StuartStore {
  constructor(private readonly db: SupabaseClient) {}

  async pendingBooks(limit: number): Promise<PendingBookRow[]> {
    return check(await this.db.rpc('stuart_pending_books', { p_limit: limit }), 'stuart_pending_books') as PendingBookRow[];
  }

  async aliases(): Promise<SeriesAlias[]> {
    const rows = check(
      await this.db.from('stuart_series_alias').select('alias, title, start_year, publisher'),
      'stuart_series_alias'
    ) as { alias: string; title: string; start_year: number | null; publisher: string | null }[];
    return rows.map((r) => ({ alias: r.alias, title: r.title, startYear: r.start_year, publisher: r.publisher }));
  }

  async skipBook(bookId: number, reason: string): Promise<void> {
    check(await this.db.rpc('stuart_skip_book', { p_book_id: bookId, p_reason: reason }), 'stuart_skip_book');
  }

  /** Requests made by batches that started in the last `minutes`, by adapter and resource. */
  async recentRequestCounts(minutes: number): Promise<Record<string, Record<string, number>>> {
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const rows = check(
      await this.db.from('stuart_run').select('requests').gte('started_at', since),
      'stuart_run'
    ) as { requests: Record<string, Record<string, number>> | null }[];
    const totals: Record<string, Record<string, number>> = {};
    for (const { requests } of rows) {
      for (const [adapter, byResource] of Object.entries(requests ?? {})) {
        totals[adapter] ??= {};
        for (const [resource, n] of Object.entries(byResource ?? {})) {
          totals[adapter][resource] = (totals[adapter][resource] ?? 0) + Number(n);
        }
      }
    }
    return totals;
  }

  async knownVolume(group: BookGroup) {
    const rows = check(
      await this.db.rpc('stuart_known_volume', {
        p_series: group.series,
        p_volume: group.volume ?? '',
        p_publisher: group.publisher ?? '',
      }),
      'stuart_known_volume'
    ) as { source: string; source_id: string }[];
    return rows[0] ? { source: rows[0].source, sourceId: rows[0].source_id } : null;
  }

  async knownStorylineIds(source: string): Promise<Set<string>> {
    const ids = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const rows = check(
        await this.db.from('storyline').select('source_id').eq('source', source).range(from, from + 999),
        'storyline'
      ) as { source_id: string }[];
      for (const row of rows) ids.add(row.source_id);
      if (rows.length < 1000) return ids;
    }
  }

  async upsertVolume(v: VolumeInfo): Promise<number> {
    const id = check(
      await this.db.rpc('stuart_upsert_series_volume', {
        p_volume: {
          source: v.source,
          source_id: v.sourceId,
          name: v.name,
          start_year: v.startYear,
          publisher: v.publisher,
          count_of_issues: v.countOfIssues,
          last_issue_number: v.lastIssueNumber,
          last_issue_date: v.lastIssueDate,
          is_ongoing: v.isOngoing,
          site_url: v.siteUrl,
        },
      }),
      'stuart_upsert_series_volume'
    );
    return Number(id);
  }

  async applyMatch(
    bookId: number,
    seriesVolumeId: number,
    sourceIssueId: string | null,
    publishDate: string | null,
    storylines: StorylineInfo[]
  ): Promise<void> {
    check(
      await this.db.rpc('stuart_apply_book_match', {
        p_book_id: bookId,
        p_series_volume_id: seriesVolumeId,
        p_source_issue_id: sourceIssueId,
        p_publish_date: publishDate,
        p_storylines: storylines.map((s) => ({
          source_id: s.sourceId,
          name: s.name,
          publisher: s.publisher ?? null,
          issue_count: s.issueCount ?? null,
          site_url: s.siteUrl ?? null,
        })),
      }),
      'stuart_apply_book_match'
    );
  }

  async recordFailure(runId: number, bookId: number, errors: ScanError[]): Promise<void> {
    check(
      await this.db.rpc('stuart_record_book_failure', { p_run_id: runId, p_book_id: bookId, p_errors: errors }),
      'stuart_record_book_failure'
    );
  }

  async startRun(trigger: string): Promise<number> {
    const row = check(
      await this.db.from('stuart_run').insert({ trigger }).select('run_id').single(),
      'stuart_run insert'
    ) as { run_id: number };
    return Number(row.run_id);
  }

  async finishRun(
    runId: number,
    result: { status: string; matched: number; failed: number; requests: unknown; note: string | null }
  ): Promise<void> {
    check(
      await this.db
        .from('stuart_run')
        .update({
          status: result.status,
          finished_at: new Date().toISOString(),
          books_matched: result.matched,
          books_failed: result.failed,
          requests: result.requests,
          note: result.note,
        })
        .eq('run_id', runId),
      'stuart_run update'
    );
  }
}
