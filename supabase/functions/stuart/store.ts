// StuartStore backed by the project's database, using the service role.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { CachedIssue, CachedVolume, StorylineInfo, VolumeCache, VolumeInfo } from './adapter.ts';
import { readOnlyCache } from './cache.ts';
import type { BookGroup, SeriesAlias } from './matching.ts';
import type { PendingBookRow, ScanError, StuartStore } from './scan.ts';

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

function volumePayload(v: VolumeInfo, flags: { detailsSynced?: boolean; issuesSynced?: boolean } = {}) {
  return {
    source: v.source,
    source_id: v.sourceId,
    name: v.name,
    start_year: v.startYear,
    publisher: v.publisher,
    count_of_issues: v.countOfIssues,
    first_issue_number: v.firstIssueNumber,
    last_issue_number: v.lastIssueNumber,
    last_issue_date: v.lastIssueDate,
    is_ongoing: v.isOngoing,
    site_url: v.siteUrl,
    details_synced: flags.detailsSynced ?? false,
    issues_synced: flags.issuesSynced ?? false,
  };
}

interface VolumeRow {
  series_volume_id: number;
  source_id: string;
  name: string;
  start_year: number | null;
  publisher: string | null;
  count_of_issues: number | null;
  first_issue_number: string | null;
  last_issue_number: string | null;
  last_issue_date: string | null;
  is_ongoing: boolean | null;
  site_url: string | null;
  details_synced_at: string | null;
  issues_synced_at: string | null;
}

/** Stuart's stored volumes and issues (series_volume, series_volume_issue). */
class SupabaseVolumeCache implements VolumeCache {
  private readonly ids = new Map<string, number>();

  constructor(
    private readonly db: SupabaseClient,
    readonly volumes: CachedVolume[],
    ids: Map<string, number>
  ) {
    this.ids = ids;
  }

  async issues(sourceVolumeId: string): Promise<CachedIssue[] | null> {
    const id = this.ids.get(sourceVolumeId);
    const volume = this.volumes.find((v) => v.sourceId === sourceVolumeId);
    if (id == null || !volume?.issuesSyncedAt) return null;
    const issues: CachedIssue[] = [];
    for (let from = 0; ; from += 1000) {
      const rows = check(
        await this.db
          .from('series_volume_issue')
          .select('source_issue_id, issue_number, store_date, cover_date, storylines')
          .eq('series_volume_id', id)
          .order('source_issue_id')
          .range(from, from + 999),
        'series_volume_issue'
      ) as { source_issue_id: string; issue_number: string | null; store_date: string | null; cover_date: string | null; storylines: unknown }[];
      for (const r of rows) {
        issues.push({
          sourceIssueId: r.source_issue_id,
          issueNumber: r.issue_number,
          storeDate: r.store_date,
          coverDate: r.cover_date,
          storylines: Array.isArray(r.storylines)
            ? (r.storylines as { source_id: string; name: string; site_url?: string | null; publisher?: string | null; issue_count?: number | null }[]).map((a) => ({
                sourceId: a.source_id,
                name: a.name,
                siteUrl: a.site_url ?? null,
                publisher: a.publisher ?? null,
                issueCount: a.issue_count ?? null,
              }))
            : null,
        });
      }
      if (rows.length < 1000) return issues;
    }
  }

  async saveVolume(volume: VolumeInfo, options: { detailsSynced: boolean; issues?: CachedIssue[] }): Promise<void> {
    const id = Number(
      check(
        await this.db.rpc('stuart_upsert_series_volume', { p_volume: volumePayload(volume, { detailsSynced: options.detailsSynced }) }),
        'stuart_upsert_series_volume'
      )
    );
    this.ids.set(volume.sourceId, id);
    if (options.issues) {
      check(
        await this.db.rpc('stuart_replace_volume_issues', {
          p_series_volume_id: id,
          p_issues: options.issues.map((i) => ({
            source_issue_id: i.sourceIssueId,
            issue_number: i.issueNumber,
            store_date: i.storeDate,
            cover_date: i.coverDate,
          })),
        }),
        'stuart_replace_volume_issues'
      );
    }

    const now = new Date().toISOString();
    const existing = this.volumes.find((v) => v.sourceId === volume.sourceId);
    const entry: CachedVolume = {
      sourceId: volume.sourceId,
      name: volume.name,
      startYear: volume.startYear,
      publisher: volume.publisher,
      countOfIssues: volume.countOfIssues,
      siteUrl: volume.siteUrl,
      firstIssueNumber: volume.firstIssueNumber,
      lastIssueNumber: volume.lastIssueNumber,
      lastIssueDate: volume.lastIssueDate,
      isOngoing: volume.isOngoing,
      detailsSyncedAt: options.detailsSynced ? now : existing?.detailsSyncedAt ?? null,
      issuesSyncedAt: options.issues ? now : existing?.issuesSyncedAt ?? null,
    };
    if (existing) Object.assign(existing, entry);
    else this.volumes.push(entry);
  }

  async saveStorylines(sourceVolumeId: string, sourceIssueId: string, storylines: StorylineInfo[]): Promise<void> {
    const id = this.ids.get(sourceVolumeId);
    if (id == null) return;
    check(
      await this.db
        .from('series_volume_issue')
        .update({
          storylines: storylines.map((s) => ({
            source_id: s.sourceId,
            name: s.name,
            site_url: s.siteUrl ?? null,
            publisher: s.publisher ?? null,
            issue_count: s.issueCount ?? null,
          })),
          storylines_synced_at: new Date().toISOString(),
        })
        .eq('series_volume_id', id)
        .eq('source_issue_id', sourceIssueId),
      'series_volume_issue update'
    );
  }
}

export class SupabaseStuartStore implements StuartStore {
  constructor(private readonly db: SupabaseClient) {}

  async pendingBooks(limit: number): Promise<PendingBookRow[]> {
    return check(await this.db.rpc('stuart_pending_books', { p_limit: limit }), 'stuart_pending_books') as PendingBookRow[];
  }

  async volumeCache(source: string, readOnly: boolean): Promise<VolumeCache> {
    const rows: VolumeRow[] = [];
    for (let from = 0; ; from += 1000) {
      const page = check(
        await this.db
          .from('series_volume')
          .select(
            'series_volume_id, source_id, name, start_year, publisher, count_of_issues, first_issue_number, last_issue_number, last_issue_date, is_ongoing, site_url, details_synced_at, issues_synced_at'
          )
          .eq('source', source)
          .order('series_volume_id')
          .range(from, from + 999),
        'series_volume'
      ) as VolumeRow[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    const cache = new SupabaseVolumeCache(
      this.db,
      rows.map((r) => ({
        sourceId: r.source_id,
        name: r.name,
        startYear: r.start_year,
        publisher: r.publisher,
        countOfIssues: r.count_of_issues,
        siteUrl: r.site_url,
        firstIssueNumber: r.first_issue_number,
        lastIssueNumber: r.last_issue_number,
        lastIssueDate: r.last_issue_date,
        isOngoing: r.is_ongoing,
        detailsSyncedAt: r.details_synced_at,
        issuesSyncedAt: r.issues_synced_at,
      })),
      new Map(rows.map((r) => [r.source_id, Number(r.series_volume_id)]))
    );
    return readOnly ? readOnlyCache(cache) : cache;
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
      await this.db.rpc('stuart_upsert_series_volume', { p_volume: volumePayload(v) }),
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
