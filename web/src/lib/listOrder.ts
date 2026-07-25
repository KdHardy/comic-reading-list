import type { ReadingOrderRow } from './types';

/** Reinsert a new visible-only order into the full list, keeping completed rows fixed. */
export function mergeVisibleOrder(
  fullRows: ReadingOrderRow[],
  reorderedVisibleIds: number[],
  hideRead: boolean
): number[] {
  if (!hideRead) return reorderedVisibleIds;

  const fullIds = fullRows.map((row) => row.book_id);
  const visibleSet = new Set(reorderedVisibleIds);
  const queue = [...reorderedVisibleIds];

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
