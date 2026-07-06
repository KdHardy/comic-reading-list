import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Book, LocationOption } from '../lib/types';
import { NoteList } from './NoteList';

interface Props {
  book: Book;
  locations: LocationOption[];
  isFirst: boolean;
  isLast: boolean;
  onToggleComplete: (bookId: number, completed: boolean) => void;
  onMove: (bookId: number, direction: 'up' | 'down') => void;
  onLocationChange: (bookId: number, slot: 1 | 2 | 3, locationId: number | null) => void;
  onRemove: (bookId: number, title: string) => void;
  onAddNote: (bookId: number, text: string) => void | Promise<void>;
  onUpdateNote: (noteId: number, text: string) => void | Promise<void>;
  onDeleteNote: (noteId: number) => void | Promise<void>;
}

// Location 3 is kept in the data model but hidden from the UI for now.
const LOCATION_FIELDS = ['location1_id', 'location2_id'] as const;

export function BookRow({
  book,
  locations,
  isFirst,
  isLast,
  onToggleComplete,
  onMove,
  onLocationChange,
  onRemove,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.book_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const titleText = `${book.series}${book.volume ? ` (Vol ${book.volume})` : ''}${book.number ? ` #${book.number}` : ''}`;

  return (
    <div ref={setNodeRef} style={style} className={`book-row${book.completed ? ' book-row-completed' : ''}`}>
      <input
        type="checkbox"
        className="book-complete-checkbox"
        checked={book.completed}
        onChange={(e) => onToggleComplete(book.book_id, e.target.checked)}
        aria-label={`Mark ${titleText} complete`}
      />

      <div className="book-nav-buttons">
        <button type="button" disabled={isFirst} onClick={() => onMove(book.book_id, 'up')} aria-label="Move up">
          ▲
        </button>
        <button type="button" disabled={isLast} onClick={() => onMove(book.book_id, 'down')} aria-label="Move down">
          ▼
        </button>
      </div>

      {book.thumbnail ? (
        // eslint-disable-next-line jsx-a11y/img-redundant-alt
        <img className="book-thumbnail" src={book.thumbnail} alt="" />
      ) : (
        <div className="book-thumbnail book-thumbnail-placeholder" />
      )}

      <div className="book-title">{titleText}</div>

      <div className="book-meta">
        <div className="book-publisher">{book.publisher}</div>
        <div className="book-publish-date">{book.publish_date}</div>
      </div>

      <div className="book-locations">
        {LOCATION_FIELDS.map((field, idx) => (
          <select
            key={field}
            value={book[field] ?? ''}
            onChange={(e) =>
              onLocationChange(book.book_id, (idx + 1) as 1 | 2 | 3, e.target.value ? Number(e.target.value) : null)
            }
            aria-label={`Location ${idx + 1}`}
          >
            <option value="">—</option>
            {locations.map((loc) => (
              <option key={loc.location_id} value={loc.location_id}>
                {loc.location_name}
              </option>
            ))}
          </select>
        ))}
      </div>

      <NoteList
        notes={book.notes}
        onAdd={(text) => onAddNote(book.book_id, text)}
        onUpdate={onUpdateNote}
        onDelete={onDeleteNote}
      />

      <button type="button" className="drag-handle" aria-label="Drag to reorder" {...attributes} {...listeners}>
        ☰
      </button>

      <button
        type="button"
        className="book-delete-button"
        aria-label={`Remove ${titleText} from list`}
        title="Remove from list"
        onClick={() => onRemove(book.book_id, titleText)}
      >
        🗑
      </button>
    </div>
  );
}
