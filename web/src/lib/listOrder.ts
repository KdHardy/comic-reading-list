import type { ListEntry } from './types';

/** Reinsert visible entry IDs while keeping hidden completed books fixed. */
export function mergeVisibleEntryOrder(
  fullEntries: ListEntry[],
  reorderedVisibleEntryIds: number[],
  hideRead: boolean
): number[] {
  // Reordering while books are hidden can move an unseen book across a section
  // divider. Preserve the complete order until every entry is visible.
  if (hideRead) return fullEntries.map((entry) => entry.entry_id);
  return reorderedVisibleEntryIds;
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
