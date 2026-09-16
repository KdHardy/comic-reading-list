import { formatPublishDate } from './formatDate';
import type { Book } from './types';

/**
 * Default section-divider name, computed once — at the moment a divider is
 * inserted — from the comic that will sit immediately below it. The result
 * is persisted as plain `divider_name` text, exactly like a user-typed
 * name, so it is never recomputed afterward: moving the divider (or the
 * comics around it) never changes an already-assigned default.
 */
export function defaultDividerName(book: Pick<Book, 'publisher' | 'publish_date'>): string {
  const publisher = book.publisher?.trim() || null;
  const date = formatPublishDate(book.publish_date);

  if (publisher && date) return `${publisher} + ${date}`;
  if (publisher) return publisher;
  if (date) return date;
  return 'New Section';
}
