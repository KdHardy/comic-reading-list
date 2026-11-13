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
  type GroupResult,
  type IssueMatch,
  type SeriesAdapter,
  type StorylineInfo,
  type VolumeInfo,
} from './adapter.ts';
import {
  datesAgree,
  earliestPublishDate,
  filterCandidates,
  isOngoing,
  normalizeIssueNumber,
  pickProbeBook,
  type BookGroup,
  type VolumeCandidate,
} from './matching.ts';

const BASE_URL = 'https://comicvine.gamespot.com/api';
const USER_AGENT = 'ComicReadingList-Stuart/1.0 (personal reading-list metadata agent)';
const VOLUME_FIELDS = 'id,name,start_year,publisher,count_of_issues,last_issue,site_detail_url';
const ISSUE_LIST_FIELDS = 'id,issue_number,store_date,cover_date';
const MAX_VERIFY_CANDIDATES = 3;

export interface ComicVineOptions {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum gap between requests. */
  minIntervalMs?: number;
  /** Request cap for this batch, across all resources. */
  maxRequests?: number;
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
  last_issue: { issue_number: string | null } | null;
  site_detail_url: string | null;
}

interface CvIssue {
  id: number;
  issue_number: string | null;
  store_date: string | null;
  cover_date: string | null;
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
  private readonly deadline: number;
  private readonly today: string;
  private lastRequestAt = 0;
  private total = 0;
  private readonly counts: Record<string, number> = {};

  constructor(private readonly options: ComicVineOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.maxRequests = options.maxRequests ?? 90;
    this.deadline = options.deadline ?? Number.POSITIVE_INFINITY;
    this.today = options.today ?? new Date().toISOString().slice(0, 10);
  }

  requestCounts(): Record<string, number> {
    return { ...this.counts };
  }

  private remaining(): number {
    return this.maxRequests - this.total;
  }

  private async get<T>(resource: string, path: string, params: Record<string, string>): Promise<CvResponse<T>> {
    if (this.total >= this.maxRequests) throw new BudgetExhausted('request budget for this batch is used up');
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
      query: group.series,
      resources: 'volume',
      field_list: VOLUME_FIELDS,
      limit: '10',
    });
    let volumes = search.status_code === 1 ? search.results : [];

    if (filterCandidates(group, volumes.map((v) => this.toCandidate(v))).candidates.length === 0) {
      const byName = await this.get<CvVolume[]>('volumes', 'volumes/', {
        filter: `name:${this.filterValue(group.series)}`,
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

  async resolve(group: BookGroup, context: AdapterContext): Promise<GroupResult> {
    let chosen: CvVolume | null = null;

    if (context.knownSourceId) {
      chosen = await this.volumeById(context.knownSourceId);
    }

    if (!chosen) {
      const { volumes, all } = await this.findCandidates(group);
      if (all.length === 0) {
        return { kind: 'failed', code: 'not_found', message: `No ComicVine volume named "${group.series}".` };
      }

      const { candidates, loose, rejected } = filterCandidates(group, all);
      const summary = (c: VolumeCandidate) => ({
        id: c.sourceId,
        name: c.name,
        start_year: c.startYear,
        publisher: c.publisher,
        issues: c.countOfIssues,
        url: c.siteUrl,
      });
      if (candidates.length === 0) {
        return {
          kind: 'failed',
          code: 'no_candidates',
          message: `Found ${all.length} ComicVine volume(s) for "${group.series}", but none fit the publisher, year or issue numbers.`,
          details: { rejected: rejected.slice(0, 10) },
        };
      }

      const probe = pickProbeBook(group);
      let match: VolumeCandidate | null = null;
      if (!probe) {
        // A loose title match is only trusted once an issue date confirms it.
        if (candidates.length === 1 && !loose) match = candidates[0];
        else {
          return {
            kind: 'failed',
            code: 'ambiguous',
            message: loose
              ? `"${group.series}" only loosely matches ComicVine titles, and the comics have no publish date to confirm one.`
              : `${candidates.length} ComicVine volumes fit "${group.series}" and the comics have no publish date to tell them apart.`,
            details: { candidates: candidates.slice(0, 10).map(summary) },
          };
        }
      } else {
        for (const candidate of candidates.slice(0, MAX_VERIFY_CANDIDATES)) {
          const issue = await this.issueDates(candidate.sourceId, probe.number!);
          if (issue && datesAgree(probe.publishDate, issue.store_date, issue.cover_date)) {
            match = candidate;
            break;
          }
        }
        if (!match) {
          return {
            kind: 'failed',
            code: 'no_date_match',
            message: `No ComicVine volume of "${group.series}" has #${probe.number} published near ${probe.publishDate}.`,
            details: {
              checked_issue: probe.number,
              publish_date: probe.publishDate,
              earliest_publish_date: earliestPublishDate(group.books),
              candidates: candidates.slice(0, MAX_VERIFY_CANDIDATES).map(summary),
              other_candidates: candidates.slice(MAX_VERIFY_CANDIDATES, 10).map(summary),
            },
          };
        }
      }
      chosen = volumes.find((v) => String(v.id) === match!.sourceId) ?? null;
      if (!chosen) {
        return { kind: 'failed', code: 'internal', message: 'Matched candidate disappeared from the result set.' };
      }
    }

    const volumeId = String(chosen.id);
    const issues = await this.allIssues(volumeId);
    const byNumber = new Map<string, CvIssue>();
    for (const issue of issues) {
      const n = normalizeIssueNumber(issue.issue_number);
      if (n && !byNumber.has(n)) byNumber.set(n, issue);
    }
    const lastIssueDate = issues.reduce<string | null>((max, i) => {
      const d = i.store_date ?? i.cover_date;
      return d && (!max || d > max) ? d : max;
    }, null);

    const candidate = this.toCandidate(chosen);
    const volume: VolumeInfo = {
      source: this.source,
      sourceId: volumeId,
      name: candidate.name,
      startYear: candidate.startYear,
      publisher: candidate.publisher,
      countOfIssues: candidate.countOfIssues,
      lastIssueNumber: chosen.last_issue?.issue_number ?? null,
      lastIssueDate,
      isOngoing: isOngoing(lastIssueDate, this.today),
      siteUrl: candidate.siteUrl,
    };

    const matched: IssueMatch[] = [];
    const deferredBookIds: number[] = [];
    for (const book of group.books) {
      const n = normalizeIssueNumber(book.number);
      const issue = n ? byNumber.get(n) : issues.length === 1 ? issues[0] : undefined;
      if (!issue) {
        matched.push({ bookId: book.bookId, sourceIssueId: null, publishDate: null, storylines: [] });
        continue;
      }
      try {
        const storylines = await this.storylinesFor(String(issue.id), context);
        matched.push({
          bookId: book.bookId,
          sourceIssueId: String(issue.id),
          publishDate: issue.store_date ?? issue.cover_date ?? null,
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

    return { kind: 'matched', volume, issues: matched, deferredBookIds };
  }
}
