import type { ListEntry } from './types';

/** Reinsert visible entry IDs while keeping hidden completed books fixed. */
export function mergeVisibleEntryOrder(
  fullEntries: ListEntry[],
  reorderedVisibleEntryIds: number[],
  hideRead: boolean
): number[] {
  if (!hideRead) return reorderedVisibleEntryIds;

  const fullIds = fullEntries.map((entry) => entry.entry_id);
  const visibleSet = new Set(reorderedVisibleEntryIds);
  const queue = [...reorderedVisibleEntryIds];

  return fullIds.map((id) => (visibleSet.has(id) ? queue.shift()! : id));
}

export function hideReadStorageKey(listId: number): string {
  return `comic-reading-list:hideRead:${listId}`;
}

export function readHideReadPreference(listId: number): boolean {
  return localStorage.getItem(hideReadStorageKey(listId)) === '1';
}

export function writeHideReadPreference(listId: number, hideRead: boolean): void {
  localStorage.setItem(hideReadStorageKey(listId), hideRead ? '1' : '0');
}
