export interface LocationOption {
  location_id: number;
  location_name: string;
}

export interface Note {
  note_id: number;
  book_id: number;
  note_text: string;
  created_at: string;
}

export interface Book {
  book_id: number;
  publisher: string | null;
  series: string;
  volume: string | null;
  number: string | null;
  event: string | null;
  publish_date: string | null;
  thumbnail: string | null;
  thumbnail_mime: string | null;
  thumbnail_cached_at: string | null;
  location1_id: number | null;
  location2_id: number | null;
  location3_id: number | null;
  completed: boolean;
  completed_date: string | null;
  notes: Note[];
}

export interface ReadingOrderRow {
  list_id: number;
  book_id: number;
  read_order: number;
  book: Book;
}

export interface ReadingListSummary {
  list_id: number;
  list_name: string;
  completed: boolean;
  created_date: string;
  completed_date: string | null;
}

/** Snapshot of a list's editable state, captured on page load, used to power the Revert button. */
export interface ListSnapshot {
  list_name: string;
  books: {
    book_id: number;
    read_order: number;
    completed: boolean;
    completed_date: string | null;
    location1_id: number | null;
    location2_id: number | null;
    location3_id: number | null;
  }[];
}
