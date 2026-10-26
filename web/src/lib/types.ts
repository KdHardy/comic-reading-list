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

/** PostgreSQL bigint entry IDs are currently within JavaScript's safe integer range. */
export type ListEntryId = number;

interface ListEntryBase {
  entry_id: ListEntryId;
  list_id: number;
  read_order: number;
}

export interface BookListEntry extends ListEntryBase {
  entry_type: 'book';
  book_id: number;
  divider_name: null;
  book: Book;
}

export interface DividerListEntry extends ListEntryBase {
  entry_type: 'divider';
  book_id: null;
  divider_name: string;
  book: null;
}

export type ListEntry = BookListEntry | DividerListEntry;

export function isBookEntry(entry: ListEntry): entry is BookListEntry {
  return entry.entry_type === 'book';
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
    entry_id: number;
    book_id: number;
    read_order: number;
    completed: boolean;
    completed_date: string | null;
    location1_id: number | null;
    location2_id: number | null;
    location3_id: number | null;
  }[];
  dividers: {
    entry_id: number;
    divider_name: string;
    read_order: number;
  }[];
}

export type PullListStatus = 'read_all' | 'maybe' | 'skip';

/** A series is identified like book dedupe: (series, volume, publisher), with NULLs normalized to ''. */
export interface SeriesKey {
  series: string;
  volume: string;
  publisher: string;
}

/** Title art crop rectangle as fractions (0–1) of the cover's width and height. */
export interface TitleArtCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A row of `pull_list_series`: user-chosen metadata for one series. */
export interface PullListSeriesMeta extends SeriesKey {
  family: string | null;
  status: PullListStatus | null;
  sort_order: number | null;
  title_art_book_id: number | null;
  title_art_x: number | null;
  title_art_y: number | null;
  title_art_w: number | null;
  title_art_h: number | null;
}

/** A book that appears on at least one list, as needed by the Pull List. */
export interface PullListIssue {
  book_id: number;
  publisher: string | null;
  series: string;
  volume: string | null;
  number: string | null;
  publish_date: string | null;
  thumbnail: string | null;
  thumbnail_cached_at: string | null;
  completed: boolean;
}

export interface PullListTitleArt {
  issue: PullListIssue;
  crop: TitleArtCrop;
  /** True when no cover was chosen and the first available cover's top band is shown. */
  isDefault: boolean;
}

export interface PullListSeries extends SeriesKey {
  key: string;
  family: string | null;
  status: PullListStatus | null;
  sortOrder: number | null;
  /** Distinct issues across every list, in reading order (publish date, then issue number). */
  issues: PullListIssue[];
  totalIssues: number;
  issuesRead: number;
  titleArt: PullListTitleArt | null;
}
