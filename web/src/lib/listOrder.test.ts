import { describe, expect, it } from 'vitest';
import { mergeVisibleEntryOrder } from './listOrder';
import type { Book, ListEntry } from './types';

function entry(entryId: number, entryType: 'book' | 'divider'): ListEntry {
  if (entryType === 'divider') {
    return {
      entry_id: entryId,
      list_id: 1,
      entry_type: 'divider',
      book_id: null,
      divider_name: `Section ${entryId}`,
      read_order: entryId * 10,
      book: null,
    };
  }

  return {
    entry_id: entryId,
    list_id: 1,
    entry_type: 'book',
    book_id: entryId * 100,
    divider_name: null,
    read_order: entryId * 10,
    book: { completed: entryId === 3 } as Book,
  };
}

describe('mergeVisibleEntryOrder', () => {
  it('keeps hidden completed books fixed while reordering books and dividers', () => {
    const entries = [
      entry(1, 'book'),
      entry(2, 'divider'),
      entry(3, 'book'),
      entry(4, 'divider'),
      entry(5, 'book'),
    ];

    expect(mergeVisibleEntryOrder(entries, [5, 4, 2, 1], true)).toEqual([5, 4, 3, 2, 1]);
  });

  it('uses the complete supplied entry order when nothing is hidden', () => {
    expect(
      mergeVisibleEntryOrder(
        [entry(1, 'book'), entry(2, 'divider'), entry(3, 'book')],
        [3, 2, 1],
        false
      )
    ).toEqual([3, 2, 1]);
  });
});
