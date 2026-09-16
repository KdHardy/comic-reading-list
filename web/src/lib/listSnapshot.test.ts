import { describe, expect, it } from 'vitest';
import { snapshotFromEntries } from './listSnapshot';
import type { ListEntry } from './types';

describe('snapshotFromEntries', () => {
  it('captures book state and divider identity in a mixed list', () => {
    const entries = [
      {
        entry_id: 10,
        list_id: 2,
        entry_type: 'book',
        book_id: 7,
        divider_name: null,
        read_order: 20,
        book: {
          book_id: 7,
          completed: true,
          completed_date: '2026-09-16T10:00:00Z',
          location1_id: 2,
          location2_id: null,
          location3_id: 4,
        },
      },
      {
        entry_id: 11,
        list_id: 2,
        entry_type: 'divider',
        book_id: null,
        divider_name: 'Act Two',
        read_order: 30,
        book: null,
      },
    ] as ListEntry[];

    expect(snapshotFromEntries('Gala', entries)).toEqual({
      list_name: 'Gala',
      books: [
        {
          entry_id: 10,
          book_id: 7,
          read_order: 20,
          completed: true,
          completed_date: '2026-09-16T10:00:00Z',
          location1_id: 2,
          location2_id: null,
          location3_id: 4,
        },
      ],
      dividers: [
        {
          entry_id: 11,
          divider_name: 'Act Two',
          read_order: 30,
        },
      ],
    });
  });

  it('preserves every divider name and read_order verbatim across multiple sections, in list order', () => {
    const entries = [
      {
        entry_id: 1,
        list_id: 1,
        entry_type: 'divider',
        book_id: null,
        divider_name: 'Marvel + Jun 02, 2021',
        read_order: 10,
        book: null,
      },
      {
        entry_id: 2,
        list_id: 1,
        entry_type: 'book',
        book_id: 100,
        divider_name: null,
        read_order: 20,
        book: {
          book_id: 100,
          completed: false,
          completed_date: null,
          location1_id: null,
          location2_id: null,
          location3_id: null,
        },
      },
      {
        entry_id: 3,
        list_id: 1,
        entry_type: 'divider',
        book_id: null,
        divider_name: 'DC + Jul 14, 2021',
        read_order: 30,
        book: null,
      },
    ] as ListEntry[];

    const snapshot = snapshotFromEntries('Pull List', entries);

    // Persisted divider identity/name/order round-trips exactly as-is —
    // nothing here recomputes a name from neighboring comics, which is what
    // keeps a divider's default name immutable once it has been moved.
    expect(snapshot.dividers).toEqual([
      { entry_id: 1, divider_name: 'Marvel + Jun 02, 2021', read_order: 10 },
      { entry_id: 3, divider_name: 'DC + Jul 14, 2021', read_order: 30 },
    ]);
    expect(snapshot.books).toEqual([
      {
        entry_id: 2,
        book_id: 100,
        read_order: 20,
        completed: false,
        completed_date: null,
        location1_id: null,
        location2_id: null,
        location3_id: null,
      },
    ]);
  });
});
