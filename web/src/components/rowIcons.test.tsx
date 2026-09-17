import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Book, DividerListEntry } from '../lib/types';
import { BookRow } from './BookRow';
import { DividerRow } from './DividerRow';

const book: Book = {
  book_id: 7,
  publisher: 'Marvel',
  series: 'Amazing Spider-Man',
  volume: null,
  number: '1',
  event: null,
  publish_date: '2021-06-02',
  thumbnail: null,
  thumbnail_mime: null,
  thumbnail_cached_at: null,
  location1_id: null,
  location2_id: null,
  location3_id: null,
  completed: false,
  completed_date: null,
  notes: [],
};

const dividerEntry: DividerListEntry = {
  entry_id: 42,
  list_id: 1,
  entry_type: 'divider',
  book_id: null,
  divider_name: 'Act Two',
  read_order: 30,
  book: null,
};

describe('divider rows use the same drag/delete affordances as book rows', () => {
  it('renders identical drag-handle text and class', () => {
    const { unmount } = render(
      <BookRow
        entryId={7}
        book={book}
        locations={[]}
        isFirst={false}
        isLast={false}
        orderingDisabled={false}
        onToggleComplete={vi.fn()}
        onMove={vi.fn()}
        onLocationChange={vi.fn()}
        onRemove={vi.fn()}
        onAddNote={vi.fn()}
        onUpdateNote={vi.fn()}
        onDeleteNote={vi.fn()}
        onThumbnailCached={vi.fn()}
      />
    );
    const bookDragHandle = screen.getByRole('button', { name: 'Drag to reorder' });
    const bookDragClass = bookDragHandle.className;
    const bookDragText = bookDragHandle.textContent;
    const bookDeleteButton = screen.getByRole('button', { name: /Remove .* from list/ });
    const bookDeleteClass = bookDeleteButton.className;
    const bookDeleteText = bookDeleteButton.textContent;
    unmount();

    render(
      <DividerRow
        entry={dividerEntry}
        orderingDisabled={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn()}
      />
    );
    const dividerDragHandle = screen.getByRole('button', { name: 'Drag to reorder' });
    const dividerDeleteButton = screen.getByRole('button', { name: /Remove .* from list/ });

    expect(dividerDragHandle.className).toBe(bookDragClass);
    expect(dividerDragHandle.textContent).toBe(bookDragText);
    expect(dividerDeleteButton.className).toBe(bookDeleteClass);
    expect(dividerDeleteButton.textContent).toBe(bookDeleteText);
  });
});
