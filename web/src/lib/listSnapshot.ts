import { isBookEntry, type ListEntry, type ListSnapshot } from './types';

export function snapshotFromEntries(listName: string, entries: ListEntry[]): ListSnapshot {
  return {
    list_name: listName,
    books: entries.filter(isBookEntry).map((entry) => ({
      entry_id: entry.entry_id,
      book_id: entry.book_id,
      read_order: entry.read_order,
      completed: entry.book.completed,
      completed_date: entry.book.completed_date,
      location1_id: entry.book.location1_id,
      location2_id: entry.book.location2_id,
      location3_id: entry.book.location3_id,
    })),
    dividers: entries
      .filter((entry) => entry.entry_type === 'divider')
      .map((entry) => ({
        entry_id: entry.entry_id,
        divider_name: entry.divider_name,
        read_order: entry.read_order,
      })),
  };
}
