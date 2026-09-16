import { arrayMove } from '@dnd-kit/sortable';
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

/**
 * "Hide read" hides completed books. A section divider is only meaningful
 * once it separates two visible (unread) sections, so a divider is shown
 * only when the run of books immediately above it (back to the previous
 * divider, or the start of the list) and the run immediately below it
 * (forward to the next divider, or the end of the list) each contain at
 * least one unread book. This naturally hides a divider that would
 * otherwise sit at the edge of the visible list, back-to-back with another
 * divider, or over a section that is entirely read.
 */
export function filterVisibleEntries(entries: ListEntry[], hideRead: boolean): ListEntry[] {
  if (!hideRead) return entries;

  const segments: boolean[] = [false];
  for (const entry of entries) {
    if (entry.entry_type === 'divider') {
      segments.push(false);
    } else if (!entry.book.completed) {
      segments[segments.length - 1] = true;
    }
  }

  const visible: ListEntry[] = [];
  let segmentIndex = 0;
  for (const entry of entries) {
    if (entry.entry_type === 'divider') {
      segmentIndex += 1;
      if (segments[segmentIndex - 1] && segments[segmentIndex]) {
        visible.push(entry);
      }
    } else if (!entry.book.completed) {
      visible.push(entry);
    }
  }
  return visible;
}

/** Pure helper backing drag-and-drop reordering; returns null for a no-op drag. */
export function computeDragReorder(
  visibleEntryIds: number[],
  activeId: number,
  overId: number
): number[] | null {
  if (activeId === overId) return null;
  const oldIndex = visibleEntryIds.indexOf(activeId);
  const newIndex = visibleEntryIds.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1) return null;
  return arrayMove(visibleEntryIds, oldIndex, newIndex);
}

/** Pure helper backing the up/down move buttons; returns null when the move is a no-op. */
export function computeStepReorder(
  visibleEntryIds: number[],
  entryId: number,
  direction: 'up' | 'down'
): number[] | null {
  const index = visibleEntryIds.indexOf(entryId);
  if (index === -1) return null;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= visibleEntryIds.length) return null;
  return arrayMove(visibleEntryIds, index, targetIndex);
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
