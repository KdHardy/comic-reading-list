// The contract every Stuart scanning adapter implements. Adapters are tried in
// priority order for each group of books; ComicVine is the only one today.

import type { BookGroup } from './matching.ts';

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

export type GroupResult =
  | {
      kind: 'matched';
      volume: VolumeInfo;
      issues: IssueMatch[];
      /** Books left for a later batch because the request budget ran out. */
      deferredBookIds: number[];
    }
  | { kind: 'failed'; code: string; message: string; details?: unknown };

export interface AdapterContext {
  /** The adapter's id for a volume this group was matched to before, if any. */
  knownSourceId: string | null;
  /** Story arcs already stored for this adapter's source (skip their detail lookups). */
  knownStorylineIds: Set<string>;
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
