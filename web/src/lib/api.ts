import { supabase, WRITE_SECRET } from './supabaseClient';
import { blobToBase64 } from './thumbnailCache';
import {
  type Book,
  type ListEntry,
  type ListSnapshot,
  type LocationOption,
  type Note,
  type ReadingListSummary,
} from './types';

const BOOK_FIELDS = `
  book_id, publisher, series, volume, number, event, publish_date,
  thumbnail, thumbnail_mime, thumbnail_cached_at,
  location1_id, location2_id, location3_id, completed, completed_date
`;

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
): Promise<{ list: ReadingListSummary; entries: ListEntry[] }> {
  const [{ data: list, error: listError }, { data: entries, error: entriesError }] = await Promise.all([
    supabase.from('reading_list').select('*').eq('list_id', listId).single(),
    supabase
      .from('list_entry')
      .select(`entry_id, list_id, entry_type, book_id, divider_name, read_order, book:book_id(${BOOK_FIELDS}, notes:note(note_id, book_id, note_text, created_at))`)
      .eq('list_id', listId)
      .order('read_order', { ascending: true })
      .order('entry_id', { ascending: true }),
  ]);

  if (listError) throw listError;
  if (entriesError) throw entriesError;

  return {
    list: list as ReadingListSummary,
    entries: ((entries ?? []) as unknown as ListEntry[]).map((entry) =>
      entry.entry_type === 'divider'
        ? { ...entry, book: null }
        : {
            ...entry,
            book: {
              ...(entry.book as Book),
              notes: [...((entry.book as Book).notes ?? [])].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              ),
            },
          }
    ),
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

export async function deleteListEntry(listId: number, entryId: number): Promise<void> {
  const { error } = await supabase.rpc('delete_list_entry_v2', {
    p_secret: WRITE_SECRET,
    p_list_id: listId,
    p_entry_id: entryId,
  });
  if (error) throw error;
}

export async function createSectionDivider(
  listId: number,
  dividerName: string,
  beforeEntryId: number | null = null
): Promise<number> {
  const { data, error } = await supabase.rpc('create_section_divider_v2', {
    p_secret: WRITE_SECRET,
    p_list_id: listId,
    p_divider_name: dividerName,
    p_before_entry_id: beforeEntryId,
  });
  if (error) throw error;
  return Number(data);
}

export async function updateSectionDivider(entryId: number, dividerName: string): Promise<void> {
  const { error } = await supabase.rpc('update_section_divider_v2', {
    p_secret: WRITE_SECRET,
    p_divider_id: entryId,
    p_divider_name: dividerName,
  });
  if (error) throw error;
}

export async function reorderListEntries(listId: number, entryIdsInOrder: number[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_list_entries_v2', {
    p_secret: WRITE_SECRET,
    p_list_id: listId,
    p_entry_ids: entryIdsInOrder,
  });
  if (error) throw error;
}

export async function revertList(listId: number, snapshot: ListSnapshot): Promise<void> {
  const { error } = await supabase.rpc('revert_list_entries_v2', {
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

export async function fetchBookThumbnail(
  bookId: number
): Promise<{ mime: string; data: string } | null> {
  const { data, error } = await supabase
    .from('book')
    .select('thumbnail_data, thumbnail_mime')
    .eq('book_id', bookId)
    .single();

  if (error) throw error;
  if (!data?.thumbnail_data) return null;

  return {
    mime: data.thumbnail_mime ?? 'image/jpeg',
    data: data.thumbnail_data as string,
  };
}

export async function saveBookThumbnail(bookId: number, blob: Blob): Promise<void> {
  const base64 = await blobToBase64(blob);
  const { error } = await supabase.rpc('save_book_thumbnail', {
    p_secret: WRITE_SECRET,
    p_book_id: bookId,
    p_thumbnail_data: base64,
    p_thumbnail_mime: blob.type || 'image/jpeg',
  });
  if (error) throw error;
}
