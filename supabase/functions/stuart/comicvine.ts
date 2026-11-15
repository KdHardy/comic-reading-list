// ComicVine adapter for Stuart.
//
// API: https://comicvine.gamespot.com/api/documentation
// ComicVine limits each resource to about 200 requests per hour and blocks
// clients that call too quickly, so requests are spaced out and capped per
// batch. Responses carry `status_code`: 1 OK, 100 invalid key, 101 not found,
// 104 filter error, 107 rate limited.

import {
  StopRun,
  type AdapterContext,
  type BookFailure,
  type CachedIssue,
  type CachedVolume,
  type GroupResult,
  type IssueMatch,
  type SeriesAdapter,
  type StorylineInfo,
  type VolumeInfo,
} from './adapter.ts';
import {
  compareDates,
  DATE_WINDOW_DAYS,
  earliestPublishDate,
  filterCandidates,
  isOngoing,
  issueSearchWindow,
  normalizeTitle,
  normalizeIssueNumber,
  pickLookupBook,
  pickProbeBook,
  searchTitle,
  titleLooselyMatches,
  publishersMatch,
  type BookGroup,
  type GroupBook,
  type VolumeCandidate,
} from './matching.ts';

const BASE_URL = 'https://comicvine.gamespot.com/api';
const USER_AGENT = 'ComicReadingList-Stuart/1.0 (personal reading-list metadata agent)';
const VOLUME_FIELDS = 'id,name,start_year,publisher,count_of_issues,first_issue,last_issue,site_detail_url';
const ISSUE_LIST_FIELDS = 'id,issue_number,store_date,cover_date';
const MAX_VERIFY_CANDIDATES = 5;
/** Issue-lookup results beyond this are too broad (e.g. every #1 in a quarter) to page through. */
const MAX_ISSUE_LOOKUP_RESULTS = 200;
/** Issue lookups try a month either side first, then about a quarter. */
const ISSUE_LOOKUP_WINDOWS_DAYS = [31, DATE_WINDOW_DAYS];
/** Stored details of a still-running volume are refreshed after this long; finished runs never. */
const DETAILS_REFRESH_DAYS = 30;

export interface ComicVineOptions {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum gap between requests. */
  minIntervalMs?: number;
  /** Request cap for this batch, across all resources. */
  maxRequests?: number;
  /**
   * Requests still allowed per resource (ComicVine limits each resource to
   * ~200 an hour). Resources not listed are only bound by maxRequests.
   */
  remainingByResource?: Record<string, number>;
  /** Epoch ms after which no new request starts. */
  deadline?: number;
  /** "YYYY-MM-DD" used for the ongoing check. */
  today?: string;
}

interface CvResponse<T> {
  status_code: number;
  error: string;
  number_of_total_results: number;
  results: T;
}

interface CvVolume {
  id: number;
  name: string;
  start_year: string | null;
  publisher: { name: string } | null;
  count_of_issues: number | null;
  first_issue?: { issue_number: string | null } | null;
  last_issue: { issue_number: string | null } | null;
  site_detail_url: string | null;
}

interface CvIssue {
  id: number;
  issue_number: string | null;
  store_date: string | null;
  cover_date: string | null;
  volume?: { id: number; name: string } | null;
}

interface CvArcCredit {
  id: number;
  name: string;
  site_detail_url?: string | null;
}

class BudgetExhausted extends StopRun {
  constructor(reason: string) {
    super(reason, 'budget_exhausted', false);
  }
}

export class ComicVineAdapter implements SeriesAdapter {
  readonly name = 'comicvine';
  readonly source = 'comicvine';

  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly maxRequests: number;
  private readonly remainingByResource: Record<string, number>;
  private readonly deadline: number;
  private readonly today: string;
  private lastRequestAt = 0;
  private total = 0;
  private readonly counts: Record<string, number> = {};
  /** Volumes whose issue list was already fetched in this batch (don't fetch twice). */
  private readonly issuesFetched = new Set<string>();
  /** Matches made without a ComicVine search, for the run log. */
  private cacheHits = 0;

  constructor(private readonly options: ComicVineOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.maxRequests = options.maxRequests ?? 90;
    this.remainingByResource = options.remainingByResource ?? {};
    this.deadline = options.deadline ?? Number.POSITIVE_INFINITY;
    this.today = options.today ?? new Date().toISOString().slice(0, 10);
  }

  requestCounts(): Record<string, number> {
    return this.cacheHits > 0 ? { ...this.counts, cache_hits: this.cacheHits } : { ...this.counts };
  }

  private remaining(): number {
    return this.maxRequests - this.total;
  }

  private async get<T>(resource: string, path: string, params: Record<string, string>): Promise<CvResponse<T>> {
    if (this.total >= this.maxRequests) throw new BudgetExhausted('request budget for this batch is used up');
    const hourly = this.remainingByResource[resource];
    if (hourly !== undefined && (this.counts[resource] ?? 0) >= hourly) {
      throw new BudgetExhausted(`hourly ComicVine limit for "${resource}" reached; continuing next batch`);
    }
    const wait = this.lastRequestAt + this.minIntervalMs - this.now();
    if (this.now() + Math.max(wait, 0) > this.deadline) throw new BudgetExhausted('batch time limit reached');
    if (wait > 0) await this.sleep(wait);

    const url = new URL(`${BASE_URL}/${path}`);
    url.searchParams.set('api_key', this.options.apiKey);
    url.searchParams.set('format', 'json');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    this.total += 1;
    this.counts[resource] = (this.counts[resource] ?? 0) + 1;
    this.lastRequestAt = this.now();

    const response = await this.fetchFn(url.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (response.status === 420 || response.status === 429) {
      throw new StopRun(`ComicVine rate limit (HTTP ${response.status})`, 'rate_limited', false);
    }
    if (response.status === 401) {
      throw new StopRun('ComicVine rejected the API key (HTTP 401)', 'invalid_api_key', true);
    }

    let body: CvResponse<T>;
    try {
      body = (await response.json()) as CvResponse<T>;
    } catch {
      throw new StopRun(`ComicVine returned HTTP ${response.status} with a non-JSON body`, 'bad_response', false);
    }

    if (body.status_code === 100) throw new StopRun('ComicVine rejected the API key', 'invalid_api_key', true);
    if (body.status_code === 107) throw new StopRun('ComicVine rate limit reached', 'rate_limited', false);
    if (!response.ok && body.status_code !== 101) {
      throw new StopRun(`ComicVine HTTP ${response.status}: ${body.error}`, 'http_error', false);
    }
    return body;
  }

  private toCandidate(v: CvVolume): VolumeCandidate {
    const year = v.start_year ? Number.parseInt(v.start_year, 10) : NaN;
    return {
      sourceId: String(v.id),
      name: v.name,
      startYear: Number.isFinite(year) ? year : null,
      publisher: v.publisher?.name ?? null,
      countOfIssues: v.count_of_issues ?? null,
      siteUrl: v.site_detail_url ?? null,
      firstIssueNumber: v.first_issue?.issue_number ?? null,
      lastIssueNumber: v.last_issue?.issue_number ?? null,
    };
  }

  /** ComicVine filter values can't contain the "," or ":" separators. */
  private filterValue(text: string): string {
    return text.replace(/[,:]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * ComicVine's search ranks exact titles first, so it's the main lookup. The
   * name filter (a substring match, unsorted) is the fallback when search
   * turns up nothing usable.
   */
  private async findCandidates(group: BookGroup): Promise<{ volumes: CvVolume[]; all: VolumeCandidate[] }> {
    const search = await this.get<CvVolume[]>('search', 'search/', {
      query: searchTitle(group),
      resources: 'volume',
      field_list: VOLUME_FIELDS,
      limit: '10',
    });
    let volumes = search.status_code === 1 ? search.results : [];

    if (filterCandidates(group, volumes.map((v) => this.toCandidate(v))).candidates.length === 0) {
      const byName = await this.get<CvVolume[]>('volumes', 'volumes/', {
        filter: `name:${this.filterValue(searchTitle(group))}`,
        field_list: VOLUME_FIELDS,
        limit: '100',
      });
      if (byName.status_code === 1) volumes = [...volumes, ...byName.results];
    }
    return { volumes, all: volumes.map((v) => this.toCandidate(v)) };
  }

  private async issueDates(volumeId: string, issueNumber: string): Promise<CvIssue | null> {
    const response = await this.get<CvIssue[]>('issues', 'issues/', {
      filter: `volume:${volumeId},issue_number:${this.filterValue(issueNumber)}`,
      field_list: ISSUE_LIST_FIELDS,
      limit: '5',
    });
    return response.status_code === 1 ? response.results[0] ?? null : null;
  }

  /**
   * Find the volume by the issue itself: every issue with this number released
   * within about a quarter of the reading-list date (same year), keeping those
   * whose volume title matches. Catches runs that search ranks below its top 10
   * (e.g. Batman #109 in 2021, under dozens of older "Batman" volumes).
   */
  private async findVolumeByIssue(
    group: BookGroup,
    probe: GroupBook
  ): Promise<{ volume: CvVolume | null; details: Record<string, unknown> }> {
    const number = this.filterValue(probe.number!);
    const title = searchTitle(group);
    const wantPublisher = group.alias?.publisher ?? group.publisher;
    const details: Record<string, unknown> = { issue_number: probe.number, publish_date: probe.publishDate, tries: [] };
    const tried = new Set<number>();

    for (const days of ISSUE_LOOKUP_WINDOWS_DAYS) {
      const { start, end } = issueSearchWindow(probe.publishDate!, days);
      for (const field of ['store_date', 'cover_date'] as const) {
        const attempt: Record<string, unknown> = { field, window: [start, end] };
        (details.tries as unknown[]).push(attempt);

        const found: CvIssue[] = [];
        for (let offset = 0; offset < MAX_ISSUE_LOOKUP_RESULTS; offset += 100) {
          const page = await this.get<CvIssue[]>('issues', 'issues/', {
            filter: `issue_number:${number},${field}:${start} 00:00:00|${end} 23:59:59`,
            field_list: `${ISSUE_LIST_FIELDS},volume`,
            limit: '100',
            offset: String(offset),
          });
          if (page.status_code !== 1) break;
          if (page.number_of_total_results > MAX_ISSUE_LOOKUP_RESULTS) {
            attempt.result = `too many results (${page.number_of_total_results})`;
            break;
          }
          found.push(...page.results);
          if (found.length >= page.number_of_total_results) break;
        }

        const exact = found.filter((i) => i.volume && normalizeTitle(i.volume.name) === normalizeTitle(title));
        const titled = exact.length > 0 ? exact : found.filter((i) => i.volume && titleLooselyMatches(title, i.volume.name));
        const ranked = titled
          .map((issue) => ({ issue, dates: compareDates(probe.publishDate, issue.store_date, issue.cover_date) }))
          .filter((r) => r.dates.solid)
          .sort((a, b) => a.dates.days! - b.dates.days!);
        attempt.matches = ranked.map((r) => ({
          volume_id: r.issue.volume!.id,
          volume: r.issue.volume!.name,
          release_date: r.dates.releaseDate,
          days_apart: r.dates.days,
        }));

        for (const { issue } of ranked) {
          if (tried.has(issue.volume!.id) || tried.size >= 3) continue;
          tried.add(issue.volume!.id);
          const volume = await this.volumeById(String(issue.volume!.id));
          if (volume && (!wantPublisher || publishersMatch(wantPublisher, volume.publisher?.name))) {
            return { volume, details };
          }
        }
      }
    }
    return { volume: null, details };
  }

  private async volumeById(sourceId: string): Promise<CvVolume | null> {
    const response = await this.get<CvVolume>('volume', `volume/4050-${sourceId}/`, { field_list: VOLUME_FIELDS });
    return response.status_code === 1 && response.results && !Array.isArray(response.results) ? response.results : null;
  }

  private async allIssues(volumeId: string): Promise<CvIssue[]> {
    const issues: CvIssue[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.get<CvIssue[]>('issues', 'issues/', {
        filter: `volume:${volumeId}`,
        field_list: ISSUE_LIST_FIELDS,
        limit: '100',
        offset: String(offset),
      });
      if (page.status_code !== 1) break;
      issues.push(...page.results);
      if (page.results.length < 100 || issues.length >= page.number_of_total_results) break;
    }
    return issues;
  }

  private async storylinesFor(issueId: string, context: AdapterContext): Promise<StorylineInfo[]> {
    const response = await this.get<{ story_arc_credits?: CvArcCredit[] }>('issue', `issue/4000-${issueId}/`, {
      field_list: 'id,story_arc_credits',
    });
    const credits = response.status_code === 1 ? response.results.story_arc_credits ?? [] : [];

    const arcs: StorylineInfo[] = [];
    for (const credit of credits) {
      const arc: StorylineInfo = { sourceId: String(credit.id), name: credit.name, siteUrl: credit.site_detail_url ?? null };
      // Arc details (publisher, issue count) are a nice-to-have: fetch them for
      // new arcs only while plenty of budget is left.
      if (!context.knownStorylineIds.has(arc.sourceId) && this.remaining() > 15) {
        const detail = await this.get<{ publisher: { name: string } | null; count_of_issue_appearances: number | null }>(
          'story_arc',
          `story_arc/4045-${arc.sourceId}/`,
          { field_list: 'id,publisher,count_of_issue_appearances' }
        );
        if (detail.status_code === 1) {
          arc.publisher = detail.results.publisher?.name ?? null;
          arc.issueCount = detail.results.count_of_issue_appearances ?? null;
        }
        context.knownStorylineIds.add(arc.sourceId);
      }
      arcs.push(arc);
    }
    return arcs;
  }

  /** A cached volume as ComicVine's shape, for volumes chosen from the store. */
  private fromCache(v: CachedVolume): CvVolume {
    return {
      id: Number(v.sourceId),
      name: v.name,
      start_year: v.startYear != null ? String(v.startYear) : null,
      publisher: v.publisher ? { name: v.publisher } : null,
      count_of_issues: v.countOfIssues,
      first_issue: { issue_number: v.firstIssueNumber ?? null },
      last_issue: { issue_number: v.lastIssueNumber ?? null },
      site_detail_url: v.siteUrl,
    };
  }

  private toCachedIssues(issues: CvIssue[]): CachedIssue[] {
    return issues.map((i) => ({
      sourceIssueId: String(i.id),
      issueNumber: i.issue_number,
      storeDate: i.store_date,
      coverDate: i.cover_date,
      storylines: null,
    }));
  }

  private detailsStale(v: CachedVolume): boolean {
    if (v.isOngoing === false && v.detailsSyncedAt) return false;
    if (!v.detailsSyncedAt) return true;
    return (Date.parse(`${this.today}T00:00:00Z`) - Date.parse(v.detailsSyncedAt)) / 86_400_000 > DETAILS_REFRESH_DAYS;
  }

  /**
   * Try the volumes Stuart already knows before searching ComicVine: same
   * title rules and ranking, verified against stored issue dates. A volume
   * whose issue list was never stored costs one issue lookup to verify, still
   * cheaper than a search.
   */
  private async matchFromCache(group: BookGroup, context: AdapterContext): Promise<CachedVolume | null> {
    const probe = pickProbeBook(group);
    if (!probe) return null;
    const { candidates } = filterCandidates(group, context.cache.volumes);
    const want = normalizeIssueNumber(probe.number);

    for (const candidate of candidates.slice(0, MAX_VERIFY_CANDIDATES)) {
      const cached = context.cache.volumes.find((v) => v.sourceId === candidate.sourceId)!;
      const stored = await context.cache.issues(candidate.sourceId);
      let issue: { store_date: string | null; cover_date: string | null } | null = null;
      if (stored) {
        const hit = stored.find((i) => normalizeIssueNumber(i.issueNumber) === want);
        if (hit) issue = { store_date: hit.storeDate, cover_date: hit.coverDate };
        // Not stored: only worth asking ComicVine if the run may have gone on since.
        else if (cached.isOngoing !== false) issue = await this.issueDates(candidate.sourceId, probe.number!);
      } else {
        issue = await this.issueDates(candidate.sourceId, probe.number!);
      }
      if (issue && compareDates(probe.publishDate, issue.store_date, issue.cover_date).solid) return cached;
    }
    return null;
  }

  async resolve(group: BookGroup, context: AdapterContext): Promise<GroupResult> {
    let chosen: CvVolume | null = null;
    let cached: CachedVolume | null = null;
    let detailsFetched = false;

    if (context.knownSourceId) {
      cached = context.cache.volumes.find((v) => v.sourceId === context.knownSourceId) ?? null;
      if (!cached) {
        chosen = await this.volumeById(context.knownSourceId);
        detailsFetched = chosen != null;
      }
    }

    // Stuart's own store first.
    if (!cached && !chosen) {
      cached = await this.matchFromCache(group, context);
      if (cached) this.cacheHits += 1;
    }

    if (cached) {
      if (this.detailsStale(cached)) {
        chosen = await this.volumeById(cached.sourceId);
        detailsFetched = chosen != null;
      }
      chosen ??= this.fromCache(cached);
    }

    if (!chosen) {
      const title = searchTitle(group);
      const { volumes, all } = await this.findCandidates(group);
      const { candidates, loose, estimatedStart, rejected } = filterCandidates(group, all);
      const summary = (c: VolumeCandidate) => ({
        id: c.sourceId,
        name: c.name,
        start_year: c.startYear,
        publisher: c.publisher,
        issues: c.countOfIssues,
        issue_range: c.firstIssueNumber || c.lastIssueNumber ? `${c.firstIssueNumber ?? '?'}–${c.lastIssueNumber ?? '?'}` : null,
        url: c.siteUrl,
      });

      // A solid match needs the comic's name, issue number AND date: the issue
      // must have come out in the same year and within about a quarter.
      const probe = pickProbeBook(group);
      if (!probe) {
        return candidates.length === 0
          ? {
              kind: 'failed',
              code: all.length === 0 ? 'not_found' : 'no_candidates',
              message: `No ComicVine volume fits "${title}", and the comics have no issue number and date to look one up by.`,
              details: { rejected: rejected.slice(0, 10) },
            }
          : {
              kind: 'failed',
              code: 'no_date',
              message: `None of the "${group.series}" comics has both an issue number and a publish date, so no ComicVine volume can be confirmed.`,
              details: { loose_title_match: loose, candidates: candidates.slice(0, 10).map(summary) },
            };
      }

      let failure: GroupResult & { kind: 'failed' };
      if (candidates.length === 0) {
        failure =
          all.length === 0
            ? { kind: 'failed', code: 'not_found', message: `No ComicVine volume named "${title}".`, details: {} }
            : {
                kind: 'failed',
                code: 'no_candidates',
                message: `Found ${all.length} ComicVine volume(s) for "${title}", but none fit the publisher or year.`,
                details: { rejected: rejected.slice(0, 10) },
              };
      } else {
        const checked: { candidate: VolumeCandidate; issue: string | null; release_date: string | null; days: number | null }[] = [];
        let match: VolumeCandidate | null = null;
        let best = Number.POSITIVE_INFINITY;
        for (const candidate of candidates.slice(0, MAX_VERIFY_CANDIDATES)) {
          const issue = await this.issueDates(candidate.sourceId, probe.number!);
          const dates = compareDates(probe.publishDate, issue?.store_date ?? null, issue?.cover_date ?? null);
          checked.push({ candidate, issue: issue ? String(issue.id) : null, release_date: dates.releaseDate, days: dates.days });
          if (dates.solid && dates.days! < best) {
            match = candidate;
            best = dates.days!;
            if (best <= 7) break; // can't do better than the same week
          }
        }
        if (match) chosen = volumes.find((v) => String(v.id) === match!.sourceId) ?? null;
        failure = {
          kind: 'failed',
          code: 'no_date_match',
          message: `No ComicVine volume of "${title}" has #${probe.number} released in ${probe.publishDate!.slice(0, 4)} within ${DATE_WINDOW_DAYS} days of ${probe.publishDate}.`,
          details: {
            checked_issue: probe.number,
            publish_date: probe.publishDate,
            earliest_publish_date: earliestPublishDate(group.books),
            estimated_run_start: estimatedStart,
            loose_title_match: loose,
            checked: checked.map((c) => ({ ...summary(c.candidate), issue_id: c.issue, release_date: c.release_date, days_apart: c.days })),
            other_candidates: candidates.slice(MAX_VERIFY_CANDIDATES, 10).map(summary),
          },
        };
      }

      // Search didn't turn up the run: look the issue itself up by number and date.
      if (!chosen) {
        const byIssue = await this.findVolumeByIssue(group, pickLookupBook(group) ?? probe);
        if (!byIssue.volume) {
          return { ...failure, details: { ...(failure.details as object), issue_lookup: byIssue.details } };
        }
        chosen = byIssue.volume;
      }
      detailsFetched = true;
      cached = context.cache.volumes.find((v) => v.sourceId === String(chosen!.id)) ?? null;
    }

    const volumeId = String(chosen.id);

    // Issues: the stored list when it covers every comic here (or the run has
    // ended, so a missing number really is missing); otherwise fetch it once.
    let issueList: CachedIssue[] | null = await context.cache.issues(volumeId);
    const wanted = group.books.map((b) => normalizeIssueNumber(b.number)).filter((n): n is string => n != null);
    const storedNumbers = new Set((issueList ?? []).map((i) => normalizeIssueNumber(i.issueNumber)));
    const complete = issueList != null && wanted.every((n) => storedNumbers.has(n));
    const finished = cached?.isOngoing === false && cached.issuesSyncedAt != null;
    let issuesFetched = false;
    if ((issueList == null || (!complete && !finished)) && !this.issuesFetched.has(volumeId)) {
      const fetched = this.toCachedIssues(await this.allIssues(volumeId));
      this.issuesFetched.add(volumeId);
      // Keep arcs already stored for issues we had.
      const arcsById = new Map((issueList ?? []).map((i) => [i.sourceIssueId, i.storylines]));
      issueList = fetched.map((i) => ({ ...i, storylines: arcsById.get(i.sourceIssueId) ?? null }));
      issuesFetched = true;
    }
    const issues = issueList ?? [];

    const byNumber = new Map<string, CachedIssue>();
    for (const issue of issues) {
      const n = normalizeIssueNumber(issue.issueNumber);
      if (n && !byNumber.has(n)) byNumber.set(n, issue);
    }
    const lastIssueDate = issues.reduce<string | null>((max, i) => {
      const d = i.storeDate ?? i.coverDate;
      return d && (!max || d > max) ? d : max;
    }, cached?.lastIssueDate ?? null);

    const candidate = this.toCandidate(chosen);
    const volume: VolumeInfo = {
      source: this.source,
      sourceId: volumeId,
      name: candidate.name,
      startYear: candidate.startYear,
      publisher: candidate.publisher,
      countOfIssues: candidate.countOfIssues,
      firstIssueNumber: candidate.firstIssueNumber ?? null,
      lastIssueNumber: candidate.lastIssueNumber ?? null,
      lastIssueDate,
      isOngoing: isOngoing(lastIssueDate, this.today),
      siteUrl: candidate.siteUrl,
    };
    await context.cache.saveVolume(volume, { detailsSynced: detailsFetched, issues: issuesFetched ? issues : undefined });

    const matched: IssueMatch[] = [];
    const bookFailures: BookFailure[] = [];
    const deferredBookIds: number[] = [];
    for (const book of group.books) {
      const n = normalizeIssueNumber(book.number);
      const issue = n ? byNumber.get(n) : issues.length === 1 ? issues[0] : undefined;
      if (!issue) {
        matched.push({ bookId: book.bookId, sourceIssueId: null, publishDate: null, storylines: [] });
        continue;
      }

      // Every dated comic must line up with its own issue, not just the one
      // used to pick the volume.
      const dates = compareDates(book.publishDate, issue.storeDate, issue.coverDate);
      if (book.publishDate && !dates.solid) {
        bookFailures.push({
          bookId: book.bookId,
          code: 'date_mismatch',
          message: `${volume.name} (${volume.startYear ?? '?'}) #${issue.issueNumber} came out ${dates.releaseDate ?? 'on an unknown date'}, not within ${DATE_WINDOW_DAYS} days of ${book.publishDate} in the same year.`,
          details: {
            volume: { id: volumeId, name: volume.name, start_year: volume.startYear, url: volume.siteUrl },
            issue_id: issue.sourceIssueId,
            store_date: issue.storeDate,
            cover_date: issue.coverDate,
            publish_date: book.publishDate,
            days_apart: dates.days,
          },
        });
        continue;
      }

      try {
        let storylines = issue.storylines;
        if (storylines == null) {
          storylines = await this.storylinesFor(issue.sourceIssueId, context);
          issue.storylines = storylines;
          await context.cache.saveStorylines(volumeId, issue.sourceIssueId, storylines);
        }
        matched.push({
          bookId: book.bookId,
          sourceIssueId: issue.sourceIssueId,
          publishDate: issue.storeDate ?? issue.coverDate ?? null,
          storylines,
        });
      } catch (error) {
        if (error instanceof BudgetExhausted) {
          deferredBookIds.push(book.bookId);
          continue;
        }
        throw error;
      }
    }

    return { kind: 'matched', volume, issues: matched, bookFailures, deferredBookIds };
  }
}
