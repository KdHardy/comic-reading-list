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
});
