import { supabase, WRITE_SECRET } from './supabaseClient';
import type { Book, ListSnapshot, LocationOption, Note, ReadingListSummary, ReadingOrderRow } from './types';

export async function fetchLists(): Promise<ReadingListSummary[]> {
  const { data, error } = await supabase
    .from('reading_list')
    .select('list_id, list_name, completed, created_date, completed_date')
    .order('created_date', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function fetchLocations(): Promise<LocationOption[]> {
  const { data, error } = await supabase
    .from('location')
    .select('location_id, location_name')
    .order('location_id', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function fetchListDetail(
  listId: number
): Promise<{ list: ReadingListSummary; rows: ReadingOrderRow[] }> {
  const [{ data: list, error: listError }, { data: rows, error: rowsError }] = await Promise.all([
    supabase.from('reading_list').select('*').eq('list_id', listId).single(),
    supabase
      .from('reading_order')
      .select('list_id, book_id, read_order, book:book_id(*, notes:note(note_id, book_id, note_text, created_at))')
      .eq('list_id', listId)
      .order('read_order', { ascending: true }),
  ]);

  if (listError) throw listError;
  if (rowsError) throw rowsError;

  return {
    list: list as ReadingListSummary,
    // supabase-js types the embedded relation as an array; it's always a single row here.
    rows: ((rows ?? []) as unknown as (Omit<ReadingOrderRow, 'book'> & { book: Book })[]).map((r) => ({
      ...r,
      book: {
        ...r.book,
        notes: [...(r.book.notes ?? [])].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
      },
    })),
  };
}

export function snapshotFromRows(listName: string, rows: ReadingOrderRow[]): ListSnapshot {
  return {
    list_name: listName,
    books: rows.map((r) => ({
      book_id: r.book_id,
      read_order: r.read_order,
      completed: r.book.completed,
      completed_date: r.book.completed_date,
      location1_id: r.book.location1_id,
      location2_id: r.book.location2_id,
      location3_id: r.book.location3_id,
    })),
  };
}

export async function createReadingList(listName: string): Promise<number> {
  const { data, error } = await supabase.rpc('create_reading_list', {
    p_secret: WRITE_SECRET,
    p_list_name: listName,
  });
  if (error) throw error;
  return data as number;
}

export async function updateListTitle(listId: number, newTitle: string): Promise<void> {
  const { error } = await supabase.rpc('update_list_title', {
    p_secret: WRITE_SECRET,
    p_list_id: listId,
    p_new_title: newTitle,
  });
  if (error) throw error;
}

export async function setBookCompleted(bookId: number, completed: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_book_completed', {
    p_secret: WRITE_SECRET,
    p_book_id: bookId,
    p_completed: completed,
  });
  if (error) throw error;
}

export async function setBookLocation(bookId: number, slot: 1 | 2 | 3, locationId: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_book_location', {
    p_secret: WRITE_SECRET,
    p_book_id: bookId,
    p_slot: slot,
    p_location_id: locationId,
  });
  if (error) throw error;
}

export async function removeBookFromList(listId: number, bookId: number): Promise<void> {
  const { error } = await supabase.rpc('remove_book_from_list', {
    p_secret: WRITE_SECRET,
    p_list_id: listId,
    p_book_id: bookId,
  });
  if (error) throw error;
}

export async function reorderList(listId: number, bookIdsInOrder: number[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_list', {
    p_secret: WRITE_SECRET,
    p_list_id: listId,
    p_book_ids: bookIdsInOrder,
  });
  if (error) throw error;
}

export async function revertList(listId: number, snapshot: ListSnapshot): Promise<void> {
  const { error } = await supabase.rpc('revert_list', {
    p_secret: WRITE_SECRET,
    p_list_id: listId,
    p_snapshot: snapshot,
  });
  if (error) throw error;
}

export async function addNote(bookId: number, noteText: string): Promise<Note> {
  const { data, error } = await supabase.rpc('add_note', {
    p_secret: WRITE_SECRET,
    p_book_id: bookId,
    p_note_text: noteText,
  });
  if (error) throw error;
  return {
    note_id: data as number,
    book_id: bookId,
    note_text: noteText.trim(),
    created_at: new Date().toISOString(),
  };
}

export async function updateNote(noteId: number, noteText: string): Promise<void> {
  const { error } = await supabase.rpc('update_note', {
    p_secret: WRITE_SECRET,
    p_note_id: noteId,
    p_note_text: noteText,
  });
  if (error) throw error;
}

export async function deleteNote(noteId: number): Promise<void> {
  const { error } = await supabase.rpc('delete_note', {
    p_secret: WRITE_SECRET,
    p_note_id: noteId,
  });
  if (error) throw error;
}
