// The contract every Stuart scanning adapter implements. Adapters are tried in
// priority order for each group of books; ComicVine is the only one today.

import type { BookGroup, VolumeCandidate } from './matching.ts';

export interface StorylineInfo {
  sourceId: string;
  name: string;
  publisher?: string | null;
  issueCount?: number | null;
  siteUrl?: string | null;
}

export interface VolumeInfo {
  source: string;
  sourceId: string;
  name: string;
  startYear: number | null;
  publisher: string | null;
  countOfIssues: number | null;
  firstIssueNumber: string | null;
  lastIssueNumber: string | null;
  lastIssueDate: string | null;
  isOngoing: boolean | null;
  siteUrl: string | null;
}

export interface IssueMatch {
  bookId: number;
  /** Null when the series/volume matched but the issue isn't in the database (yet). */
  sourceIssueId: string | null;
  publishDate: string | null;
  storylines: StorylineInfo[];
}

/** A comic in a matched group that didn't line up with its own issue (e.g. the dates disagree). */
export interface BookFailure {
  bookId: number;
  code: string;
  message: string;
  details?: unknown;
}

export type GroupResult =
  | {
      kind: 'matched';
      volume: VolumeInfo;
      issues: IssueMatch[];
      bookFailures: BookFailure[];
      /** Books left for a later batch because the request budget ran out. */
      deferredBookIds: number[];
    }
  | { kind: 'failed'; code: string; message: string; details?: unknown };

/** A volume already stored locally (series_volume), as a match candidate. */
export interface CachedVolume extends VolumeCandidate {
  lastIssueDate: string | null;
  isOngoing: boolean | null;
  /** When the volume's details were last fetched from the source. */
  detailsSyncedAt: string | null;
  /** When the volume's issue list was last fetched from the source; null if never. */
  issuesSyncedAt: string | null;
}

/** A stored issue of a cached volume (series_volume_issue). */
export interface CachedIssue {
  sourceIssueId: string;
  issueNumber: string | null;
  storeDate: string | null;
  coverDate: string | null;
  /** Null until the issue's story arcs have been fetched. */
  storylines: StorylineInfo[] | null;
}

/**
 * Stuart's own copy of volumes and issues it has looked up before, checked
 * before going to the source: volume details and issue dates almost never
 * change once published.
 */
export interface VolumeCache {
  /** Every stored volume for this source. */
  readonly volumes: CachedVolume[];
  /** A volume's stored issues, or null if its issue list was never fetched. */
  issues(sourceVolumeId: string): Promise<CachedIssue[] | null>;
  /**
   * Store a volume's details (detailsSynced: they were just fetched) and,
   * when given, its full issue list (replacing what's stored).
   */
  saveVolume(volume: VolumeInfo, options: { detailsSynced: boolean; issues?: CachedIssue[] }): Promise<void>;
  saveStorylines(sourceVolumeId: string, sourceIssueId: string, storylines: StorylineInfo[]): Promise<void>;
}

export interface AdapterContext {
  /** The adapter's id for a volume this group was matched to before, if any. */
  knownSourceId: string | null;
  /** Story arcs already stored for this adapter's source (skip their detail lookups). */
  knownStorylineIds: Set<string>;
  /** Volumes and issues already looked up, checked before the source. */
  cache: VolumeCache;
}

export interface SeriesAdapter {
  readonly name: string;
  readonly source: string;
  resolve(group: BookGroup, context: AdapterContext): Promise<GroupResult>;
  /** Requests made so far, by resource, for the run log. */
  requestCounts(): Record<string, number>;
}

/**
 * Thrown to end the current batch early. Books not yet handled stay pending
 * for the next batch. `fatal` errors (e.g. a rejected API key) also stop the
 * rest of tonight's batches.
 */
export class StopRun extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fatal: boolean
  ) {
    super(message);
    this.name = 'StopRun';
  }
}
