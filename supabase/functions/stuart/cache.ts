// An in-memory VolumeCache: used for dry runs (reads from the real cache but
// never writes), tests, and local scripts.

import type { CachedIssue, CachedVolume, StorylineInfo, VolumeCache, VolumeInfo } from './adapter.ts';

export class MemoryVolumeCache implements VolumeCache {
  readonly volumes: CachedVolume[];
  private readonly issueLists = new Map<string, CachedIssue[]>();
  readonly saved: { volume: VolumeInfo; detailsSynced: boolean; issues?: CachedIssue[] }[] = [];

  constructor(volumes: CachedVolume[] = [], issues: Record<string, CachedIssue[]> = {}) {
    this.volumes = [...volumes];
    for (const [id, list] of Object.entries(issues)) this.issueLists.set(id, list);
  }

  issues(sourceVolumeId: string): Promise<CachedIssue[] | null> {
    return Promise.resolve(this.issueLists.get(sourceVolumeId) ?? null);
  }

  saveVolume(volume: VolumeInfo, options: { detailsSynced: boolean; issues?: CachedIssue[] }): Promise<void> {
    this.saved.push({ volume, ...options });
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
    if (options.issues) this.issueLists.set(volume.sourceId, options.issues);
    return Promise.resolve();
  }

  saveStorylines(sourceVolumeId: string, sourceIssueId: string, storylines: StorylineInfo[]): Promise<void> {
    const issue = this.issueLists.get(sourceVolumeId)?.find((i) => i.sourceIssueId === sourceIssueId);
    if (issue) issue.storylines = storylines;
    return Promise.resolve();
  }
}

/** Wrap a cache so reads pass through and writes go only to memory (dry runs). */
export function readOnlyCache(inner: VolumeCache): VolumeCache {
  const memory = new MemoryVolumeCache(inner.volumes.map((v) => ({ ...v })));
  return {
    get volumes() {
      return memory.volumes;
    },
    async issues(sourceVolumeId) {
      return (await memory.issues(sourceVolumeId)) ?? (await inner.issues(sourceVolumeId));
    },
    saveVolume: (volume, options) => memory.saveVolume(volume, options),
    saveStorylines: (volumeId, issueId, storylines) => memory.saveStorylines(volumeId, issueId, storylines),
  };
}
